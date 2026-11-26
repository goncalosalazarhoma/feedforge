// Local test for the folheto editor backend + static renderer. Run: node test/folhetos.test.mjs (SFCC mocked via env-less fallback)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useMemoryStore, db, K } from "../netlify/lib/store.mjs";

useMemoryStore();
process.env.APP_PASSWORD = "pw";
delete process.env.SFCC_CLIENT_ID; // no SFCC: the live refresh records an error, the feed is the fallback

const F = await import("../netlify/lib/folhetos.mjs");
const L = await import("../netlify/lib/live.mjs");
const { renderFolheto, listIdOf, listNameOf } = await import("../public/folhetos/render.mjs");
const css = readFileSync(new URL("../public/folhetos/folheto.css", import.meta.url), "utf8");

// ---- sanitize
const s = F.sanitizeFolheto({ name: "Natal", market: "fr", validFrom: "2026-11-20T00:00", validTo: "bad", pdfUrl: "javascript:x", imagePattern: "http://x/{n}.jpg", pageCount: 2, pages: [{ ratio: 0.7 }, { ratio: 99 }],
  hotspots: [{ page: 1, x: 120, y: -4, sku: " 473088 ", printedPrice: "15" }, { page: 2, type: "area", x: 90, y: 90, w: 30, h: 30, sku: "474166" }, { page: 3, x: 1, y: 1, sku: "x" }] });
assert.equal(s.market, "pt");
assert.deepEqual([s.validFrom, s.validTo, s.pdfUrl, s.imagePattern], ["2026-11-20", "", "", ""]);
assert.deepEqual(s.pages.map((p) => p.ratio), [0.7, 0.7071], "invalid ratio → A4");
assert.equal(s.hotspots.length, 2, "hotspot on a page that does not exist is dropped");
assert.deepEqual([s.hotspots[0].x, s.hotspots[0].y, s.hotspots[0].sku, s.hotspots[0].printedPrice, s.hotspots[0].type], [100, 0, "473088", 15, "dot"]);
assert.deepEqual([s.hotspots[1].w, s.hotspots[1].h], [10, 10], "area clamped inside the page");
assert.equal(F.imageHostOk("https://www.homastores.com/on/demandware.static/x/{n}.jpg"), true);
assert.equal(F.imageHostOk("https://homa-feedforge.netlify.app/{n}.jpg"), false, "CSP of the site");
assert.equal(F.normalizePattern("https://www.homastores.com/lib/natal/12.jpg"), "https://www.homastores.com/lib/natal/{n}.jpg", "URL of one page → pattern");
assert.equal(F.normalizePattern("https://x.demandware.net/lib/v123/n.jpg"), "https://x.demandware.net/lib/v123/{n}.jpg");
assert.equal(F.sanitizeFolheto({ imagePattern: "https://www.homastores.com/a/3.webp?sw=1400" }).imagePattern, "https://www.homastores.com/a/{n}.webp?sw=1400");
assert.equal(F.findPdfLink('<a class="dl" href="https://catalogo.homa.pt/71760/3381251/pdfs/8ea.pdf?response-content-disposition=attachment%3B&amp;x=1">Baixar PDF</a>', "https://catalogo.homa.pt/p/1"), "https://catalogo.homa.pt/71760/3381251/pdfs/8ea.pdf?response-content-disposition=attachment%3B&x=1");
assert.equal(F.findPdfLink("<html>sem pdf</html>", "https://x"), null);
assert.deepEqual(F.sanitizeSkus(["473088", { sku: " 433902 ", printedPrice: "14.99" }, "473088", "", { sku: "x", printedPrice: "abc" }]), [{ sku: "473088", printedPrice: null }, { sku: "433902", printedPrice: 14.99 }, { sku: "x", printedPrice: null }], "product list: trimmed, unique, prices");
assert.equal(F.normalizePattern("https://development-eu01-deborla.demandware.net/on/demandware.static/-/Sites-Homa_PT-Library/default/v123/7.jpg"), "https://development.homastores.com/on/demandware.static/-/Sites-Homa_PT-Library/default/v123/{n}.jpg", "instance host (not public, fails on phones) → storefront domain");
assert.equal(F.publicImageUrl("https://production-eu01-deborla.demandware.net/on/demandware.static/x.jpg"), "https://www.homastores.com/on/demandware.static/x.jpg");
const shs = F.sanitizeFolheto({ pageCount: 1, hotspots: [{ page: 1, sku: "a", shadow: 2 }, { page: 1, sku: "b", shadow: 9 }, { page: 1, type: "area", sku: "c", shadow: 3 }] }).hotspots;
assert.deepEqual(shs.map((h) => h.shadow), [2, undefined, undefined], "shadow 1–3 on dots only");
console.log("Sanitize OK");

// ---- hydrate: live SFCC > feed; missing; search URL fallback
const fol = F.sanitizeFolheto({ id: "natal", name: "Natal", market: "pt", imagePattern: "https://www.homastores.com/lib/natal/{n}.jpg", pageCount: 2, title: "Ofertas de Natal",
  hotspots: [{ id: "a", page: 1, x: 20, y: 30, sku: "473088", printedPrice: 15 }, { id: "b", page: 1, type: "area", x: 60, y: 60, w: 20, h: 20, sku: "474166" }, { id: "c", page: 2, x: 80, y: 80, sku: "999" }, { id: "d", page: 2, x: 10, y: 10, sku: "" }, { id: "e", page: 2, x: 30, y: 30, sku: "500" }] });
const catalog = { generatedAt: "2026-11-25T06:00:00Z", items: [
  { id: "473088", title: "Almofada SAVOY (feed)", price: 20, salePrice: null, link: "https://www.homastores.com/pt/pt/almofada-savoy/473088.html", image: "https://img/feed.jpg", inStock: true, path: ["Decoração", "Almofadas"] },
  { id: "474166", title: "Quadro MONA", price: 30, salePrice: 25, link: "https://www.homastores.com/pt/pt/quadro/474166.html", image: "", inStock: true, path: [] },
] };
const live = { fetchedAt: "2026-11-25T10:00:00Z", markets: { pt: { "473088": { id: "473088", name: "Almofada SAVOY", price: 14, listPrice: 20, inStock: true, image: "https://img/live.jpg" }, "500": { id: "500", name: "Vela", price: 5, listPrice: null, inStock: false, image: "" } } } };
const cfg = F.hydrateFolheto(fol, catalog, live);
assert.deepEqual([cfg.products["473088"].price, cfg.products["473088"].listPrice, cfg.products["473088"].name, cfg.products["473088"].source], [14, 20, "Almofada SAVOY", "sfcc"], "live wins");
assert.equal(cfg.products["473088"].url, catalog.items[0].link, "PDP link from the feed");
assert.deepEqual([cfg.products["474166"].price, cfg.products["474166"].listPrice, cfg.products["474166"].source], [25, 30, "feed"]);
assert.equal(cfg.products["999"].missing, true);
assert.match(cfg.products["500"].url, /search\?q=500$/, "not in the feed: search URL");
assert.equal(cfg.pages[1].src, "https://www.homastores.com/lib/natal/2.jpg");
const fp = F.fingerprint(cfg);
assert.equal(fp, F.fingerprint(F.hydrateFolheto(fol, catalog, live)), "stable");
assert.notEqual(fp, F.fingerprint(F.hydrateFolheto(fol, catalog, { ...live, markets: { pt: { ...live.markets.pt, "473088": { ...live.markets.pt["473088"], price: 12 } } } })), "price change → new fingerprint");
console.log("Hydrate OK");

// ---- render (export): static reader (no JS), tracking only on PDP links, nothing without a product
const R = await import("../public/folhetos/render.mjs");
assert.deepEqual(R.spreadsOf(6), [[1], [2, 3], [4, 5], [6]], "cover alone, then pairs");
live.markets.pt["473088"].stock = 3; // ≤ 5 → "Últimas unidades"
const cfgR = F.hydrateFolheto({ ...fol, validFrom: "2026-11-20", validTo: "2026-12-24", pages: [{ ratio: 0.7071, section: "Árvores e iluminação" }, { ratio: 0.7071, section: "Mesa de Natal" }] }, catalog, live);
assert.equal(cfgR.products["473088"].low, true);
const html = renderFolheto(cfgR, { css });
const noCss = (h) => h.replace(/<style>[\s\S]*?<\/style>/, "");
const body = noCss(html);
assert.ok(!/<script/i.test(html), "no JavaScript");
assert.ok(!/ style="/.test(html), "no inline styles");
assert.ok(html.includes(`data-ff-list-id="${listIdOf(cfgR)}"`) && html.includes(`data-ff-list-name="${listNameOf(cfgR)}"`));
assert.equal(listNameOf(cfgR), "Folheto - Natal");
// state: one radio per spread (2 pages → [1] [2]), per product (+ none), per page with products (+ none), tabs, index
assert.equal((body.match(/name="hfol-natal-s"/g) || []).length, 2);
assert.equal((body.match(/class="hfol__r hfol__rp"/g) || []).length, 3, "473088, 474166, 500 — 999 and the empty one are left out");
assert.ok(body.includes('id="hfol-natal-p1" data-ff-pin="473088"'), "pin event from the product radio");
// "+" / area labels open the product; only real links carry data-item-* (select_item)
assert.equal((body.match(/<label class="hfol__hs /g) || []).length, 3);
assert.ok(!/<label[^>]*data-item-id/.test(body), "labels never fire select_item");
// own flyer events (fol_*): container, pages and controls carry what ff-tracking.js reads
assert.ok(body.includes('data-fol-id="natal" data-fol-name="Natal" data-fol-pages="2"'), "flyer id / name / page count");
assert.equal((body.match(/<figure class="hfol__page hfol__pg--\d+" data-fol-page="\d+"/g) || []).length, 2, "one data-fol-page per page");
assert.equal((body.match(/<label class="hfol__hs [^>]*data-fol-ev="pin" data-fol-src="ponto"/g) || []).length, 3, "pins → fol_pin_select");
assert.ok(/class="hfol__row" for="hfol-natal-p\d+" data-fol-ev="pin" data-fol-src="lista"/.test(body), "panel rows → fol_pin_select (lista)");
assert.ok(/class="hfol__cta" for="hfol-natal-m1" data-fol-ev="sheet" data-fol-src="pagina" data-fol-to="1"/.test(body), "mobile CTA → fol_page_products");
assert.ok(/hfol__arrow--next"[^>]*data-fol-ev="nav" data-fol-src="seta" data-fol-to="2"/.test(body) && /hfol__th--1" for="hfol-natal-s1" data-fol-ev="nav" data-fol-src="miniatura" data-fol-to="2"/.test(body), "arrows / thumbs → fol_navigate");
assert.ok(body.includes('data-fol-ev="index"') && body.includes('data-fol-ev="all"') && body.includes('data-fol-tab="folheto"') && body.includes('data-fol-filter="Mesa de Natal"'), "index, all products, tabs, filter");
assert.ok(!/hfol__arrow--prev is-off"[^>]*data-fol-ev/.test(body), "disabled arrow sends nothing");
const TJS = readFileSync(new URL("../public/tracking/ff-tracking.js", import.meta.url), "utf8");
for (const e of ["fol_view", "fol_page_view", "fol_pin_select", "fol_page_products", "fol_navigate", "fol_index", "fol_tab", "fol_filter", "fol_all_products", "data-fol-page", "data-fol-ev", "i += 200"]) assert.ok(TJS.includes(e), `tracking tag: ${e}`);
assert.ok(TJS.includes('list.hasAttribute("data-fol-id")'), "flyer pins are not sent as stl_pin_select");
assert.ok(/page_number: undefined, fol_source: undefined, fol_tab: undefined, fol_filter: undefined, item_id: undefined/.test(TJS), "optional keys reset on every flyer event (GTM keeps old dataLayer values)");
const links = [...body.matchAll(/<a class="([^"]+)" href="([^"]+)"([^>]*)>/g)].filter((m) => m[3].includes("data-item-id"));
assert.ok(links.length >= 9, "detail (image + button), sheet list, grid card per product");
assert.match(links.find((m) => m[1].startsWith("hfol__card"))[3], /data-item-id="473088" data-item-name="Almofada SAVOY" data-item-price="14.00" data-item-index="1" data-item-cat="Decoração &gt; Almofadas"/);
// header, side panel, sheet, all products
assert.ok(body.includes("Válido de 20/11/2026 a 24/12/2026 · 2 páginas · 3 produtos"));
assert.ok(body.includes('<h2 class="hfol__title">Ofertas de Natal</h2>'));
assert.ok(body.includes("Nestas páginas") && body.includes("Ref. 473088"));
assert.ok(body.includes("Últimas unidades") && body.includes("Esgotado"));
assert.ok(body.includes("Ver os 2 produtos desta página"), "mobile CTA on page 1");
assert.ok(body.includes('href="#hfol-natal-todos"') && body.includes('id="hfol-natal-todos"'));
assert.ok(body.includes("Todos os produtos do folheto"));
assert.ok(body.includes('for="hfol-natal-f1" data-fol-ev="filter" data-fol-filter="Árvores e iluminação">Árvores e iluminação</label>'), "section filter from the page section");
assert.ok(!/Adicionar|carrinho/i.test(body), "no cart");
// rules: spread / list / detail / sheet / filter
assert.ok(html.includes("#hfol-natal .hfol__pg--1{aspect-ratio:0.7071}"));
assert.ok(html.includes("#hfol-natal:has(#hfol-natal-s1:checked) .hfol__sp--1{display:grid}"));
assert.ok(html.includes("#hfol-natal:has(#hfol-natal-s0:checked):has(#hfol-natal-p1:checked) .hfol__det--1{display:block}"));
assert.ok(html.includes("#hfol-natal:has(#hfol-natal-s0:checked):not(:has(#hfol-natal-p1:checked,#hfol-natal-p2:checked)) .hfol__list--0{display:block}"));
assert.ok(html.includes("#hfol-natal:has(#hfol-natal-m1:checked):not(:has(#hfol-natal-ta:checked)) .hfol__sl--1{display:block}"));
assert.ok(html.includes("#hfol-natal:has(#hfol-natal-f1:checked) .hfol__card:not(.hfol__sec--1){display:none}"));
assert.ok(!body.includes("hfol__miss"));
const pv = renderFolheto(cfgR, { css, preview: true, imageFor: (n) => `data:image/jpeg;base64,${n}` });
assert.equal((noCss(pv).match(/hfol__miss/g) || []).length, 2, "preview marks the hotspots without a product");
assert.ok(pv.includes('src="data:image/jpeg;base64,1"'));
// uploaded list: unpinned products are listed (grid + mobile "whole flyer"), only when found and in stock
{
  const cfgL = { ...cfgR, list: ["473088", "474166", "777", "888", "999"], products: { ...cfgR.products, "777": { id: "777", name: "Vela extra", price: 3, inStock: true, url: "https://x/777", path: ["Natal", "Velas"] }, "888": { id: "888", name: "Esgotado extra", price: 3, inStock: false, url: "https://x/888" } } };
  const b2 = noCss(renderFolheto(cfgL, { css }));
  assert.ok(b2.includes('data-item-id="777"'), "unpinned, found, in stock → listed");
  assert.ok(!b2.includes('data-item-id="888"'), "unpinned and out of stock → not listed");
  assert.ok(b2.includes("· 4 produtos"), "header counts the listed products");
  assert.ok(!b2.includes('id="hfol-natal-p4"'), "no '+' / detail radio for an unpinned product");
  assert.match(b2, /data-item-id="777"[^>]*data-item-index="4"/, "GA4 index continues after the pinned products");
}
{ // dots like Shop the Look + per-dot shadow; UI Library arrows
  const cfgS = { ...cfgR, hotspots: cfgR.hotspots.map((h, k) => (k === 0 ? { ...h, shadow: 3 } : h)) };
  const hs = renderFolheto(cfgS, { css });
  assert.ok(hs.includes("#hfol-natal .hfol__h--0{left:20%;top:30%;--hfol-sh:var(--hfol-sh3);--hfol-sh-on:var(--hfol-sh3-on)}"));
  assert.ok(hs.includes("#hfol-natal:has(#hfol-natal-p1:checked) .hfol__hs--1::after{width:12px;height:12px;box-shadow:var(--hfol-sh-on)}"), "open dot = 12 px (Interactive Dots V2)");
  assert.ok(css.includes("rgba(117,117,117,.4)") && css.includes("backdrop-filter:blur(2px)"), "Carrousel Controls (Light, Background Blur)");
}
delete live.markets.pt["473088"].stock;
console.log("Render OK");

// ---- API: create → live set synced with the hotspots; update; exported / outdated; delete
const row = (id, o = {}) => ({ id, title: `Produto ${id}`, availability: "in stock", price: "20.00 EUR", sale_price: "", link: `https://www.homastores.com/pt/pt/p/${id}.html`, image_link: "", product_type: "Decoração", ...o });
await db.set(K.config("feed-pt"), { id: "feed-pt", name: "PT", language: "pt-PT" });
await db.set(K.output("feed-pt"), { meta: { headers: [], rows: [row("473088"), row("474166")] }, gmc: { headers: [], rows: [] }, index: [], generatedAt: "2026-11-25T06:00:00Z" });
await db.set(K.feeds(), [{ id: "feed-pt" }]);
const api = (await import("../netlify/functions/api.mjs")).default;
const call = async (method, path, body) => {
  const res = await api(new Request("https://app.test/api" + path, { method, headers: { authorization: "Bearer pw", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, json: JSON.parse(await res.text()) };
};
let r = await call("POST", "/folhetos", { name: "Folheto Natal", market: "pt", validFrom: "2026-01-01", validTo: "2099-12-31", imagePattern: "https://www.homastores.com/lib/{n}.jpg", pageCount: 1, hotspots: [{ page: 1, x: 10, y: 10, sku: "473088", printedPrice: 20 }, { page: 1, x: 50, y: 50, sku: "473088" }] });
assert.equal(r.status, 200, JSON.stringify(r.json));
const id = r.json.folheto.id;
assert.equal(id, "folheto-natal");
let set = await db.get(L.LK.set(F.liveSetId(id)));
assert.deepEqual(set.items, [{ id: "473088", printedPrice: 20 }], "SKU list from the hotspots (unique)");
assert.ok((await db.get(L.LK.sets())).includes(F.liveSetId(id)));
assert.equal(r.json.status.active, true);
assert.equal(r.json.render.products["473088"].source, "feed", "no SFCC → feed");
assert.equal((await call("POST", "/folhetos", { name: "Folheto Natal" })).json.folheto.id, "folheto-natal-2", "unique id");
r = await call("PUT", `/folhetos/${id}`, { ...r.json.folheto, hotspots: [{ page: 1, x: 10, y: 10, sku: "474166", printedPrice: 19 }] });
set = await db.get(L.LK.set(F.liveSetId(id)));
assert.deepEqual(set.items.map((i) => i.id), ["474166"], "removed hotspot → SKU leaves the live list");
{ // product list (pasted SKUs): in the live list before the pins are placed; the list's printed price fills a pin without one
  const r2 = await call("PUT", `/folhetos/${id}`, { ...r.json.folheto, skus: [{ sku: "474166", printedPrice: 25 }, { sku: "473088", printedPrice: 18 }] });
  assert.equal(r2.json.folheto.skus.length, 2);
  const s2 = await db.get(L.LK.set(F.liveSetId(id)));
  assert.deepEqual(s2.items, [{ id: "474166", printedPrice: 19 }, { id: "473088", printedPrice: 18 }]);
  assert.equal(r2.json.render.products["473088"].id, "473088", "unpinned list products are hydrated too (listed in the block)");
  assert.deepEqual(r2.json.render.list, ["474166", "473088"]);
  r = await call("PUT", `/folhetos/${id}`, { ...r2.json.folheto, skus: [] });
}
assert.equal(r.json.status.outdated, false, "never exported");
assert.equal((await call("POST", `/folhetos/${id}/exported`, { fingerprint: "wrong" })).status, 409);
r = await call("POST", `/folhetos/${id}/exported`, { fingerprint: r.json.status.fingerprint });
assert.ok(r.json.status.exportedAt && r.json.status.outdated === false);
await db.set(L.LK.data(F.liveSetId(id)), { fetchedAt: "2026-11-25T12:00:00Z", markets: { pt: { "474166": { id: "474166", name: "Quadro MONA", price: 22, listPrice: null, inStock: true, image: "" } } }, alerts: [{ market: "pt", sku: "474166", type: "price", msg: "Preço no site 22.00 € ≠ impresso 19.00 €" }], newAlerts: [] });
r = await call("GET", `/folhetos/${id}`);
assert.equal(r.json.status.outdated, true, "live price changed after the export → re-export");
assert.equal(r.json.status.alerts.length, 1);
const list = (await call("GET", "/folhetos")).json;
assert.deepEqual(list.map((x) => [x.id, x.alerts]), [["folheto-natal", 1], ["folheto-natal-2", 0]], "last updated first");
r = await call("POST", `/folhetos/${id}/refresh`, {});
assert.match(r.json.run.error || "", /SFCC_CLIENT_ID/, "missing env → error reported, no crash");
assert.equal((await call("GET", "/folhetos/pdf?url=ftp://x")).status, 400);
{ // PDF proxy: a catalogue page is resolved to its PDF link; a page without one is refused (no more "invalid PDF" in pdf.js)
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u.endsWith("/page/1")) return new Response('<html><a href="/71760/pdfs/x.pdf?dl=1">Baixar PDF</a></html>', { headers: { "content-type": "text/html" } });
    if (u.includes("/pdfs/x.pdf")) { const r = new Response("%PDF-1.7 corpo", { headers: { "content-type": "application/pdf" } }); Object.defineProperty(r, "url", { value: u }); return r; }
    return new Response("<html>nada</html>", { headers: { "content-type": "text/html" } });
  };
  const ok = await api(new Request("https://app.test/api/folhetos/pdf?url=" + encodeURIComponent("https://catalogo.homa.pt/natal/page/1"), { headers: { authorization: "Bearer pw" } }));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "%PDF-1.7 corpo");
  assert.equal(decodeURI(ok.headers.get("x-pdf-url")), "https://catalogo.homa.pt/71760/pdfs/x.pdf?dl=1");
  const bad = await api(new Request("https://app.test/api/folhetos/pdf?url=" + encodeURIComponent("https://exemplo.pt/folheto"), { headers: { authorization: "Bearer pw" } }));
  assert.equal(bad.status, 415);
  globalThis.fetch = realFetch;
}
assert.equal((await call("DELETE", `/folhetos/${id}`)).json.ok, true);
assert.equal((await call("GET", `/folhetos/${id}`)).status, 404);
assert.ok(!(await db.get(L.LK.sets())).includes(F.liveSetId(id)), "live set removed");
console.log("API OK");

console.log("\n✅ testes folhetos passaram");
