// Shop the Look (STL): product picker over the optimized feed + editorial modules (Netlify Blobs).
// Products are referenced by ID only; name/price/image/URL/availability always come from the feed.
// STL saves are editorial, not pipeline runs — nothing here reports to Filo.
import { db, httpError } from "./store.mjs";
import { PK, LOCALES, fold, getCatalog, searchCatalog, categoryTree, parseFilters, facetsFor, publicItem } from "./products.mjs";
// the feed search lives in products.mjs (shared with Page Builder); re-exported for existing imports
export { LOCALES, fold, feedForMarket, toCatalogItem, getCatalog, categoryTree, parseFilters, searchCatalog, facetsFor } from "./products.mjs";

export const SK = {
  index: () => "stl/modules/index",          // [{ id, name, market, page, status, updatedAt, products }]
  module: (id) => `stl/modules/${id}`,
  catalog: PK.catalog,                        // shared with /api/products (netlify/lib/products.mjs)
};

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
// /stl/products and /stl/categories stay as aliases of /api/products* (same search) for existing callers.
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
