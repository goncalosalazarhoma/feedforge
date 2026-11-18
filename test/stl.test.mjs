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

// ---- moodboard layout: stored, rendered, validated, exported
assert.equal(m.layout, "classic", "existing modules default to the classic layout");
assert.equal(cfg.layout, "classic"); assert.equal(cfg.actions, undefined, "classic config has no cart/wishlist actions");
let mb = (await call("POST", "/stl/modules", { name: "Moodboard Natal", layout: "moodboard", actions: { show: true, cartText: "x".repeat(80) }, image: { src: "https://img/mood.webp", alt: "Sala" }, products: ["473088", "474166", "474182", "474179"].map((id) => ({ id, pin: { x: 40, y: 50 } })) })).json;
assert.equal(mb.layout, "moodboard");
assert.equal((await call("GET", "/stl/modules")).json.find((x) => x.id === mb.id).layout, "moodboard", "layout in the module list");
assert.deepEqual([mb.actions.show, mb.actions.wishlistText, mb.actions.cartText.length], [true, "", 40], "actions sanitised");
assert.equal((await call("PUT", `/stl/modules/${mb.id}`, { ...mb, layout: "carousel3d" })).json.layout, "classic", "unknown layout falls back to classic");
mb = (await call("PUT", `/stl/modules/${mb.id}`, { ...mb, layout: "moodboard", actions: { show: false } })).json;
assert.equal(mb.actions.show, false);
const mcfg = (await call("GET", `/stl/render/${mb.id}`)).json;
assert.equal(mcfg.layout, "moodboard"); assert.equal(mcfg.actions.show, false);
assert.equal(mcfg.products.length, 4);
v = ctx.hstlValidate(mb, mcfg);
assert.equal(v.ok, true); assert.ok(!v.warnings.some((w) => /moodboard/.test(w)), "4 products: no layout warning");
v = ctx.hstlValidate({ ...mb, products: mb.products.slice(0, 3) }, { ...mcfg, products: mcfg.products.slice(0, 3) });
assert.ok(v.warnings.some((w) => /4 produtos.*espaço vazio/.test(w)), "odd count warns about the 2×2 grid");
const msnip = ctx.hstlSnippet({ css: ".hstl{}", js: "/*js*/", config: mcfg, name: "Mood" });
assert.equal(JSON.parse(msnip.match(/data-stl-config="[^"]+">([\s\S]*?)<\/script>/)[1]).layout, "moodboard", "layout travels in the exported config");
// widget: both layouts mount and the moodboard exposes setHandlers
const wjs = fs.readFileSync(new URL("../public/stl/widget.js", import.meta.url), "utf8");
assert.ok(/function mountMood/.test(wjs) && /setHandlers/.test(wjs) && /hstl:\$\{kind\}/.test(wjs), "moodboard renderer, handlers and DOM events present");
console.log("Moodboard OK");

// ---- visual editor (style overrides → CSS variables)
const SS = await import("../public/stl/style-schema.mjs");
assert.deepEqual(SS.sanitizeStyle({ "title-d": 46, "pad-top-d": 120.4, "gutter-d": 9999, headline: "#583D3E", "card-ratio": "7/3", bogus: 1, bg: "red" }, "moodboard"), { "pad-top-d": 120, "gutter-d": 200, headline: "#583d3e" }, "defaults dropped, clamped, invalid removed");
const vars = SS.styleVars({ "title-d": 60, "img-share": 60, "card-ratio": "1/1", "list-pad-d": 40 }, "moodboard");
assert.deepEqual(vars, { "--hstl-s-title-d": "60px", "--hstl-s-title-d-lh": "89px", "--hstl-s-img-fr": "60fr", "--hstl-s-grid-fr": "40fr", "--hstl-s-card-ratio": "1/1" }, "line-height follows the font size; classic-only fields not emitted for the moodboard");
for (const f of SS.FIELDS) for (const l of f.layouts) { const d = SS.defaultOf(f, l); assert.ok(d !== undefined, `${f.k} default for ${l}`); if (f.type === "ratio") assert.ok(f.options.some(([o]) => o === d), `${f.k} default is an option`); else if (f.type !== "color") assert.ok(d >= f.min && d <= f.max, `${f.k} default in range`); }
// every override has a matching var() in the widget CSS (so a field never does nothing)
const wcss = fs.readFileSync(new URL("../public/stl/widget.css", import.meta.url), "utf8");
for (const f of SS.FIELDS) { const names = f.k === "img-share" ? ["--hstl-s-img-fr", "--hstl-s-grid-fr"] : [`--hstl-s-${f.k}`]; for (const n of names) assert.ok(wcss.includes(`var(${n}`), `widget.css uses ${n}`); if (f.lh) assert.ok(wcss.includes(`var(--hstl-s-${f.k}-lh`), `widget.css uses --hstl-s-${f.k}-lh`); }
mb = (await call("PUT", `/stl/modules/${mb.id}`, { ...mb, style: { "grid-gap-x": 24, "btn-bg": "#583d3e", "title-d": 46, nope: 3 } })).json;
assert.deepEqual(mb.style, { "grid-gap-x": 24, "btn-bg": "#583d3e" }, "style stored sanitised");
const scfg = (await call("GET", `/stl/render/${mb.id}`)).json;
assert.deepEqual(scfg.vars, { "--hstl-s-grid-gap-x": "24px", "--hstl-s-btn-bg": "#583d3e" }, "render carries the CSS variables");
assert.deepEqual((await call("GET", `/stl/render/${m.id}`)).json.vars, {}, "no overrides → no variables");
assert.ok(/VAR_NAME = .*--hstl-s-/.test(wjs) && /applyVars\(root/.test(wjs), "widget whitelists the variables it applies");
console.log("Aparência OK");

console.log("\n✅ testes Shop the Look passaram");
