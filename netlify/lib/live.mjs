// Live product data from SFCC for short-lived lists of products (folhetos), refreshed every 2 hours.
// A "set" is a list of SKUs with validity dates; modules (the folheto editor) register / update their set.
// Only sets inside their validity window are refreshed: light, incremental, no AI.
// Storage:
//   live/sets                 -> [id, ...]
//   live/set/<id>             -> { id, name, kind, markets, items:[{ id, printedPrice?, market? }], validFrom, validTo, updatedAt }
//   live/data/<id>            -> { fetchedAt, markets:{ pt:{ sku: product } }, alerts:[...], newAlerts:[...] }
//   live/overlay/<market>     -> { fetchedAt, items:{ sku: { price, listPrice, inStock, stock } } }  (wins over the daily feed)
//   live/state                -> { lastRun, nextRun, durationMs, sets, skus, calls, error, trigger }
import { db, httpError } from "./store.mjs";
import { getProducts, sfccMissing, sfccConfig } from "./sfcc.mjs";

export const LK = {
  sets: () => "live/sets",
  set: (id) => `live/set/${id}`,
  data: (id) => `live/data/${id}`,
  overlay: (m) => `live/overlay/${m}`,
  state: () => "live/state",
};
export const EVERY_HOURS = 2;
const MARKETS = ["pt", "es"];
const day = (s) => (s ? String(s).slice(0, 10) : "");

export const nextRunAt = (from = new Date()) => {
  const d = new Date(from);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() + (EVERY_HOURS - (d.getUTCHours() % EVERY_HOURS)));
  return d.toISOString();
};

// active = today inside [validFrom, validTo] (dates are yyyy-mm-dd, inclusive; empty = open)
export function isActive(set, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return (!set.validFrom || day(set.validFrom) <= today) && (!set.validTo || day(set.validTo) >= today);
}

export function sanitizeSet(id, b = {}) {
  const markets = (Array.isArray(b.markets) ? b.markets : [b.market || "pt"]).filter((m) => MARKETS.includes(m));
  if (!markets.length) throw httpError(400, "Indica pelo menos um mercado (pt / es)");
  const seen = new Set();
  const items = (Array.isArray(b.items) ? b.items : (b.skus || []).map((s) => ({ id: s })))
    .map((x) => ({ id: String(x.id ?? x.sku ?? "").trim(), printedPrice: Number.isFinite(Number(x.printedPrice)) && x.printedPrice !== "" && x.printedPrice !== null ? Math.round(Number(x.printedPrice) * 100) / 100 : null, ...(MARKETS.includes(x.market) ? { market: x.market } : {}) }))
    .filter((x) => x.id && !seen.has(`${x.market || "*"}:${x.id}`) && seen.add(`${x.market || "*"}:${x.id}`))
    .slice(0, 1000);
  const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(day(s)) ? day(s) : "");
  return { id, name: String(b.name || id).slice(0, 120), kind: String(b.kind || "folheto").slice(0, 30), markets, items, validFrom: date(b.validFrom), validTo: date(b.validTo), updatedAt: new Date().toISOString() };
}

// alerts for one set from the live data
export function alertsFor(set, markets) {
  const out = [];
  for (const m of set.markets) {
    const data = markets[m] || {};
    for (const it of set.items) {
      if (it.market && it.market !== m) continue;
      const p = data[it.id];
      const base = { sku: it.id, market: m };
      if (!p) { out.push({ ...base, type: "missing", msg: "Não encontrado no SFCC (inexistente ou offline)" }); continue; }
      if (!p.inStock) out.push({ ...base, type: "oos", msg: "Esgotado", name: p.name });
      if (it.printedPrice !== null && p.price !== null && Math.abs(p.price - it.printedPrice) > 0.009) out.push({ ...base, type: "price", msg: `Preço no site ${p.price.toFixed(2)} € ≠ impresso ${it.printedPrice.toFixed(2)} €`, name: p.name, live: p.price, printed: it.printedPrice });
    }
  }
  return out;
}
const alertKey = (a) => `${a.type}|${a.market}|${a.sku}|${a.live ?? ""}`;

// refresh every active set (or only `onlyId`) — one SFCC call per 24 SKUs per market
export async function refreshLive({ onlyId = null, trigger = "schedule", fetchFn } = {}) {
  const started = Date.now();
  const state = { lastRun: new Date().toISOString(), nextRun: nextRunAt(), trigger, sets: 0, skus: 0, calls: 0, error: null };
  const report = [];
  try {
    if (sfccMissing().length) throw httpError(400, `Falta configurar no Netlify: ${sfccMissing().join(", ")}`);
    const ids = (await db.get(LK.sets())) || [];
    const sets = (await Promise.all(ids.map((id) => db.get(LK.set(id))))).filter(Boolean).filter((s) => (onlyId ? s.id === onlyId : isActive(s)));
    // one request per market for the union of SKUs
    const want = {};
    for (const s of sets) for (const m of s.markets) for (const it of s.items) if (!it.market || it.market === m) (want[m] ||= new Set()).add(it.id);
    const live = {};
    for (const [m, skus] of Object.entries(want)) {
      const r = await getProducts([...skus], m, fetchFn ? { fetchFn } : {});
      live[m] = r.found;
      state.calls += r.calls;
      state.skus += skus.size;
    }
    const fetchedAt = new Date().toISOString();
    for (const s of sets) {
      const markets = {};
      for (const m of s.markets) markets[m] = Object.fromEntries(s.items.filter((it) => !it.market || it.market === m).map((it) => [it.id, live[m]?.[it.id]]).filter(([, p]) => p));
      const prev = (await db.get(LK.data(s.id))) || {};
      const alerts = alertsFor(s, markets);
      const before = new Set((prev.alerts || []).map(alertKey));
      const newAlerts = alerts.filter((a) => !before.has(alertKey(a)));
      await db.set(LK.data(s.id), { fetchedAt, markets, alerts, newAlerts });
      if (newAlerts.length) report.push({ set: s.id, name: s.name, newAlerts });
    }
    state.sets = sets.length;
    // overlay used by the product search / blocks (all active sets, not only `onlyId`)
    if (!onlyId) for (const m of MARKETS) await db.set(LK.overlay(m), { fetchedAt, items: Object.fromEntries(Object.entries(live[m] || {}).map(([id, p]) => [id, { price: p.price, listPrice: p.listPrice, inStock: p.inStock, stock: p.stock }])) });
    else for (const [m, found] of Object.entries(live)) {
      const cur = (await db.get(LK.overlay(m))) || { items: {} };
      for (const [id, p] of Object.entries(found)) cur.items[id] = { price: p.price, listPrice: p.listPrice, inStock: p.inStock, stock: p.stock };
      await db.set(LK.overlay(m), { fetchedAt, items: cur.items });
    }
  } catch (e) {
    state.error = e.message;
  }
  state.durationMs = Date.now() - started;
  state.newAlerts = report;
  await db.set(LK.state(), state);
  return state;
}

// daily feed item + live overlay (live wins for price / sale price / stock)
export function overlayItem(p, o) {
  if (!o) return p;
  const price = o.listPrice ?? o.price ?? p.price;
  const sale = o.listPrice && o.price !== null && o.price < o.listPrice ? o.price : null;
  return { ...p, price, salePrice: sale, inStock: o.inStock, availability: o.inStock ? "in stock" : "out of stock", live: true };
}

// ---------------------------------------------------------------------------- routes (/api/live*, /api/sfcc*)
export function registerLive(route) {
  route("GET", "/sfcc/status", async () => {
    const c = sfccConfig();
    return { missing: sfccMissing(), shortCode: c.shortCode, orgId: c.orgId, sites: c.sites, auth: c.secret ? "private" : "public (PKCE)" };
  });
  // quick check: live data for a few SKUs, nothing stored
  route("POST", "/sfcc/test", async ({ body }) => {
    const ids = (Array.isArray(body.ids) ? body.ids : String(body.ids || "").split(/[\s,;]+/)).filter(Boolean).slice(0, 48);
    if (!ids.length) throw httpError(400, "Indica pelo menos um SKU");
    const r = await getProducts(ids, body.market || "pt");
    return { site: r.site, calls: r.calls, missing: r.missing, items: Object.values(r.found) };
  });

  route("GET", "/live/state", async () => ({ ...((await db.get(LK.state())) || {}), nextRun: nextRunAt(), everyHours: EVERY_HOURS }));
  route("GET", "/live/sets", async () => {
    const ids = (await db.get(LK.sets())) || [];
    const sets = (await Promise.all(ids.map((id) => db.get(LK.set(id))))).filter(Boolean);
    return Promise.all(sets.map(async (s) => { const d = (await db.get(LK.data(s.id))) || {}; return { id: s.id, name: s.name, kind: s.kind, markets: s.markets, skus: s.items.length, validFrom: s.validFrom, validTo: s.validTo, active: isActive(s), fetchedAt: d.fetchedAt || null, alerts: (d.alerts || []).length }; }));
  });
  route("GET", "/live/sets/:id", async ({ id }) => {
    const s = await db.get(LK.set(id));
    if (!s) throw httpError(404, "Lista não encontrada");
    return { ...s, active: isActive(s), data: (await db.get(LK.data(id))) || null };
  });
  // create / replace (the folheto editor calls this on every save; then pulls those SKUs right away)
  route("PUT", "/live/sets/:id", async ({ id, body }) => {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw httpError(400, "Identificador inválido (minúsculas, números e hífenes)");
    const s = sanitizeSet(id, body);
    await db.set(LK.set(id), s);
    const ids = (await db.get(LK.sets())) || [];
    if (!ids.includes(id)) await db.set(LK.sets(), [...ids, id]);
    const state = body.refresh === false ? null : await refreshLive({ onlyId: id, trigger: "save" });
    return { set: s, state, data: (await db.get(LK.data(id))) || null };
  });
  route("DELETE", "/live/sets/:id", async ({ id }) => {
    await db.del(LK.set(id));
    await db.del(LK.data(id));
    await db.set(LK.sets(), ((await db.get(LK.sets())) || []).filter((x) => x !== id));
    return { ok: true };
  });
  route("POST", "/live/refresh", async ({ body }) => refreshLive({ onlyId: body.id || null, trigger: "manual" }));
}
