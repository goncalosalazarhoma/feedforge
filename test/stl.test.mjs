// Local test for Shop the Look (feed search, modules, render, export). Run: node test/stl.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { useMemoryStore, db, K } from "../netlify/lib/store.mjs";

useMemoryStore();
process.env.APP_PASSWORD = "pw";

const row = (id, o = {}) => ({ id, title: `Produto ${id}`, description: "Desc", availability: "in stock", price: "10.00 EUR", sale_price: "", link: `https://www.homastores.com/pt/pt/p-${id}.html`, image_link: `https://img/${id}.jpg`, gtin: "", product_type: "Decoração > Almofadas", color: "Branco", material: "Algodão", brand: "hôma", custom_label_3: "standard", ...o });
const pt = [
  row("473088", { title: "Almofada SAVOY 35x50cm", price: "20.00 EUR", sale_price: "15.00 EUR", gtin: "03560239512345", color: "Multicolor" }),
  row("474166", { title: "Quadro decorativo mulher MONA 58x78cm", price: "30.00 EUR", product_type: "Decoração > Quadros", color: "Preto", material: "Madeira" }),
  row("474182", { title: "Cesto CYRIELLE 29x27cm", price: "12.00 EUR", product_type: "Arrumação > Cestos", material: "Vime", custom_label_3: "online_exclusive" }),
  row("453245", { title: "Tapete TOUL natural 120x160cm", price: "59.00 EUR", product_type: "Têxteis > Tapetes", availability: "out of stock" }),
  row("474179", { title: "Centro de mesa MONA 23cm", price: "8.00 EUR", product_type: "Decoração > Centros de mesa" }),
];
const es = [row("473088", { title: "Cojín SAVOY 35x50cm", link: "https://www.homastores.com/es/es/p-473088.html", product_type: "Decoración > Cojines" })];
for (const [id, language, rows] of [["feed-homa-pt", "pt-PT", pt], ["homa-es", "es-ES", es]]) {
  await db.set(K.config(id), { id, name: id, language });
  await db.set(K.output(id), { meta: { headers: Object.keys(rows[0]), rows }, gmc: { headers: [], rows: [] }, index: [], generatedAt: "2026-11-05T08:00:00.000Z" });
}
await db.set(K.feeds(), [{ id: "feed-homa-pt" }, { id: "homa-es" }]);

const api = (await import("../netlify/functions/api.mjs")).default;
const call = async (method, path, body) => {
  const r = await api(new Request("https://app.test/api" + path, { method, headers: { authorization: "Bearer pw", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, json: JSON.parse(await r.text()) };
};
const search = async (params) => (await call("GET", "/stl/products?" + new URLSearchParams(params))).json;

// ---- search: ID, EAN (leading zeros), accent-insensitive partial title, category drill-down, filters
assert.deepEqual((await search({ q: "474166" })).items.map((p) => p.id), ["474166"]);
assert.deepEqual((await search({ q: "3560239512345" })).items.map((p) => p.id), ["473088"], "EAN without leading zero");
assert.deepEqual((await search({ q: "almofáda sav" })).items.map((p) => p.id), ["473088"], "accent-insensitive partial");
assert.deepEqual((await search({ q: "mona" })).items.map((p) => p.id).sort(), ["474166", "474179"]);
let r = await search({ category: "Decoração" });
assert.equal(r.total, 3);
assert.deepEqual((await search({ category: "Decoração", subcategory: "Quadros" })).items.map((p) => p.id), ["474166"]);
assert.equal((await search({})).total, 4, "out of stock hidden by default");
assert.equal((await search({ filters: JSON.stringify({ inStock: false }) })).total, 5);
assert.deepEqual((await search({ filters: JSON.stringify({ sale: true }) })).items.map((p) => p.id), ["473088"]);
assert.deepEqual((await search({ filters: JSON.stringify({ priceMin: 9, priceMax: 14 }) })).items.map((p) => p.id), ["474182"], "price uses the sale price");
assert.deepEqual((await search({ filters: JSON.stringify({ attrs: { material: ["Vime"] } }) })).items.map((p) => p.id), ["474182"]);
r = await search({});
assert.ok(r.facets.color && r.facets.material && r.facets.custom_label_3, "low-cardinality facets");
assert.equal(r.items.find((p) => p.id === "473088").salePrice, 15);
const cats = (await call("GET", "/stl/categories?market=pt")).json;
assert.equal(cats.children[0].name, "Decoração"); assert.equal(cats.children[0].count, 3);
assert.deepEqual(cats.children[0].children.map((c) => c.name).sort(), ["Almofadas", "Centros de mesa", "Quadros"]);
assert.equal((await search({ market: "es", q: "cojin" })).items[0].link, "https://www.homastores.com/es/es/p-473088.html", "ES feed");
console.log("Pesquisa OK");

// ---- modules: create, list, get, update, duplicate, delete; only references are stored
let m = (await call("POST", "/stl/modules", { name: "HP · Outono/Inverno", market: "pt", image: { src: "https://img/hero.webp", alt: "Sala" }, products: [{ id: "473088", name: "should be dropped", price: 1, pin: { x: 53, y: 59 }, badges: [{ label: "Exclusivo online", tone: "brand" }, { label: "x", tone: "neon" }] }, { id: "474166", pin: { x: 140, y: -3 } }] })).json;
assert.equal(m.id, "stl-hp-outono-inverno");
assert.equal(m.products[0].name, undefined, "no product data stored");
assert.deepEqual(m.products[0].badges, [{ label: "Exclusivo online", tone: "brand" }, { label: "x" }]);
assert.deepEqual(m.products[1].pin, { x: 100, y: 0, show: true }, "pins clamped to 0–100");
m = (await call("PUT", `/stl/modules/${m.id}`, { ...m, title: "Coleção de Outono/Inverno", products: [...m.products, { id: "453245" }, { id: "999999" }] })).json;
assert.equal(m.title, "Coleção de Outono/Inverno");
assert.equal((await call("GET", "/stl/modules")).json.length, 1);
const dup = (await call("POST", `/stl/modules/${m.id}/duplicate`)).json;
assert.equal(dup.id, "stl-hp-outono-inverno-copia"); assert.equal(dup.status, "draft");
assert.equal((await call("GET", "/stl/modules")).json.length, 2);
await call("DELETE", `/stl/modules/${dup.id}`);
assert.equal((await call("GET", "/stl/modules")).json.length, 1);
assert.equal((await call("GET", `/stl/modules/${dup.id}`)).status, 404);
console.log("Módulos OK");

// ---- render: hydrated from the current feed, missing / out of stock flagged
const cfg = (await call("GET", `/stl/render/${m.id}`)).json;
const byId = Object.fromEntries(cfg.products.map((p) => [p.id, p]));
assert.deepEqual([byId["473088"].price, byId["473088"].listPrice, byId["473088"].name], [15, 20, "Almofada SAVOY 35x50cm"]);
assert.equal(byId["453245"].oos, true);
assert.equal(byId["999999"].missing, true);
assert.equal(cfg.locale, "pt-PT");
const cfgEs = (await call("GET", `/stl/render/${m.id}?market=es`)).json;
assert.equal(cfgEs.products.find((p) => p.id === "473088").name, "Cojín SAVOY 35x50cm");
console.log("Render OK");

// ---- export helpers (same file the editor loads)
const ctx = {};
vm.runInNewContext(fs.readFileSync(new URL("../public/stl/snippet.js", import.meta.url), "utf8"), ctx);
let v = ctx.hstlValidate(m, cfg);
assert.equal(v.ok, false); assert.ok(v.errors.some((e) => e.includes("999999"))); assert.ok(v.warnings.some((w) => w.includes("453245")));
const okMod = { ...m, products: m.products.filter((p) => p.id !== "999999") };
v = ctx.hstlValidate(okMod, { ...cfg, products: cfg.products.filter((p) => !p.missing) });
assert.equal(v.ok, true);
assert.equal(ctx.hstlValidate({ ...okMod, image: { src: "" } }, cfg).ok, false, "image required");
assert.equal(ctx.hstlValidate({ ...okMod, products: okMod.products.slice(0, 1) }, cfg).ok, false, "2 products minimum");
const snip = ctx.hstlSnippet({ css: ".hstl{}", js: "/*js*/", config: { ...cfg, title: "</script><b>" }, name: "HP" });
assert.ok(snip.includes('<section class="hstl" data-stl-id="stl-hp-outono-inverno"'));
assert.ok(!snip.includes("</script><b>"), "config JSON is escaped inside the script tag");
const json = JSON.parse(snip.match(/data-stl-config="[^"]+">([\s\S]*?)<\/script>/)[1]);
assert.ok(!json.products.some((p) => p.missing), "missing products not exported");
console.log("Export OK");

console.log("\n✅ testes Shop the Look passaram");
