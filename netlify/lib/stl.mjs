// Shop the Look (STL): product picker over the optimized feed + editorial modules (Netlify Blobs).
// Products are referenced by ID only; name/price/image/URL/availability always come from the feed.
// STL saves are editorial, not pipeline runs — nothing here reports to Filo.
import { db, K, listFeeds, httpError } from "./store.mjs";
import { parsePrice } from "./util.mjs";

export const SK = {
  index: () => "stl/modules/index",          // [{ id, name, market, page, status, updatedAt, products }]
  module: (id) => `stl/modules/${id}`,
  catalog: (m) => `stl/catalog/${m}`,         // compact product list built from the feed output
};

const CACHE_MS = 5 * 60 * 1000;
const mem = new Map(); // market -> { at, generatedAt, catalog }
export const LOCALES = { pt: "pt-PT", es: "es-ES" };
const FACET_COLS = ["color", "material", "brand", "condition", "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"];
const MAX_FACET_VALUES = 40;

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
export function toCatalogItem(r) {
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
    ...extra,
    _q: fold(r.title),
  };
}

export async function getCatalog(market, { force = false } = {}) {
  const hit = mem.get(market);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.catalog;
  const cfg = await feedForMarket(market);
  const stored = await db.get(SK.catalog(market));
  const out = await db.get(K.output(cfg.id)); // optimized output of the last run
  if (!out) throw httpError(404, `O feed ${cfg.name || cfg.id} ainda não tem output — corre um run primeiro`);
  let catalog = stored && stored.generatedAt === out.generatedAt && stored.feedId === cfg.id ? stored : null;
  if (!catalog) {
    catalog = { feedId: cfg.id, market, generatedAt: out.generatedAt, items: out.meta.rows.map(toCatalogItem).filter((p) => p.id) };
    await db.set(SK.catalog(market), catalog);
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

// q: exact ID / GTIN, otherwise every word must appear in the title (accent-insensitive)
export function searchCatalog(items, { q = "", category = "", subcategory = "", filters = {}, ids = null } = {}) {
  if (ids) {
    const byId = new Map(items.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(String(id)) || { id: String(id), missing: true });
  }
  let list = items;
  const qq = String(q || "").trim();
  if (qq) {
    // an exact ID / EAN hit wins over the category and filters (you typed the exact product)
    const exact = list.filter((p) => p.id === qq || (p.gtin && p.gtin.replace(/^0+/, "") === qq.replace(/^0+/, "")));
    if (exact.length) return exact;
    { const words = fold(qq).split(/\s+/).filter(Boolean); list = list.filter((p) => words.every((w) => p._q.includes(w))); }
  }
  if (category) list = list.filter((p) => p.path[0] === category);
  if (subcategory) list = list.filter((p) => p.path[1] === subcategory);
  const f = filters || {};
  if (f.inStock !== false) list = list.filter((p) => p.inStock);
  if (f.sale) list = list.filter((p) => p.salePrice);
  const eff = (p) => p.salePrice ?? p.price ?? 0;
  if (f.priceMin != null && f.priceMin !== "") list = list.filter((p) => eff(p) >= Number(f.priceMin));
  if (f.priceMax != null && f.priceMax !== "") list = list.filter((p) => eff(p) <= Number(f.priceMax));
  for (const [col, vals] of Object.entries(f.attrs || {})) if (vals?.length) list = list.filter((p) => vals.includes(p[col]));
  return list;
}

// low-cardinality columns present in the current result (colour, material, brand, custom labels…)
export function facetsFor(list) {
  const out = {};
  for (const c of FACET_COLS) {
    const m = new Map();
    for (const p of list) if (p[c]) m.set(p[c], (m.get(p[c]) || 0) + 1);
    if (m.size > 1 && m.size <= MAX_FACET_VALUES) out[c] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }
  return out;
}

const publicItem = ({ _q, ...p }) => p;

// ---------------------------------------------------------------------------- modules
export const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const clampPct = (v, d = 50) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : d; };

// keep only references + layout (never product data)
export function sanitizeModule(m = {}) {
  const market = LOCALES[m.market] ? m.market : "pt";
  return {
    id: m.id,
    name: String(m.name || "Novo Shop the Look").slice(0, 120),
    market,
    page: ["homepage", "plp", "pdp"].includes(m.page) ? m.page : "homepage",
    status: m.status === "live" ? "live" : "draft",
    eyebrow: String(m.eyebrow ?? "Shop the look"),
    title: String(m.title ?? ""),
    image: { src: String(m.image?.src || ""), alt: String(m.image?.alt || "") },
    blockColor: /^#[0-9a-f]{3,8}$/i.test(m.blockColor || "") ? m.blockColor : "#dfdbd2",
    cta: { show: !!m.cta?.show, text: String(m.cta?.text || "Ver todos os produtos"), url: String(m.cta?.url || ""), x: clampPct(m.cta?.x, 50), y: clampPct(m.cta?.y, 92) },
    popoverCta: String(m.popoverCta || "Ver produto"),
    activeIndex: Math.max(0, Number(m.activeIndex) || 0),
    products: (Array.isArray(m.products) ? m.products : []).filter((p) => p && p.id).slice(0, 30).map((p) => ({
      id: String(p.id),
      pin: { x: clampPct(p.pin?.x), y: clampPct(p.pin?.y), show: p.pin?.show !== false },
      badges: (Array.isArray(p.badges) ? p.badges : []).filter((b) => b && b.label).slice(0, 3).map((b) => ({ label: String(b.label).slice(0, 40), ...(["brand", "success"].includes(b.tone) ? { tone: b.tone } : {}) })),
    })),
  };
}

const summary = (m) => ({ id: m.id, name: m.name, market: m.market, page: m.page, status: m.status, products: m.products.length, image: m.image.src, updatedAt: m.updatedAt, createdAt: m.createdAt });

async function saveIndex(m, remove = false) {
  const idx = ((await db.get(SK.index())) || []).filter((x) => x.id !== m.id);
  if (!remove) idx.unshift(summary(m));
  await db.set(SK.index(), idx);
}

async function uniqueId(base) {
  const idx = (await db.get(SK.index())) || [];
  const taken = new Set(idx.map((x) => x.id));
  let id = `stl-${slug(base) || "modulo"}`, n = 2;
  while (taken.has(id)) id = `stl-${slug(base) || "modulo"}-${n++}`;
  return id;
}

// widget config: module + current feed data per product (missing / out of stock flagged)
export function hydrate(mod, catalog) {
  const byId = new Map(catalog.items.map((p) => [p.id, p]));
  return {
    id: mod.id, locale: LOCALES[mod.market], currency: "EUR", market: mod.market, page: mod.page,
    eyebrow: mod.eyebrow, title: mod.title, image: mod.image, blockColor: mod.blockColor, cta: mod.cta, popoverCta: mod.popoverCta, activeIndex: mod.activeIndex,
    products: mod.products.map((ref) => {
      const p = byId.get(ref.id);
      if (!p) return { id: ref.id, name: ref.id, description: "", price: 0, listPrice: null, image: "", url: "#", badges: ref.badges, pin: ref.pin, missing: true };
      return {
        id: p.id, name: p.title, description: p.description, price: p.salePrice ?? p.price ?? 0, listPrice: p.salePrice ? p.price : null,
        image: p.image, url: p.link, badges: ref.badges, pin: ref.pin, availability: p.availability, ...(p.inStock ? {} : { oos: true }),
      };
    }),
    hydratedAt: new Date().toISOString(), feedGeneratedAt: catalog.generatedAt,
  };
}

// ---------------------------------------------------------------------------- routes (/api/stl/*)
export function registerStl(route) {
  route("GET", "/stl/categories", async ({ query }) => {
    const cat = await getCatalog(query.get("market") || "pt");
    const inStockOnly = query.get("inStock") !== "0";
    return { market: cat.market, generatedAt: cat.generatedAt, ...categoryTree(inStockOnly ? cat.items.filter((p) => p.inStock) : cat.items) };
  });

  route("GET", "/stl/products", async ({ query }) => {
    const cat = await getCatalog(query.get("market") || "pt");
    const ids = query.get("ids") ? query.get("ids").split(",").map((s) => s.trim()).filter(Boolean) : null;
    const list = searchCatalog(cat.items, { q: query.get("q"), category: query.get("category"), subcategory: query.get("subcategory"), filters: parseFilters(query.get("filters")), ids });
    if (ids) return { items: list.map((p) => (p.missing ? p : publicItem(p))) };
    const size = Math.min(Number(query.get("size")) || 24, 100), page = Math.max(Number(query.get("page")) || 1, 1);
    return { market: cat.market, generatedAt: cat.generatedAt, total: list.length, page, size, items: list.slice((page - 1) * size, page * size).map(publicItem), facets: facetsFor(list) };
  });

  route("GET", "/stl/modules", async () => (await db.get(SK.index())) || []);

  route("POST", "/stl/modules", async ({ body }) => {
    const now = new Date().toISOString();
    const m = { ...sanitizeModule(body), id: await uniqueId(body.name || "modulo"), createdAt: now, updatedAt: now };
    await db.set(SK.module(m.id), m);
    await saveIndex(m);
    return m;
  });

  route("GET", "/stl/modules/:id", async ({ id }) => {
    const m = await db.get(SK.module(id));
    if (!m) throw httpError(404, "Módulo não encontrado");
    return m;
  });

  route("PUT", "/stl/modules/:id", async ({ id, body }) => {
    const cur = await db.get(SK.module(id));
    if (!cur) throw httpError(404, "Módulo não encontrado");
    const m = { ...sanitizeModule({ ...body, id }), createdAt: cur.createdAt, updatedAt: new Date().toISOString() };
    await db.set(SK.module(id), m);
    await saveIndex(m);
    return m;
  });

  route("POST", "/stl/modules/:id/duplicate", async ({ id }) => {
    const cur = await db.get(SK.module(id));
    if (!cur) throw httpError(404, "Módulo não encontrado");
    const now = new Date().toISOString();
    const m = { ...cur, id: await uniqueId(`${cur.name} copia`), name: `${cur.name} (cópia)`, status: "draft", createdAt: now, updatedAt: now };
    await db.set(SK.module(m.id), m);
    await saveIndex(m);
    return m;
  });

  route("DELETE", "/stl/modules/:id", async ({ id }) => {
    await db.del(SK.module(id));
    await saveIndex({ id }, true);
    return { ok: true };
  });

  // saved module, re-hydrated from the current feed
  route("GET", "/stl/render/:id", async ({ id, query }) => {
    const m = await db.get(SK.module(id));
    if (!m) throw httpError(404, "Módulo não encontrado");
    const market = query.get("market") || m.market;
    return hydrate({ ...m, market }, await getCatalog(market));
  });

  // unsaved editor state (live preview / export)
  route("POST", "/stl/render", async ({ body }) => {
    const m = sanitizeModule(body);
    m.id = body.id || "stl-preview";
    return hydrate(m, await getCatalog(m.market));
  });
}
