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
// static renderer (Page Designer Raw HTML: no JavaScript) — what the editor previews and exports
const R = await import("../public/stl/render.mjs");
const WCSS = fs.readFileSync(new URL("../public/stl/widget.css", import.meta.url), "utf8");
const evilCfg = { ...cfg, title: "</style><script>alert(1)</script>", products: cfg.products.map((p, i) => (i === 0 ? { ...p, name: '"><img src=x onerror=alert(2)>' } : p)), vars: { "--hstl-s-pad-top-d": "40px", "--hstl-s-x": "red;}body{display:none", "--evil": "1px" } };
const html = R.renderStl(evilCfg, { css: WCSS });
const snip = ctx.hstlSnippet({ html, name: "HP" });
assert.ok(!/<script/i.test(snip), "no <script> in the exported code");
assert.ok(!/\sstyle="/.test(snip), "no inline styles (positions and overrides live in the module <style>)");
assert.ok((snip.replace(/<style>[\s\S]*?<\/style>/, "").match(/<[a-z][^>]*>/gi) || []).every((t) => !/\son[a-z]+\s*=/i.test(t.replace(/"[^"]*"/g, '""'))), "no event handler attributes (text is escaped)");
assert.ok(snip.includes('id="hstl-stl-hp-outono-inverno"') && snip.includes('data-ff-list-id="stl_stl-hp-outono-inverno"'), "module id + GA4 list id");
assert.ok(snip.includes('data-ff-list-name="Shop the Look - HP · Outono/Inverno"'), "GA4 list name = module name");
assert.ok(!snip.includes("999999") && !snip.includes('data-item-id="453245"'), "missing and out-of-stock products are not exported");
assert.ok(snip.includes('data-item-id="473088"') && snip.includes('data-item-price="15.00"') && snip.includes('data-item-index="1"') && snip.includes('data-item-cat="Decoração &gt; Almofadas"'), "tracking attributes on the products");
assert.ok(snip.includes("#hstl-stl-hp-outono-inverno .hstl__pw--0{left:53%;top:59%"), "pin position as a module CSS rule");
assert.ok(snip.includes("--hstl-s-pad-top-d:40px") && !snip.includes("display:none}body") && !snip.includes("--evil"), "only whitelisted variables reach the CSS");
assert.ok(snip.includes("&lt;/style&gt;&lt;script&gt;") && snip.includes("&quot;&gt;&lt;img src=x onerror=alert(2)&gt;"), "texts escaped");
assert.ok(/#hstl-stl-hp-outono-inverno:has\(\.hstl__c--1:hover\) \.hstl__pw--1 \.hstl__pop/.test(snip), "card hover opens its pin's popover (CSS :has)");
assert.ok(snip.includes("hstl__hl--0 is-default"), "Color Block highlight for the default product");
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
const mhtml = R.renderStl({ ...mcfg, actions: { show: true } }, { css: WCSS });
assert.ok(mhtml.includes('class="hstl hstl--mood hstl--no-actions"'), "moodboard: cart/wishlist hidden on the site (no JS)");
assert.ok(R.renderStl({ ...mcfg, actions: { show: true } }, { css: "", preview: true }).includes('class="hstl hstl--mood"'), "preview shows the buttons");
assert.equal((mhtml.match(/class="hstl__mcard /g) || []).length, 4, "4 product cards");
assert.ok(mhtml.includes('data-hstl-action="cart" data-scope="all"'), "hooks for the storefront if it wires the cart later");
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
assert.ok(R.renderStl({ ...scfg }, { css: "" }).includes("#hstl-" + mb.id + "{--hstl-s-grid-gap-x:24px;--hstl-s-btn-bg:#583d3e}"), "overrides written as a module CSS rule");
console.log("Aparência OK");

// ---- pins / image cards: classic or design-system variants (Figma "Shop the Look Chips" / "Shop the Look Cards")
assert.deepEqual([m.pinStyle, m.cardStyle], ["classic", "classic"], "defaults to the classic pins and card");
let ds = (await call("PUT", `/stl/modules/${m.id}`, { ...m, pinStyle: "ds", cardStyle: "ds" })).json;
assert.deepEqual([ds.pinStyle, ds.cardStyle], ["ds", "ds"], "variants stored");
assert.deepEqual([(await call("PUT", `/stl/modules/${m.id}`, { ...ds, pinStyle: "neon", cardStyle: 1 })).json.pinStyle, (await call("GET", `/stl/modules/${m.id}`)).json.cardStyle], ["classic", "classic"], "unknown values fall back to classic");
ds = (await call("PUT", `/stl/modules/${m.id}`, { ...ds, pinStyle: "ds", cardStyle: "ds" })).json;
const dcfg = (await call("GET", `/stl/render/${m.id}`)).json;
assert.deepEqual([dcfg.pinStyle, dcfg.cardStyle], ["ds", "ds"], "render carries the variants");
const dhtml = R.renderStl(dcfg, { css: WCSS });
assert.ok(dhtml.includes('class="hstl hstl--classic hstl--pin-ds hstl--card-ds hstl--no-actions"'), "variant classes; card buttons hidden on the site (no JS)");
assert.ok(R.renderStl(dcfg, { css: "", preview: true }).includes('class="hstl hstl--classic hstl--pin-ds hstl--card-ds"'), "preview shows the card buttons");
assert.ok(/<span class="hstl__pop hstl__pop--ds"><a class="hstl__dsc" href="[^"]*" data-item-id="473088"/.test(dhtml), "card = link with the tracking attributes (no buttons inside the link)");
assert.ok(dhtml.includes('class="hstl__dsc-img"><img src=') && dhtml.includes('class="hstl__dsc-btn hstl__dsc-btn--cart" data-hstl-action="cart"'), "image + quick add hook");
assert.ok(!dhtml.replace(/<style>[\s\S]*?<\/style>/, "").includes("hstl__pop-cta"), "no text link in the design-system card");
assert.ok(dhtml.includes("--hstl-dot:var(--hstl-dot-on)") && !/\.hstl__pw--0 \.hstl__pin\{background:var\(--hstl-pin\)/.test(dhtml), "active pin rule uses the chip style");
assert.ok(!/<script/i.test(dhtml) && !/\sstyle="/.test(dhtml), "still Raw HTML (no script, no inline styles)");
const chtml = R.renderStl({ ...dcfg, pinStyle: "classic", cardStyle: "classic" }, { css: "" });
assert.ok(chtml.includes('class="hstl hstl--classic"') && chtml.includes("hstl__pop-cta"), "classic unchanged");
await call("PUT", `/stl/modules/${m.id}`, { ...ds, pinStyle: "classic", cardStyle: "classic" });
console.log("Pontos e cartões OK");

// tracking tag (lives in the site's GTM): valid JS, reads the same attributes the renderers write
const TJS = fs.readFileSync(new URL("../public/tracking/ff-tracking.js", import.meta.url), "utf8");
new vm.Script(TJS);
for (const a of ["data-ff-list-id", "data-ff-list-name", "data-item-id", "data-item-name", "data-item-price", "data-item-index", "data-item-cat", "data-ff-pin", "view_item_list", "select_item"]) assert.ok(TJS.includes(a), `tracking tag uses ${a}`);
// export-test.html: both layouts as they are exported (open on the dev site / locally to check)
const ET = new URL("../public/stl/export-test.html", import.meta.url);
const demo = (layout) => ({ ...cfg, id: `demo-${layout}`, name: `Demo ${layout}`, layout, title: "Coleção de Natal", eyebrow: "Shop the look", image: { src: "https://www.homastores.com/dw/image/v2/BFDH_PRD/on/demandware.static/-/Sites-Homa_PT-Library/default/dwd87779c6/home/shoplook/hp-shop-trend-image_solidcolor.webp?sw=1920&q=80", alt: "Sala decorada" }, products: cfg.products.filter((p) => !p.missing && !p.oos).slice(0, 4) });
const exNames = ["Demo clássico", "Demo moodboard", "Demo design system (pontos + cartões)"];
const exHtml = [R.renderStl(demo("classic"), { css: WCSS }), R.renderStl(demo("moodboard"), { css: WCSS }), R.renderStl({ ...demo("classic"), id: "demo-ds", name: "Demo design system", pinStyle: "ds", cardStyle: "ds" }, { css: WCSS })].map((h, i) => ctx.hstlSnippet({ html: h, name: exNames[i] }).replace(/ gerado pelo FeedForge em [0-9: -]+/, ""));
if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(ET) || /HomaShopTheLook/.test(fs.readFileSync(ET, "utf8"))) {
  fs.writeFileSync(ET, `<!doctype html>\n<html lang="pt">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Shop the Look · teste do código exportado</title>\n<style>body{margin:0;font-family:Gilroy,"Helvetica Neue",Arial,sans-serif}</style>\n</head>\n<body>\n<!-- Cada bloco abaixo é exatamente o que o "Gerar código" produz (Raw HTML: HTML + CSS, sem JavaScript) -->\n${exHtml.join("\n<div style=\"height:80px\"></div>\n")}\n</body>\n</html>\n`);
  console.log("export-test.html escrito");
}
assert.ok(exHtml.every((h) => fs.readFileSync(ET, "utf8").includes(h)), "export-test.html = current renderer output (UPDATE_SNAPSHOTS=1 to rewrite)");
console.log("Tracking OK");

console.log("\n✅ testes Shop the Look passaram");
