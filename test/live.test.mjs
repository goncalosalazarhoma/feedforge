// Local test for the live SFCC layer (folhetos): SLAS guest auth, Shopper Products, sets, alerts, overlay.
// Run: node test/live.test.mjs   (SFCC is mocked; nothing leaves the machine)
import assert from "node:assert/strict";
import { useMemoryStore, db, K } from "../netlify/lib/store.mjs";

useMemoryStore();
process.env.APP_PASSWORD = "pw";
process.env.SFCC_CLIENT_ID = "public-client";

// ---- SCAPI mock: PKCE guest login + getProducts (live PT data)
const LIVE = {
  Homa_PT: {
    "473088": { id: "473088", name: "Almofada SAVOY", price: 20, currency: "EUR", prices: { "pt-list": 20 }, productPromotions: [{ promotionId: "black-friday", promotionalPrice: 14 }], inventory: { ats: 5, orderable: true }, imageGroups: [{ viewType: "large", images: [{ link: "https://img/473088.jpg" }] }] },
    "474166": { id: "474166", name: "Quadro MONA", price: 30, currency: "EUR", inventory: { ats: 0, orderable: false } },
  },
  Homa_ES: { "473088": { id: "473088", name: "Cojín SAVOY", price: 20, currency: "EUR", inventory: { ats: 3, orderable: true } } },
};
const calls = [];
const mockFetch = async (url, opts = {}) => {
  const u = new URL(url);
  calls.push(`${opts.method || "GET"} ${u.pathname}`);
  if (u.pathname.endsWith("/oauth2/authorize")) {
    assert.equal(u.searchParams.get("hint"), "guest");
    assert.equal(u.searchParams.get("client_id"), "public-client");
    assert.ok(u.searchParams.get("code_challenge"));
    assert.equal(opts.redirect, "manual");
    return new Response(null, { status: 303, headers: { location: `https://www.homastores.com/callback?code=C-${u.searchParams.get("channel_id")}&usid=U1` } });
  }
  if (u.pathname.endsWith("/oauth2/token")) {
    const b = new URLSearchParams(opts.body);
    assert.equal(b.get("grant_type"), "authorization_code_pkce");
    assert.ok(b.get("code_verifier") && b.get("code").startsWith("C-"));
    return Response.json({ access_token: `T-${b.get("channel_id")}`, expires_in: 1800 });
  }
  if (u.pathname.includes("/shopper-products/")) {
    const site = u.searchParams.get("siteId");
    assert.equal(opts.headers.authorization, `Bearer T-${site}`);
    assert.ok(u.searchParams.get("ids").split(",").length <= 24, "max 24 ids per call");
    const data = u.searchParams.get("ids").split(",").map((id) => LIVE[site][id]).filter(Boolean);
    return data.length ? Response.json({ data, total: data.length }) : new Response("{}", { status: 404 });
  }
  throw new Error("unexpected " + url);
};

const S = await import("../netlify/lib/sfcc.mjs");
const L = await import("../netlify/lib/live.mjs");

// normalize: promo price wins, list price kept, stock / orderable
const n = S.normalizeProduct(LIVE.Homa_PT["473088"]);
assert.deepEqual([n.price, n.listPrice, n.stock, n.inStock, n.promotions[0].id, n.image], [14, 20, 5, true, "black-friday", "https://img/473088.jpg"]);
assert.equal(S.normalizeProduct(LIVE.Homa_PT["474166"]).inStock, false, "ats 0 / not orderable = esgotado");

// batching: 60 ids -> 3 calls of <= 24, missing reported
let r = await S.getProducts(["473088", "474166", ...Array.from({ length: 58 }, (_, i) => `x${i}`)], "pt", { fetchFn: mockFetch });
assert.equal(Object.keys(r.found).length, 2);
assert.equal(r.missing.length, 58);
assert.equal(calls.filter((c) => c.includes("shopper-products")).length, 3, "3 product calls");
assert.equal(calls.filter((c) => c.endsWith("/oauth2/token")).length, 1, "token reused (cached)");
console.log("SFCC OK");

// ---- sets: sanitize, validity window, alerts
assert.throws(() => L.sanitizeSet("x", { markets: ["fr"] }), /mercado/);
const set = L.sanitizeSet("folheto-natal", { name: "Natal", markets: ["pt", "es"], validFrom: "2026-11-20", validTo: "2026-12-24", items: [{ id: "473088", printedPrice: 15 }, { id: "474166", printedPrice: 30, market: "pt" }, { id: "999", printedPrice: 9 }, { id: "473088" }] });
assert.equal(set.items.length, 3, "duplicates removed");
assert.equal(L.isActive(set, new Date("2026-11-25T10:00:00Z")), true);
assert.equal(L.isActive(set, new Date("2026-12-25T10:00:00Z")), false, "expired");
assert.equal(L.isActive(set, new Date("2026-11-19T10:00:00Z")), false, "not yet published");
assert.equal(L.nextRunAt(new Date("2026-11-25T09:15:00Z")), "2026-11-25T10:00:00.000Z");

await db.set(L.LK.set(set.id), set);
await db.set(L.LK.sets(), [set.id]);
await db.set(L.LK.set("velho"), L.sanitizeSet("velho", { markets: ["pt"], validTo: "2020-01-01", items: [{ id: "474182" }] }));
await db.set(L.LK.sets(), [set.id, "velho"]);
calls.length = 0;
let st = await L.refreshLive({ fetchFn: mockFetch });
assert.equal(st.error, null, st.error);
assert.equal(st.sets, 1, "expired set ignored");
assert.ok(!calls.some((c) => c.includes("474182")), "no call for the expired set");
const d = await db.get(L.LK.data(set.id));
const types = d.alerts.map((a) => `${a.market}:${a.sku}:${a.type}`).sort();
assert.deepEqual(types, ["es:473088:price", "es:999:missing", "pt:473088:price", "pt:474166:oos", "pt:999:missing"], JSON.stringify(types));
assert.equal(d.newAlerts.length, 5, "first run: all new");
assert.equal(st.newAlerts[0].set, "folheto-natal");
st = await L.refreshLive({ fetchFn: mockFetch });
assert.equal((await db.get(L.LK.data(set.id))).newAlerts.length, 0, "same alerts: nothing new to report");
LIVE.Homa_PT["473088"].productPromotions[0].promotionalPrice = 12;
await L.refreshLive({ fetchFn: mockFetch });
assert.deepEqual((await db.get(L.LK.data(set.id))).newAlerts.map((a) => a.msg), ["Preço no site 12.00 € ≠ impresso 15.00 €"], "price changed → new alert");
console.log("Listas e alertas OK");

// ---- overlay: live data wins over the daily feed in the product search / blocks
const row = (id, o = {}) => ({ id, title: `Produto ${id}`, availability: "in stock", price: "20.00 EUR", sale_price: "", link: `https://x/${id}`, image_link: "", product_type: "Decoração > Almofadas", ...o });
await db.set(K.config("feed-pt"), { id: "feed-pt", name: "PT", language: "pt-PT" });
await db.set(K.output("feed-pt"), { meta: { headers: [], rows: [row("473088"), row("474166"), row("474182", { price: "12.00 EUR" })] }, gmc: { headers: [], rows: [] }, index: [], generatedAt: "2026-11-25T06:00:00Z" });
await db.set(K.feeds(), [{ id: "feed-pt" }]);
const P = await import("../netlify/lib/products.mjs");
const cat = await P.getCatalog("pt", { force: true });
const by = Object.fromEntries(cat.items.map((p) => [p.id, p]));
assert.deepEqual([by["473088"].price, by["473088"].salePrice, by["473088"].live], [20, 12, true], "live promo price");
assert.equal(by["474166"].inStock, false, "live: esgotado");
assert.equal(by["474182"].live, undefined, "not in a folheto: feed data");
assert.ok(cat.liveAt);
console.log("Prioridade sobre o feed OK");

// ---- API (with the real handler; SFCC env missing → clear error, nothing thrown)
const api = (await import("../netlify/functions/api.mjs")).default;
const call = async (method, path, body) => {
  const res = await api(new Request("https://app.test/api" + path, { method, headers: { authorization: "Bearer pw", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, json: JSON.parse(await res.text()) };
};
assert.equal((await call("GET", "/sfcc/status")).json.auth, "public (PKCE)");
const list = (await call("GET", "/live/sets")).json;
assert.deepEqual(list.map((s) => [s.id, s.active, s.alerts]), [["folheto-natal", true, 5], ["velho", false, 0]]);
assert.equal((await call("PUT", "/live/sets/Mau Id", { markets: ["pt"] })).status, 400);
const saved = (await call("PUT", "/live/sets/folheto-teste", { name: "Teste", markets: ["pt"], items: [{ id: "473088" }], refresh: false })).json;
assert.equal(saved.set.items.length, 1);
assert.equal((await call("GET", "/live/state")).json.everyHours, 2);
assert.equal((await call("DELETE", "/live/sets/folheto-teste")).json.ok, true);
assert.deepEqual((await call("GET", "/live/sets")).json.map((s) => s.id), ["folheto-natal", "velho"]);
delete process.env.SFCC_CLIENT_ID;
st = (await call("POST", "/live/refresh", {})).json;
assert.match(st.error, /SFCC_CLIENT_ID/, "missing env → error in the run state, not a crash");
console.log("API OK");

console.log("\n✅ testes live (SFCC) passaram");
