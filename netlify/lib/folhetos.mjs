// Folhetos: the promotional flyer (PDF) as a native, shoppable block for SFCC Page Designer (Raw HTML, no JavaScript).
// Pages are images (rendered from the PDF in the editor, uploaded by the team to the SFCC library); products are
// hotspots (dot + card, or a clickable area) referenced by SKU. Product data: live SFCC price / stock (every 2 h, see
// live.mjs) with the daily feed as fallback (and for the PDP URL). Raw HTML cannot refresh itself, so the editor shows
// when the data changed since the last export ("exporta e cola de novo").
// Folheto saves are editorial, not pipeline runs; new live alerts are reported by the live refresh.
import crypto from "node:crypto";
import { db, httpError } from "./store.mjs";
import { LOCALES, fold, getCatalog } from "./products.mjs";
import { LK, isActive, refreshLive } from "./live.mjs";

export const FK = {
  index: () => "fol/index",
  item: (id) => `fol/${id}`,
};
export const liveSetId = (id) => `fol-${id}`.slice(0, 80);
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const pct = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 100) / 100)) : d; };
const day = (s) => (/^\d{4}-\d{2}-\d{2}/.test(String(s || "")) ? String(s).slice(0, 10) : "");
// image hosts the storefront CSP (img-src) accepts
export const ALLOWED_IMG = [/(^|\.)homastores\.com$/, /\.demandware\.net$/, /\.commercecloud\.salesforce\.com$/, /(^|\.)amazonaws\.com$/, /(^|\.)homa\.pt$/];
export const imageHostOk = (url) => { try { const u = new URL(url.replace("{n}", "1")); return u.protocol === "https:" && ALLOWED_IMG.some((re) => re.test(u.hostname)); } catch { return false; } };

// "…/natal/1.jpg" (URL of one page copied from the library) or "…/n.jpg" → "…/natal/{n}.jpg"
export function normalizePattern(u) {
  const s = String(u || "").trim();
  if (!s || s.includes("{n}")) return s;
  return s.replace(/\/(\d+|n)\.(jpe?g|png|webp)(?=$|[?#])/i, "/{n}.$2");
}

// a viewer page (Publitas, …) instead of the PDF itself: find the download link in its HTML
export function findPdfLink(html, base) {
  const s = String(html || "").replace(/&amp;/g, "&").replace(/\\\//g, "/");
  const m = s.match(/(?:href|src|content|data-url)=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/i) || s.match(/https?:\/\/[^"'\s<>\\]+?\.pdf(?:\?[^"'\s<>\\]*)?/i);
  if (!m) return null;
  try { return new URL(m[1] || m[0], base).href; } catch { return null; }
}

export function sanitizeFolheto(b = {}) {
  const market = LOCALES[b.market] ? b.market : "pt";
  const pageCount = Math.max(0, Math.min(80, Math.round(Number(b.pageCount) || (Array.isArray(b.pages) ? b.pages.length : 0))));
  const pages = Array.from({ length: pageCount }, (_, i) => {
    const r = Number(b.pages?.[i]?.ratio);
    return { ratio: Number.isFinite(r) && r > 0.2 && r < 5 ? Math.round(r * 10000) / 10000 : 0.7071 };
  });
  let n = 0;
  const hotspots = (Array.isArray(b.hotspots) ? b.hotspots : []).filter((h) => h && Number(h.page) >= 1 && Number(h.page) <= Math.max(1, pageCount)).slice(0, 400).map((h) => {
    const area = h.type === "area";
    const x = pct(h.x, 50), y = pct(h.y, 50);
    return {
      id: String(h.id || `h${++n}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || `h${++n}`,
      page: Math.round(Number(h.page)),
      type: area ? "area" : "dot",
      x, y,
      ...(area ? { w: Math.max(1, Math.min(100 - x, pct(h.w, 10))), h: Math.max(1, Math.min(100 - y, pct(h.h, 10))) } : {}),
      sku: String(h.sku || "").trim().slice(0, 40),
      printedPrice: h.printedPrice === "" || h.printedPrice === null || h.printedPrice === undefined || !Number.isFinite(Number(h.printedPrice)) ? null : Math.round(Number(h.printedPrice) * 100) / 100,
    };
  });
  return {
    id: b.id,
    name: String(b.name || "Novo folheto").slice(0, 120),
    market,
    validFrom: day(b.validFrom),
    validTo: day(b.validTo),
    pdfUrl: /^https?:\/\//i.test(String(b.pdfUrl || "")) ? String(b.pdfUrl).trim().slice(0, 1000) : "",
    imagePattern: /^https:\/\//i.test(String(b.imagePattern || "")) ? normalizePattern(b.imagePattern).slice(0, 500) : "",
    title: String(b.title ?? "").slice(0, 160),
    pageCount,
    pages,
    hotspots,
  };
}

const summary = (f) => ({ id: f.id, name: f.name, market: f.market, validFrom: f.validFrom, validTo: f.validTo, pages: f.pageCount, hotspots: f.hotspots.length, products: new Set(f.hotspots.map((h) => h.sku).filter(Boolean)).size, updatedAt: f.updatedAt, exportedAt: f.exportedAt || null });

async function saveIndex(f, remove = false) {
  const idx = ((await db.get(FK.index())) || []).filter((x) => x.id !== f.id);
  if (!remove) idx.unshift(summary(f));
  await db.set(FK.index(), idx);
}
async function uniqueId(name) {
  const taken = new Set(((await db.get(FK.index())) || []).map((x) => x.id));
  const base = slug(name) || "folheto";
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

// keep the live SKU list (SFCC refresh every 2 h) in sync with the hotspots; pulls right away
export async function syncLiveSet(f, { refresh = true, fetchFn } = {}) {
  const sid = liveSetId(f.id);
  const seen = new Set();
  const items = f.hotspots.filter((h) => h.sku && !seen.has(h.sku) && seen.add(h.sku)).map((h) => ({ id: h.sku, printedPrice: h.printedPrice }));
  const set = { id: sid, name: f.name, kind: "folheto", markets: [f.market], items, validFrom: f.validFrom, validTo: f.validTo, updatedAt: new Date().toISOString() };
  await db.set(LK.set(sid), set);
  const ids = (await db.get(LK.sets())) || [];
  if (!ids.includes(sid)) await db.set(LK.sets(), [...ids, sid]);
  if (refresh && items.length) return refreshLive({ onlyId: sid, trigger: "save", ...(fetchFn ? { fetchFn } : {}) });
  return null;
}

async function dropLiveSet(id) {
  const sid = liveSetId(id);
  await db.del(LK.set(sid));
  await db.del(LK.data(sid));
  await db.set(LK.sets(), ((await db.get(LK.sets())) || []).filter((x) => x !== sid));
}

const searchUrl = (market, sku) => `https://www.homastores.com/${market === "es" ? "es/es" : "pt/pt"}/search?q=${encodeURIComponent(sku)}`;

// renderer config: folheto + product data per SKU (live SFCC first, then the feed)
export function hydrateFolheto(f, catalog, live) {
  const byId = new Map((catalog?.items || []).map((p) => [p.id, p]));
  const liveP = live?.markets?.[f.market] || {};
  const products = {};
  for (const sku of new Set(f.hotspots.map((h) => h.sku).filter(Boolean))) {
    const feed = byId.get(sku), l = liveP[sku];
    if (!feed && !l) { products[sku] = { id: sku, missing: true }; continue; }
    const price = l ? l.price : feed.salePrice ?? feed.price;
    const listPrice = l ? l.listPrice : feed.salePrice ? feed.price : null;
    products[sku] = {
      id: sku,
      name: l?.name || feed?.title || sku,
      price: price ?? null,
      listPrice: listPrice && price !== null && listPrice > price ? listPrice : null,
      image: l?.image || feed?.image || "",
      url: feed?.link || searchUrl(f.market, sku),
      inStock: l ? l.inStock : feed.inStock,
      path: feed?.path || [],
      source: l ? "sfcc" : "feed",
    };
  }
  return {
    id: f.id, name: f.name, title: f.title, market: f.market, locale: LOCALES[f.market], currency: "EUR",
    pages: f.pages.map((p, i) => ({ n: i + 1, ratio: p.ratio, src: f.imagePattern ? f.imagePattern.replaceAll("{n}", String(i + 1)) : "" })),
    hotspots: f.hotspots,
    products,
    validFrom: f.validFrom, validTo: f.validTo,
    liveAt: live?.fetchedAt || null, feedAt: catalog?.generatedAt || null,
  };
}

// what the exported HTML depends on: if this changes, the code on the site is out of date
export function fingerprint(cfg) {
  const data = { p: cfg.pages.map((p) => [p.src, p.ratio]), h: cfg.hotspots.map((h) => [h.page, h.type, h.x, h.y, h.w, h.h, h.sku]), d: Object.values(cfg.products).sort((a, b) => a.id.localeCompare(b.id)).map((p) => [p.id, p.name, p.price, p.listPrice, p.inStock, p.url, p.image, !!p.missing]), t: cfg.title };
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
}

async function hydrateSaved(f) {
  let catalog = null;
  try { catalog = await getCatalog(f.market); } catch {} // a folheto still renders with live data only
  const live = await db.get(LK.data(liveSetId(f.id)));
  const cfg = hydrateFolheto(f, catalog, live);
  return { cfg, live, fp: fingerprint(cfg) };
}

async function withStatus(f) {
  const { cfg, live, fp } = await hydrateSaved(f);
  const state = await db.get(LK.state());
  return {
    folheto: f,
    render: cfg,
    status: {
      active: isActive(f),
      fingerprint: fp,
      exportedFingerprint: f.exportedFingerprint || null,
      outdated: !!f.exportedAt && f.exportedFingerprint !== fp,
      exportedAt: f.exportedAt || null,
      liveAt: live?.fetchedAt || null,
      alerts: live?.alerts || [],
      lastRun: state?.lastRun || null,
      nextRun: state?.nextRun || null,
      runError: state?.error || null,
      imageHostOk: f.imagePattern ? imageHostOk(f.imagePattern) : null,
    },
  };
}

// ---------------------------------------------------------------------------- PDF proxy
async function openPdf(url, depth = 0) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25_000), headers: { "user-agent": "Mozilla/5.0 (FeedForge)" } });
  if (!res.ok) throw httpError(502, `Não foi possível descarregar o PDF (${res.status})`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > 60 * 1024 * 1024) throw httpError(413, "PDF demasiado grande (máx. 60 MB)");
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  while (got < 1024) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; }
  const head = Buffer.concat(chunks);
  if (head.subarray(0, 1024).toString("latin1").includes("%PDF-")) {
    const stream = new ReadableStream({
      start(c) { c.enqueue(head); },
      async pull(c) { const { done, value } = await reader.read(); if (done) c.close(); else c.enqueue(value); },
      cancel(r) { reader.cancel(r); },
    });
    return { stream, finalUrl: res.url || url };
  }
  // not a PDF: read the page (max 3 MB) and look for the download link once
  const parts = [head];
  for (let n = head.length; n < 3 * 1024 * 1024;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; }
  reader.cancel().catch(() => {});
  const link = depth === 0 ? findPdfLink(Buffer.concat(parts).toString("utf8"), res.url || url) : null;
  if (link) return openPdf(link, 1);
  throw httpError(415, "Esse URL não é um PDF (é uma página). Usa o link direto do ficheiro, por exemplo “Baixar PDF” no catálogo.");
}

// ---------------------------------------------------------------------------- routes (/api/folhetos*)
export function registerFolhetos(route) {
  // PDF proxy for the editor (the flyer host rarely allows cross-origin reads); streamed, PDFs only.
  // A viewer page (e.g. catalogo.homa.pt / Publitas) is accepted too: the PDF download link is taken from it.
  route("GET", "/folhetos/pdf", async ({ query }) => {
    const url = String(query.get("url") || "");
    if (!/^https?:\/\//i.test(url)) throw httpError(400, "URL do PDF inválido");
    const { stream, finalUrl } = await openPdf(url);
    return new Response(stream, { status: 200, headers: { "content-type": "application/pdf", "cache-control": "private, max-age=600", "x-pdf-url": encodeURI(decodeURI(finalUrl)) } });
  });

  route("GET", "/folhetos", async () => {
    const idx = (await db.get(FK.index())) || [];
    return Promise.all(idx.map(async (s) => {
      const live = await db.get(LK.data(liveSetId(s.id)));
      return { ...s, active: isActive(s), alerts: (live?.alerts || []).length, liveAt: live?.fetchedAt || null };
    }));
  });

  route("POST", "/folhetos", async ({ body }) => {
    const now = new Date().toISOString();
    const f = { ...sanitizeFolheto(body), id: await uniqueId(body.name || "folheto"), createdAt: now, updatedAt: now };
    await db.set(FK.item(f.id), f);
    await saveIndex(f);
    await syncLiveSet(f);
    return withStatus(f);
  });

  route("GET", "/folhetos/:id", async ({ id }) => {
    const f = await db.get(FK.item(id));
    if (!f) throw httpError(404, "Folheto não encontrado");
    return withStatus(f);
  });

  route("PUT", "/folhetos/:id", async ({ id, body }) => {
    const cur = await db.get(FK.item(id));
    if (!cur) throw httpError(404, "Folheto não encontrado");
    const f = { ...sanitizeFolheto({ ...body, id }), createdAt: cur.createdAt, updatedAt: new Date().toISOString(), exportedAt: cur.exportedAt, exportedFingerprint: cur.exportedFingerprint };
    await db.set(FK.item(id), f);
    await saveIndex(f);
    await syncLiveSet(f);
    return withStatus(f);
  });

  route("DELETE", "/folhetos/:id", async ({ id }) => {
    await db.del(FK.item(id));
    await saveIndex({ id }, true);
    await dropLiveSet(id);
    return { ok: true };
  });

  // "Atualizar agora": pull this folheto's SKUs from SFCC
  route("POST", "/folhetos/:id/refresh", async ({ id }) => {
    const f = await db.get(FK.item(id));
    if (!f) throw httpError(404, "Folheto não encontrado");
    await syncLiveSet(f, { refresh: false });
    const run = await refreshLive({ onlyId: liveSetId(id), trigger: "manual" });
    return { run, ...(await withStatus(f)) };
  });

  // the editor calls this when the code is generated: remembers what is on the site
  route("POST", "/folhetos/:id/exported", async ({ id, body }) => {
    const f = await db.get(FK.item(id));
    if (!f) throw httpError(404, "Folheto não encontrado");
    const { fp } = await hydrateSaved(f);
    if (body.fingerprint && body.fingerprint !== fp) throw httpError(409, "Os dados mudaram entretanto — gera o código de novo");
    f.exportedAt = new Date().toISOString();
    f.exportedFingerprint = fp;
    await db.set(FK.item(id), f);
    await saveIndex(f);
    return withStatus(f);
  });
}
