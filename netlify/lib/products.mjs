// Shared product search over the OPTIMIZED feed (one feed per market, chosen by language).
// Used by Shop the Look and Page Builder: /api/products, /api/products/categories, /api/products/resolve.
import { db, K, listFeeds, httpError } from "./store.mjs";
import { parsePrice } from "./util.mjs";

export const PK = {
  catalog: (m) => `stl/catalog/${m}`, // compact product list built from the feed output (key kept from Shop the Look)
};
const CATALOG_V = 2; // bump when toCatalogItem changes shape
const CACHE_MS = 5 * 60 * 1000;
const NEW_DAYS = 30; // "Novo" badge: first seen in the feed in the last N days
const mem = new Map(); // market -> { at, catalog }
export const LOCALES = { pt: "pt-PT", es: "es-ES" };
export const FACET_COLS = ["color", "material", "brand", "condition", "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"];
const LABEL_COLS = FACET_COLS.filter((c) => c.startsWith("custom_label_"));
const MAX_FACET_VALUES = 40;
export const SORTS = ["feed_order", "price_asc", "price_desc", "newest"];

export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const splitPath = (s) => String(s || "").split(">").map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------------------- feed → catalog
export async function feedForMarket(market) {
  const want = LOCALES[market];
  if (!want) throw httpError(400, `Mercado desconhecido: ${market}`);
  for (const f of await listFeeds()) {
    const cfg = await db.get(K.config(f.id));
    if (String(cfg?.language || "").toLowerCase() === want.toLowerCase()) return cfg;
  }
  throw httpError(404, `Não há nenhum feed ${market.toUpperCase()} (língua ${want}) configurado no FeedForge`);
}

// one compact record per product of the optimized Meta output
export function toCatalogItem(r, firstSeen) {
  const price = parsePrice(r.price), sale = parsePrice(r.sale_price);
  const onSale = !!(sale && price && sale < price);
  const extra = {};
  for (const c of FACET_COLS) if (r[c]) extra[c] = String(r[c]);
  return {
    id: String(r.id ?? ""),
    title: r.title || "",
    description: String(r.description || "").slice(0, 300),
    link: r.link || "",
    image: r.image_link || "",
    price: price ?? null,
    salePrice: onSale ? sale : null,
    path: splitPath(r.product_type),
    availability: r.availability || "",
    inStock: !/out[ _]of[ _]stock|discontinued/i.test(r.availability || ""),
    gtin: String(r.gtin || "").trim(),
    group: r.item_group_id || "",
    ...(firstSeen ? { firstSeen } : {}),
    ...extra,
    _q: fold(r.title),
  };
}

export async function getCatalog(market, { force = false } = {}) {
  const hit = mem.get(market);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.catalog;
  const cfg = await feedForMarket(market);
  const stored = await db.get(PK.catalog(market));
  const out = await db.get(K.output(cfg.id)); // optimized output of the last run
  if (!out) throw httpError(404, `O feed ${cfg.name || cfg.id} ainda não tem output — corre um run primeiro`);
  let catalog = stored && stored.v === CATALOG_V && stored.generatedAt === out.generatedAt && stored.feedId === cfg.id ? stored : null;
  if (!catalog) {
    const seen = new Map((out.index || []).map((x) => [String(x.id), x.firstSeen]));
    catalog = { v: CATALOG_V, feedId: cfg.id, market, generatedAt: out.generatedAt, items: out.meta.rows.map((r) => toCatalogItem(r, seen.get(String(r.id)))).filter((p) => p.id) };
    await db.set(PK.catalog(market), catalog);
  }
  mem.set(market, { at: Date.now(), catalog });
  return catalog;
}

// ---------------------------------------------------------------------------- search
export function categoryTree(items) {
  const root = { name: "", count: 0, children: new Map() };
  for (const p of items) {
    let node = root;
    root.count++;
    for (const part of p.path) {
      if (!node.children.has(part)) node.children.set(part, { name: part, count: 0, children: new Map() });
      node = node.children.get(part);
      node.count++;
    }
  }
  const plain = (n) => [...n.children.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map((c) => ({ name: c.name, count: c.count, children: plain(c) }));
  return { total: root.count, children: plain(root) };
}

export function parseFilters(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

const truthy = (v) => v === true || v === 1 || /^(1|true|yes|sim)$/i.test(String(v ?? ""));
const falsy = (v) => v === false || v === 0 || /^(0|false|no|nao|não)$/i.test(String(v ?? ""));
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean);

// flat query params (?onSale=1&color=Branco,Preto&attrs={...}) → the filters object searchCatalog understands
export function filtersFromQuery(q) {
  const f = parseFilters(q.get("filters")); // legacy (Shop the Look) JSON form
  if (q.has("inStock")) f.inStock = !falsy(q.get("inStock"));
  if (q.has("onSale")) f.sale = truthy(q.get("onSale"));
  if (q.get("priceMin")) f.priceMin = q.get("priceMin");
  if (q.get("priceMax")) f.priceMax = q.get("priceMax");
  const attrs = { ...(f.attrs || {}), ...parseFilters(q.get("attrs")) };
  for (const c of ["color", "material"]) if (q.get(c)) attrs[c] = list(q.get(c));
  f.attrs = attrs;
  return f;
}

// q: exact ID / GTIN, otherwise every word must appear in the title (accent-insensitive)
export function searchCatalog(items, { q = "", category = "", subcategory = "", filters = {}, ids = null } = {}) {
  if (ids) {
    const byId = new Map(items.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(String(id)) || { id: String(id), missing: true });
  }
  let res = items;
  const qq = String(q || "").trim();
  if (qq) {
    // an exact ID / EAN hit wins over the category and filters (you typed the exact product)
    const exact = res.filter((p) => p.id === qq || (p.gtin && p.gtin.replace(/^0+/, "") === qq.replace(/^0+/, "")));
    if (exact.length) return exact;
    const words = fold(qq).split(/\s+/).filter(Boolean);
    res = res.filter((p) => words.every((w) => p._q.includes(w)));
  }
  if (category) res = res.filter((p) => p.path[0] === category);
  if (subcategory) res = res.filter((p) => p.path[1] === subcategory);
  const f = filters || {};
  if (f.inStock !== false) res = res.filter((p) => p.inStock);
  if (f.sale) res = res.filter((p) => p.salePrice);
  const eff = (p) => p.salePrice ?? p.price ?? 0;
  if (f.priceMin != null && f.priceMin !== "") res = res.filter((p) => eff(p) >= Number(f.priceMin));
  if (f.priceMax != null && f.priceMax !== "") res = res.filter((p) => eff(p) <= Number(f.priceMax));
  for (const [col, vals] of Object.entries(f.attrs || {})) if (vals?.length) res = res.filter((p) => vals.includes(p[col]));
  return res;
}

// low-cardinality columns present in the current result (colour, material, brand, custom labels…)
export function facetsFor(items) {
  const out = {};
  for (const c of FACET_COLS) {
    const m = new Map();
    for (const p of items) if (p[c]) m.set(p[c], (m.get(p[c]) || 0) + 1);
    if (m.size > 1 && m.size <= MAX_FACET_VALUES) out[c] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }
  return out;
}

export const publicItem = ({ _q, ...p }) => p;

// ---------------------------------------------------------------------------- rules + hydration
// rule = { category, subcategory, onSale, inStock (default true), priceMin, priceMax, sort, limit }
export function applyRule(items, rule = {}) {
  let res = searchCatalog(items, {
    category: rule.category || "", subcategory: rule.subcategory || "",
    filters: { inStock: rule.inStock !== false, sale: !!rule.onSale, priceMin: rule.priceMin ?? "", priceMax: rule.priceMax ?? "" },
  });
  const eff = (p) => p.salePrice ?? p.price ?? 0;
  const sort = SORTS.includes(rule.sort) ? rule.sort : "feed_order";
  if (sort === "price_asc") res = [...res].sort((a, b) => eff(a) - eff(b));
  if (sort === "price_desc") res = [...res].sort((a, b) => eff(b) - eff(a));
  if (sort === "newest") res = [...res].sort((a, b) => String(b.firstSeen || "").localeCompare(String(a.firstSeen || "")));
  const limit = Math.max(1, Math.min(48, Number(rule.limit) || 8));
  return { total: res.length, items: res.slice(0, limit) };
}

const BADGE_LABELS = {
  pt: { new: "Novo", brand: "Exclusivo online", success: "Sustentável" },
  es: { new: "Nuevo", brand: "Exclusivo online", success: "Sostenible" },
};
// badges from the feed: new (first seen < 30 days), online exclusive / sustainable (any custom label saying so)
export function badgesFor(p, market = "pt", now = Date.now()) {
  const L = BADGE_LABELS[market] || BADGE_LABELS.pt;
  const labels = LABEL_COLS.map((c) => fold(p[c])).join(" | ");
  const out = [];
  if (/online.?exclusive|exclusivo.?online|exclusiv[oa]s?.?web/.test(labels)) out.push({ label: L.brand, tone: "brand" });
  if (/sustent|sostenib|sustainab|eco.?friendly/.test(labels)) out.push({ label: L.success, tone: "success" });
  if (p.firstSeen && now - Date.parse(p.firstSeen) < NEW_DAYS * 864e5) out.push({ label: L.new });
  return out;
}

// card-ready product (same price logic as Shop the Look: price = sale price when on sale)
export function cardProduct(p, market = "pt") {
  if (!p || p.missing) return { id: String(p?.id ?? ""), missing: true };
  return {
    id: p.id, name: p.title, description: p.description, url: p.link, image: p.image,
    price: p.salePrice ?? p.price ?? 0, listPrice: p.salePrice ? p.price : null,
    inStock: p.inStock, ...(p.inStock ? {} : { oos: true }), badges: badgesFor(p, market),
  };
}

// { ids:[...] } (manual, keeps order, flags missing/oos) | { rule } / rule fields (resolved now)
export function resolveSource(items, src = {}, market = "pt") {
  if (Array.isArray(src.ids) && (src.mode === "manual" || !src.mode)) {
    const res = searchCatalog(items, { ids: src.ids.slice(0, 48) });
    return { mode: "manual", total: res.length, items: res.map((p) => cardProduct(p, market)) };
  }
  const rule = src.rule || src;
  const r = applyRule(items, rule);
  return { mode: "rule", total: r.total, items: r.items.map((p) => cardProduct(p, market)) };
}

// ---------------------------------------------------------------------------- routes (/api/products*)
export function registerProducts(route) {
  route("GET", "/products/categories", async ({ query }) => {
    const cat = await getCatalog(query.get("market") || "pt");
    const inStockOnly = !falsy(query.get("inStock") ?? "1");
    return { market: cat.market, generatedAt: cat.generatedAt, ...categoryTree(inStockOnly ? cat.items.filter((p) => p.inStock) : cat.items) };
  });

  route("GET", "/products", async ({ query }) => {
    const cat = await getCatalog(query.get("market") || "pt");
    const ids = query.get("ids") ? list(query.get("ids")) : null;
    const res = searchCatalog(cat.items, { q: query.get("q"), category: query.get("category"), subcategory: query.get("subcategory"), filters: filtersFromQuery(query), ids });
    if (ids) return { items: res.map((p) => (p.missing ? p : publicItem(p))) };
    const size = Math.min(Number(query.get("size")) || 24, 100), page = Math.max(Number(query.get("page")) || 1, 1);
    return { market: cat.market, generatedAt: cat.generatedAt, total: res.length, page, size, items: res.slice((page - 1) * size, page * size).map(publicItem), facets: facetsFor(res) };
  });

  route("POST", "/products/resolve", async ({ body, query }) => {
    const market = body.market || query.get("market") || "pt";
    const cat = await getCatalog(market);
    return { market, generatedAt: cat.generatedAt, ...resolveSource(cat.items, body, market) };
  });
}
