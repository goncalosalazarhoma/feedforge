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

// ---- render (export): static, tracking, nothing without a product
const html = renderFolheto(cfg, { css });
assert.ok(!/<script/i.test(html), "no JavaScript");
assert.ok(!/ style="/.test(html), "no inline styles");
assert.ok(html.includes(`data-ff-list-id="${listIdOf(cfg)}"`) && html.includes(`data-ff-list-name="${listNameOf(cfg)}"`));
assert.equal(listNameOf(cfg), "Folheto - Natal");
const links = [...html.matchAll(/<a class="hfol__(card|area)[^"]*" href="([^"]+)"([^>]*)>/g)];
assert.equal(links.length, 3, "473088 (dot), 474166 (area), 500 (dot) — 999 and the empty one are not exported");
assert.match(links[0][3], /data-item-id="473088" data-item-name="Almofada SAVOY" data-item-price="14.00" data-item-index="1" data-item-cat="Decoração &gt; Almofadas"/);
assert.ok(html.includes('data-ff-pin="473088"'));
assert.ok(html.includes("Esgotado"), "out of stock label");
assert.ok(html.includes("#hfol-natal .hfol__pg--1{aspect-ratio:0.7071}"));
assert.ok(html.includes('<h2 class="hfol__title">Ofertas de Natal</h2>'));
const noCss = (h) => h.replace(/<style>[\s\S]*?<\/style>/, "");
assert.ok(!noCss(html).includes("hfol__miss"));
const pv = renderFolheto(cfg, { css, preview: true, imageFor: (n) => `data:image/jpeg;base64,${n}` });
assert.equal((noCss(pv).match(/hfol__miss/g) || []).length, 2, "preview marks the hotspots without a product");
assert.ok(pv.includes('src="data:image/jpeg;base64,1"'));
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
assert.equal((await call("DELETE", `/folhetos/${id}`)).json.ok, true);
assert.equal((await call("GET", `/folhetos/${id}`)).status, 404);
assert.ok(!(await db.get(L.LK.sets())).includes(F.liveSetId(id)), "live set removed");
console.log("API OK");

console.log("\n✅ testes folhetos passaram");
