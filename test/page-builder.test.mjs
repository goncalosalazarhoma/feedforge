// Page Builder tests: renderer snapshots, output contract, schema validation, XSS, generation (mocked Claude), API.
// Run: node test/page-builder.test.mjs        (UPDATE_SNAPSHOTS=1 rewrites test/snapshots/page-builder-blocks.json)
import assert from "node:assert/strict";
import fs from "node:fs";
import { useMemoryStore, db, K } from "../netlify/lib/store.mjs";
import * as E from "../public/page-builder/engine.mjs";

useMemoryStore();
process.env.APP_PASSWORD = "pw";
process.env.ANTHROPIC_API_KEY = "test-key";

// ------------------------------------------------------------------ fixtures (same shape as the STL test)
const row = (id, o = {}) => ({ id, title: `Produto ${id}`, description: "Desc", availability: "in stock", price: "10.00 EUR", sale_price: "", link: `https://www.homastores.com/pt/pt/p-${id}.html`, image_link: `https://img.test/${id}.jpg`, gtin: "", product_type: "Decoração > Almofadas", color: "Branco", material: "Algodão", brand: "hôma", custom_label_3: "standard", ...o });
const pt = [
  row("473088", { title: "Almofada SAVOY 35x50cm", price: "20.00 EUR", sale_price: "15.00 EUR", gtin: "03560239512345" }),
  row("474166", { title: "Quadro decorativo mulher MONA 58x78cm", price: "30.00 EUR", product_type: "Decoração > Quadros" }),
  row("474182", { title: "Cesto CYRIELLE 29x27cm", price: "12.00 EUR", product_type: "Arrumação > Cestos", custom_label_3: "online_exclusive" }),
  row("453245", { title: "Tapete TOUL natural 120x160cm", price: "59.00 EUR", product_type: "Têxteis > Tapetes", availability: "out of stock" }),
  row("474179", { title: "Centro de mesa MONA 23cm", price: "8.00 EUR", product_type: "Decoração > Centros de mesa" }),
  ...Array.from({ length: 10 }, (_, i) => row(String(480000 + i), { title: `Almofada lisa ${i}`, price: `${10 + i}.00 EUR`, sale_price: i % 2 ? `${8 + i}.00 EUR` : "" })),
];
const index = pt.map((r, i) => ({ id: r.id, firstSeen: i === 0 ? new Date().toISOString() : "2025-01-01T00:00:00.000Z" }));
await db.set(K.config("feed-homa-pt"), { id: "feed-homa-pt", name: "PT", language: "pt-PT" });
await db.set(K.output("feed-homa-pt"), { meta: { headers: Object.keys(pt[0]), rows: pt }, gmc: { headers: [], rows: [] }, index, generatedAt: "2026-11-05T08:00:00.000Z" });
await db.set(K.feeds(), [{ id: "feed-homa-pt" }]);

const SNAP = new URL("./snapshots/page-builder-blocks.json", import.meta.url);
const sampleProducts = E.SAMPLE_PRODUCTS.concat(E.SAMPLE_PRODUCTS).slice(0, 8);

// ------------------------------------------------------------------ 1. every block: schema-valid sample, desktop+mobile CSS, snapshot
const snaps = {};
for (const t of E.BLOCK_TYPES) {
  const b = E.sampleBlock(t);
  const { id, ...forSchema } = b;
  assert.deepEqual(E.validateSchema(E.blockSchema(t), forSchema), [], `sample ${t} matches its schema`);
  const el = E.normalizeElement({ id: `snap-${t}`, name: t, market: "pt", blocks: [b] });
  const { html } = E.renderElement(el, { products: Object.fromEntries(E.productSlots(el).map((sl) => [sl.key, sampleProducts])) });
  assert.ok(html.includes(`data-hpb-block="${t}"`), `${t} rendered`);
  assert.ok(/@media \(max-width:767px\)/.test(html), `${t} has a mobile rule`);
  snaps[t] = html;
}
if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(SNAP)) {
  fs.mkdirSync(new URL("./snapshots/", import.meta.url), { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify(snaps, null, 1) + "\n");
  console.log("snapshots escritos");
} else {
  const saved = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  for (const t of E.BLOCK_TYPES) assert.equal(snaps[t], saved[t], `snapshot ${t} mudou (UPDATE_SNAPSHOTS=1 se foi intencional)`);
}
console.log(`Blocos OK (${E.BLOCK_TYPES.length} tipos, snapshots)`);

// ------------------------------------------------------------------ 2. output contract on the example element
const example = E.normalizeElement({
  id: "pb-hp-natal", name: "HP Natal", market: "pt", page: "homepage",
  blocks: [
    { id: "b-tiles", type: "image-tiles", props: { columns: 4 }, items: [1, 2, 3, 4].map((i) => ({ image: { src: E.SAMPLE_PRODUCTS[i].image.replace("sw=570", "sw=640"), alt: E.SAMPLE_PRODUCTS[i].name }, title: ["Sala de estar", "Quarto", "Cozinha", "Casa de banho"][i - 1], linkLabel: "Ver produtos", url: { url: `/natal/${i}` } })) },
    { id: "b-text", type: "text-block", props: { title: "Um Natal à sua medida", html: "<p>Texto <strong>forte</strong> e <a href=\"/natal\">link</a>.</p>" } },
    { id: "b-head", type: "section-heading", props: { eyebrow: "Promoções", title: "Almofadas em promoção" } },
    { id: "b-grid", type: "product-grid", props: { title: "", limit: 8, productSource: { mode: "rule", category: "Decoração", subcategory: "Almofadas", onSale: true } } },
  ],
});
const { exportElement, hydrateElement, staleness, generate, PBK } = await import("../netlify/lib/page-builder.mjs");
const hyd = await hydrateElement(example);
const gridId = example.blocks[3].id;
assert.ok(hyd.products[gridId].length >= 1 && hyd.products[gridId].every((p) => p.listPrice > p.price), "rule onSale resolved from the feed");
const out = await exportElement(example, { save: false });
assert.equal(out.check.ok, true, out.check.errors.join("; "));
const h = out.html;
assert.ok(h.startsWith('<div class="hpb" id="hpb-pb-hp-natal" data-hpb-version="1"'), "root contract");
assert.equal((h.match(/<style>/g) || []).length, 1, "a single <style>");
assert.ok(!/<script/i.test(h), "no script");
assert.ok((h.match(/<[a-z][^>]*>/gi) || []).every((t) => !/\son[a-z]+\s*=/i.test(t.replace(/"[^"]*"/g, "\"\""))), "no inline event handlers");
assert.ok(!/\sstyle="/i.test(h), "no inline styles in the export");
assert.ok(!/<(iframe|form|link|h1)[\s>]/i.test(h) && !/@font-face|@import/i.test(h), "no iframe/form/link/h1/@font-face");
const css = h.slice(h.indexOf("<style>") + 7, h.indexOf("</style>"));
const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0]).filter((s) => s.trim());
for (const sel of selectors.flatMap((s) => s.split(","))) assert.ok(sel.trim().startsWith("#hpb-pb-hp-natal"), `selector scoped: ${sel}`);
for (const img of h.match(/<img[^>]*>/g)) assert.ok(/ alt="[^"]+"/.test(img) && /loading="(lazy|eager)"/.test(img) && /decoding="async"/.test(img) && /width="\d+"/.test(img) && /height="\d+"/.test(img), `img contract: ${img}`);
for (const [, href] of h.matchAll(/href="([^"]+)"/g)) assert.ok(href.startsWith("https://www.homastores.com/pt/pt/"), `link absolute: ${href}`);
assert.equal((h.match(/<h2/g) || []).length, 2, "one h2 per titled block (text-block + section-heading)");
assert.ok(/data-hpb-block="product-grid" data-hpb-index="3"/.test(h) && /data-item-id="\d+" data-item-name="[^"]+" data-item-price="\d+\.\d\d"/.test(h), "tracking attributes");
assert.ok(h.includes("15,00 €") && h.includes("-25%"), "pt-PT prices + discount");
console.log("Contrato do HTML OK");

// ------------------------------------------------------------------ 3. malicious input is escaped or rejected
const evil = E.normalizeElement({
  id: "pb-x\"><script>", market: "pt",
  blocks: [
    { type: "section-heading", props: { title: '<img src=x onerror="alert(1)">', text: "</style><script>alert(2)</script>", link: { label: "Clica", url: "javascript:alert(3)" } } },
    { type: "text-block", props: { html: '<p onclick="x()">ok</p><script>alert(4)</script><img src=x onerror=alert(5)><a href="javascript:alert(6)">a</a><a href="https://evil.test/">b</a><a href="/ok" onmouseover="y()">c</a><iframe src="https://evil.test"></iframe><h1>t</h1>' } },
    { type: "hero-banner", props: { title: "x", image: { src: "javascript:alert(7)", alt: "\"><b>" }, cta: { label: "Ir", url: "https://evil.test/phish" } } },
    { type: "product-grid", props: { productSource: { mode: "manual", ids: ["1"] } } },
  ],
});
const evilProducts = { [evil.blocks[3].id]: [{ id: '1"><script>', name: '"><img src=x onerror=alert(8)>', description: "<b>d</b>", url: "javascript:alert(9)", image: "https://img.test/a.jpg", price: 1, listPrice: null, badges: [{ label: "<i>x</i>" }] }] };
const ev = E.renderElement(evil, { products: evilProducts });
assert.ok(!/<script/i.test(ev.html), "no script tag survives");
const tagsOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/, "").match(/<[a-z][^>]*>/gi) || [];
assert.ok(tagsOf(ev.html).every((t) => !/\son[a-z]+\s*=/i.test(t.replace(/"[^"]*"/g, "\"\""))), "no event handler attributes (text is escaped)");
assert.ok(!/javascript:/i.test(ev.html), "no javascript: URLs");
assert.ok(!/evil\.test/.test(ev.html), "no foreign links");
assert.ok(!/<iframe|<h1/i.test(ev.html), "no iframe / h1 from rich text");
assert.ok(ev.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), "title escaped as text");
assert.ok(ev.html.includes('id="hpb-pb-x-script"'), "element id sanitised");
assert.ok(ev.html.includes('<a href="https://www.homastores.com/pt/pt/ok">c</a>'), "safe internal link kept, handler dropped");
const evCheck = E.checkElement(evil, evilProducts, ev.html);
assert.equal(evCheck.ok, false);
assert.ok(evCheck.errors.some((e) => /protocolo não permitido/.test(e)), "javascript: link rejected");
assert.ok(evCheck.errors.some((e) => /homastores\.com/.test(e)), "foreign link rejected");
assert.ok(evCheck.errors.some((e) => /https/.test(e)), "non-https image rejected");
assert.equal(E.normalizeUrl("/natal", "es").url, "https://www.homastores.com/es/es/natal");
assert.ok(E.normalizeUrl("https://homastores.com/pt/pt/x", "es").warn, "other market warns");
console.log("Entradas maliciosas OK");

// ------------------------------------------------------------------ 4. schema validation
const bad = { name: "x", blocks: [{ type: "video", props: {} }, { type: "hero-banner", props: { textPosition: "top", title: "x".repeat(200) } }] };
const errs = E.validateSchema(E.elementSchema(), bad);
assert.ok(errs.some((e) => /type "video" não existe/.test(e)), "unknown block type");
assert.ok(errs.some((e) => /textPosition/.test(e)) && errs.some((e) => /mais de 70/.test(e)) && errs.some((e) => /image: obrigatório/.test(e)), "enum / maxLength / required");
const norm = E.normalizeElement(bad);
assert.equal(norm.blocks.length, 1, "unknown block dropped by normalisation");
assert.equal(norm.blocks[0].props.textPosition, "left");
assert.ok(norm.notes[0].includes("video"));
console.log("Schema OK");

// ------------------------------------------------------------------ 4b. compositions (design-system primitives)
// every library block opens as a composition that renders, passes the checks and validates against the schema
for (const t of E.BLOCK_TYPES.filter((x) => x !== "composition")) {
  const b = E.normalizeBlock(E.sampleBlock(t));
  const c = E.blockToComposition(b);
  assert.equal(c.type, "composition", `${t} converts`);
  assert.equal(c.id, b.id, `${t}: block id kept`);
  for (const k of Object.keys(E.COMMON)) assert.deepEqual(c.props[k], b.props[k], `${t}: common prop ${k} kept`);
  const { id, ...forSchema } = c;
  const ids = []; E.walkNodes(c.props.tree, (n) => ids.push(n.id));
  assert.equal(new Set(ids).size, ids.length, `${t}: node ids unique`);
  const stripIds = JSON.parse(JSON.stringify(forSchema, (k, v) => (k === "id" ? undefined : v)));
  assert.deepEqual(E.validateSchema(E.blockSchema("composition"), stripIds), [], `${t} composition matches the schema`);
  const el = E.normalizeElement({ id: `cv-${t}`, market: "pt", blocks: [c] });
  const prods = Object.fromEntries(E.productSlots(el).map((sl) => [sl.key, sampleProducts]));
  const { html } = E.renderElement(el, { products: prods });
  assert.ok(html.includes('data-hpb-block="composition"'), `${t} composition rendered`);
  const ck = E.checkElement(el, prods, html);
  assert.deepEqual(ck.errors, [], `${t} composition passes the checks`);
  assert.ok(ck.warnings.some((w) => /composição nova/.test(w)), `${t}: flagged as new composition`);
}
// product slots: library blocks keep the block id, product nodes get blockId:nodeId
const mixed = E.normalizeElement({ id: "mx", market: "pt", blocks: [
  { id: "g1", type: "product-grid", props: { productSource: { mode: "manual", ids: ["1"] } } },
  { id: "c1", type: "composition", props: { tree: { kind: "row", cols: 2, children: [{ kind: "products", id: "pa", limit: 2, productSource: { mode: "manual", ids: ["2", "3"] } }, { kind: "products", id: "pb", limit: 3, layout: "scroll", productSource: { mode: "rule", category: "Decoração" } }] } } },
] });
assert.deepEqual(E.productSlots(mixed).map((x) => [x.key, x.limit]), [["g1", 8], ["c1:pa", 2], ["c1:pb", 3]], "product slots");
assert.equal(E.productSlots(mixed)[2].source.limit, 3, "rule limit follows the node limit");
// limits: depth, node count, children, one h2 per block, unknown kinds dropped
let deep = { kind: "text", text: "fundo" };
for (let i = 0; i < 8; i++) deep = { kind: "stack", children: [deep] };
let depth = 0; E.walkNodes(E.normalizeNode(deep), (n, path) => (depth = Math.max(depth, path.length)));
assert.ok(depth <= 4, `max depth (got ${depth})`);
const wide = E.normalizeNode({ kind: "stack", children: Array.from({ length: 40 }, () => ({ kind: "row", children: Array.from({ length: 12 }, () => ({ kind: "spacer" })) })) });
let count = 0; E.walkNodes(wide, () => count++);
assert.ok(count <= 80 && wide.children.length <= 12, `node caps (got ${count})`);
const hs = E.normalizeBlock({ type: "composition", props: { tree: { kind: "stack", children: [{ kind: "text", text: "A", level: "h2" }, { kind: "text", text: "B", level: "h2" }, { kind: "video", src: "x" }] } } });
assert.deepEqual(hs.props.tree.children.map((n) => n.level), ["h2", "h3"], "extra h2 demoted, unknown kind dropped");
// schema: $ref recursion is validated, bad kinds / enums caught
const cerrs = E.validateSchema(E.singleBlockSchema(), { block: { type: "composition", props: { tree: { kind: "stack", children: [{ kind: "panel", bg: "pink", children: [] }, { kind: "marquee" }] } } } });
assert.ok(cerrs.length >= 2 && cerrs.some((e) => /bg/.test(e)) && cerrs.some((e) => /marquee|kind/.test(e)), `nested schema errors: ${cerrs.join(" | ")}`);
assert.ok(E.elementSchema().$defs.node.anyOf.length === E.PRIM_KINDS.length, "element schema carries the node $defs");
// malicious input inside a composition
const evilC = E.normalizeElement({ id: "evc", market: "pt", blocks: [{ type: "composition", props: { tree: { kind: "panel", bg: "image", image: { src: "http://evil.test/a.jpg", alt: "" }, link: { url: "javascript:alert(1)" }, children: [
  { kind: "text", text: "</style><script>alert(2)</script>", level: "h2" },
  { kind: "richtext", html: '<p onclick="x()">ok</p><img src=x onerror=alert(3)><a href="https://evil.test/">b</a>' },
  { kind: "button", label: '"><img src=x onerror=alert(4)>', url: { url: "https://evil.test/phish" } },
  { kind: "image", image: { src: "javascript:alert(5)", alt: "x" } },
] } } }] });
const evc = E.renderElement(evilC, {});
assert.ok(!/<script/i.test(evc.html) && !/javascript:/i.test(evc.html) && !/evil\.test/.test(evc.html), "composition: no script / javascript: / foreign hosts");
assert.ok(tagsOf(evc.html).every((t) => !/\son[a-z]+\s*=/i.test(t.replace(/"[^"]*"/g, "\"\""))), "composition: no event handlers");
assert.ok(!/<a [^>]*>[^<]*<a /.test(evc.html), "no nested anchors (panel link is an overlay)");
const evcCheck = E.checkElement(evilC, {}, evc.html);
assert.equal(evcCheck.ok, false, "composition: unsafe content blocks export");
console.log("Composições OK");

// ------------------------------------------------------------------ 5. generation (mocked Claude: invalid first answer → retry → valid)
const calls = [];
const exampleAnswer = {
  name: "Grelha + texto + produtos",
  blocks: [
    { type: "image-tiles", props: { columns: 4 }, items: [1, 2, 3, 4].map((i) => ({ image: { src: "", alt: `Ambiente ${i}`, description: "Sala acolhedora" }, title: `Estilo ${i}`, linkLabel: "Ver produtos", url: { url: "" } })) },
    { type: "text-block", props: { title: "Inspire-se", html: "<p>Ideias para a sua casa.</p>" } },
    { type: "section-heading", props: { eyebrow: "Seleção", title: "Os nossos favoritos" } },
    { type: "product-grid", props: { title: "", limit: 8, productSource: { mode: "rule", category: "Decoração", subcategory: "Almofadas", onSale: false, sort: "feed_order", limit: 8 } } },
  ],
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, o) => {
  if (!String(url).includes("api.anthropic.com")) return realFetch(url, o);
  const body = JSON.parse(o.body);
  calls.push(body);
  let input;
  if (body.tools[0].name === "emit_block") input = { block: { type: "section-heading", props: { title: "Título mais curto", eyebrow: "Seleção" } } };
  else if (calls.length === 1) input = { name: "x", blocks: [{ type: "image-tiles", props: { columns: 9 }, items: [] }] }; // invalid
  else if (/COMPOSICAO/.test(JSON.stringify(body.messages))) input = { name: "Nova", blocks: [{ type: "composition", props: { tree: E.SAMPLE_TREE } }] };
  else if (/Inexistente/.test(JSON.stringify(body.messages))) input = { ...exampleAnswer, blocks: [{ ...exampleAnswer.blocks[3], props: { ...exampleAnswer.blocks[3].props, productSource: { mode: "rule", category: "Inexistente" } } }] };
  else input = exampleAnswer;
  return new Response(JSON.stringify({ content: [{ type: "tool_use", id: `tu_${calls.length}`, name: body.tools[0].name, input }], usage: { input_tokens: 9000, output_tokens: 1200 }, stop_reason: "tool_use" }));
};
const prompt = "grelha de 4 imagens com link e CTA, depois um título + texto, e no fim um título e uma grelha de 8 produtos";
const g = await generate({ prompt, market: "pt", page: "homepage", author: "Gonçalo" });
assert.equal(calls.length, 2, "retried once after schema errors");
assert.equal(calls[0].model, "claude-sonnet-4-5", "Sonnet for layout");
assert.equal(calls[0].tool_choice.name, "emit_element");
assert.ok(calls[0].system.includes("Decoração · ") && calls[0].system.includes("Almofadas"), "real category tree in the prompt");
assert.ok(calls[0].system.includes('"você"'), "PT tone");
assert.ok(calls[1].messages.at(-1).content[0].is_error, "tool_result error sent back");
assert.deepEqual(g.element.blocks.map((b) => b.type), ["image-tiles", "text-block", "section-heading", "product-grid"], "example prompt → expected blocks");
assert.equal(g.element.blocks[0].items.length, 4);
assert.equal(g.element.blocks[3].props.limit, 8);
assert.ok(!g.notes.some((n) => /formato/.test(n)), "the retry fixed the format (no note)");
const blockRefine = await generate({ current: { ...g.element, id: "pb-1" }, blockId: g.element.blocks[2].id, instruction: "título mais curto", copyOnly: true });
assert.equal(calls.at(-1).model, "claude-haiku-4-5", "Haiku for copy-only refinements");
assert.equal(blockRefine.element.blocks[2].props.title, "Título mais curto");
assert.equal(blockRefine.element.blocks[2].id, g.element.blocks[2].id, "block id kept");
assert.deepEqual(blockRefine.element.blocks.map((b) => b.id), g.element.blocks.map((b) => b.id), "other blocks untouched");
assert.ok(blockRefine.diff.length === 1 && /Título de secção/.test(blockRefine.diff[0]), `diff: ${blockRefine.diff}`);
calls.length = 1; // skip the invalid-first branch
const badCat = await generate({ prompt: "8 produtos da categoria Inexistente", market: "pt" });
assert.equal(badCat.element.blocks[0].props.productSource.category, "", "category outside the feed tree is cleared");
assert.ok(badCat.notes.some((n) => n.includes("Inexistente")));
// the model may answer with a composition (new element) → normalised, rendered, flagged
calls.length = 1;
const compGen = await generate({ prompt: "COMPOSICAO hero com dois botões e 3 cartões glass", market: "pt" });
assert.equal(compGen.element.blocks[0].type, "composition");
assert.ok(calls.at(-1).system.includes("Primitivas do design system"), "primitives in the prompt");
assert.ok(calls.at(-1).tools[0].input_schema.$defs?.node, "tool schema carries $defs");
assert.ok(E.checkElement(compGen.element, {}, "").warnings.some((w) => /composição nova/.test(w)));
const log = await db.get(PBK.log());
assert.ok(log.length >= 3 && log[0].tokensIn > 0 && log[0].model && log[0].ms >= 0, "generations logged");
console.log("Geração OK");

// ------------------------------------------------------------------ 6. API: shared products, elements, versions, export, stale flag, jobs
const api = (await import("../netlify/functions/api.mjs")).default;
const call = async (method, path, body) => {
  const r = await api(new Request("https://app.test/api" + path, { method, headers: { authorization: "Bearer pw", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, json: JSON.parse(await r.text()) };
};
const s1 = (await call("GET", "/products?q=almofáda%20sav")).json;
assert.deepEqual(s1.items.map((p) => p.id), ["473088"], "shared search: accent-insensitive");
assert.deepEqual((await call("GET", "/products?q=3560239512345")).json.items.map((p) => p.id), ["473088"], "EAN");
assert.equal((await call("GET", "/products?onSale=1&category=Decora%C3%A7%C3%A3o")).json.items.every((p) => p.salePrice), true, "flat onSale filter");
assert.deepEqual((await call("GET", "/products?material=Algod%C3%A3o&priceMax=9")).json.items.map((p) => p.id), ["474179", "480001"], "flat material + priceMax");
assert.equal((await call("GET", "/products?inStock=0&q=TOUL")).json.total, 1, "inStock=0 shows out of stock");
const cats = (await call("GET", "/products/categories?market=pt")).json;
assert.equal(cats.children[0].name, "Decoração");
const res1 = (await call("POST", "/products/resolve", { ids: ["474166", "453245", "999"] })).json;
assert.deepEqual(res1.items.map((p) => [p.id, !!p.oos, !!p.missing]), [["474166", false, false], ["453245", true, false], ["999", false, true]], "resolve ids flags oos / missing");
const res2 = (await call("POST", "/products/resolve", { category: "Decoração", sort: "price_desc", limit: 3 })).json;
assert.equal(res2.items.length, 3); assert.ok(res2.total > 3); assert.ok(res2.items[0].price >= res2.items[1].price, "rule sort");
const res3 = (await call("POST", "/products/resolve", { mode: "rule", sort: "newest", limit: 1 })).json;
assert.equal(res3.items[0].id, "473088", "newest = first seen in the feed");
assert.ok(res3.items[0].badges.some((b) => b.label === "Novo"), "Novo badge from firstSeen");
assert.ok((await call("POST", "/products/resolve", { ids: ["474182"] })).json.items[0].badges.some((b) => b.tone === "brand"), "Exclusivo online from custom label");

let rec = (await call("POST", "/page-builder/elements", { element: example, author: "Gonçalo" })).json;
assert.equal(rec.id, "pb-hp-natal"); assert.equal(rec.author, "Gonçalo");
rec = (await call("PUT", `/page-builder/elements/${rec.id}`, { element: { ...rec.element, name: "HP Natal v2" }, author: "Rafael" })).json;
assert.equal(rec.name, "HP Natal v2"); assert.equal(rec.updatedBy, "Rafael");
assert.equal((await call("GET", `/page-builder/elements/${rec.id}/versions`)).json.length, 2, "versions kept");
for (let i = 0; i < 12; i++) await call("PUT", `/page-builder/elements/${rec.id}`, { element: rec.element });
assert.equal((await call("GET", `/page-builder/elements/${rec.id}/versions`)).json.length, 10, "last 10 versions");
const exp = (await call("POST", "/page-builder/export", { element: rec.element, author: "Gonçalo" })).json;
assert.equal(exp.check.ok, true, exp.check.errors.join("; "));
assert.ok(Object.keys(exp.productSnapshot).length >= 1);
let list = (await call("GET", "/page-builder/elements")).json;
assert.equal(list[0].stale, false); assert.ok(list[0].generatedAt);
// a price changes in the next feed run → "desatualizado"
const out2 = await db.get(K.output("feed-homa-pt"));
const someId = Object.keys(exp.productSnapshot)[0];
out2.meta.rows.find((r) => r.id === someId).sale_price = "1.00 EUR";
out2.generatedAt = "2026-11-06T08:00:00.000Z";
await db.set(K.output("feed-homa-pt"), out2);
const { getCatalog } = await import("../netlify/lib/products.mjs");
await getCatalog("pt", { force: true });
list = (await call("GET", "/page-builder/elements")).json;
assert.equal(list[0].stale, true, "stale after a price change"); assert.equal(list[0].staleProducts[0].id, someId);
assert.equal(staleness({ x: { price: 1, listPrice: null, inStock: true } }, [])[0].reason, "saiu do feed");
const dup = (await call("POST", `/page-builder/elements/${rec.id}/duplicate`, { author: "Rafael" })).json;
assert.equal(dup.id, "pb-hp-natal-v2-copia"); assert.equal(dup.element.id, dup.id); assert.equal(dup.lastExport, null);
assert.equal((await call("GET", "/page-builder/elements")).json.length, 2);
await call("DELETE", `/page-builder/elements/${dup.id}`);
assert.equal((await call("GET", `/page-builder/elements/${dup.id}`)).status, 404);
// generation job through the API (background trigger mocked to run in-process)
const { runJob } = await import("../netlify/functions/page-builder-background.mjs");
const prevFetch = globalThis.fetch;
globalThis.fetch = async (url, o) => (String(url).includes("page-builder-background") ? (runJob(JSON.parse(o.body).jobId), new Response("", { status: 202 })) : prevFetch(url, o));
calls.length = 1;
const { jobId } = (await call("POST", "/page-builder/generate", { prompt, market: "pt" })).json;
let job; for (let i = 0; i < 50; i++) { job = (await call("GET", `/page-builder/jobs/${jobId}`)).json; if (job.status !== "running") break; await new Promise((r) => setTimeout(r, 10)); }
assert.equal(job.status, "done", job.error); assert.equal(job.result.element.blocks.length, 4);
const st = (await call("PUT", "/page-builder/settings", { caps: { js: false }, capabilityTest: { style: true, inline: true, media: true, scroll: true, js: false, dataAttrs: true } })).json;
assert.equal(st.caps.js, false);
// saved blocks: composition → library, visible to the AI, insertable
assert.equal((await call("POST", "/page-builder/custom-blocks", { name: "", tree: E.SAMPLE_TREE })).status, 400, "name required");
assert.equal((await call("POST", "/page-builder/custom-blocks", { name: "x", tree: { kind: "text", text: "a" } })).status, 400, "container root required");
const cb = (await call("POST", "/page-builder/custom-blocks", { name: "Hero com dois botões", description: "hero + 2 CTAs", tree: E.SAMPLE_TREE, props: { background: "beige", evil: 1 }, author: "Gonçalo" })).json;
assert.equal(cb.id, "cb-hero-com-dois-botoes"); assert.deepEqual(cb.props, { background: "beige" }, "only common props kept");
assert.equal((await call("POST", "/page-builder/custom-blocks", { name: "Hero com dois botões", tree: E.SAMPLE_TREE })).json.id, "cb-hero-com-dois-botoes-2", "unique id");
assert.equal((await call("GET", "/page-builder/custom-blocks")).json.length, 2);
calls.length = 1;
await generate({ prompt: "COMPOSICAO", market: "pt" });
assert.ok(calls.at(-1).system.includes("cb-hero-com-dois-botoes") && calls.at(-1).system.includes("hero + 2 CTAs"), "saved blocks in the prompt");
const inserted = E.normalizeBlock({ type: "composition", props: { tree: E.cloneTree(cb.tree), template: cb.id } });
assert.equal(inserted.props.template, cb.id);
const cbIds = []; E.walkNodes(cb.tree, (n) => cbIds.push(n.id)); const inIds = []; E.walkNodes(inserted.props.tree, (n) => inIds.push(n.id));
assert.ok(inIds.every((i) => !cbIds.includes(i)), "inserted copy gets fresh node ids");
assert.ok(!E.checkElement(E.normalizeElement({ id: "t", market: "pt", blocks: [inserted] }), {}, "").warnings.some((w) => /composição nova/.test(w)), "saved block not flagged as new");
await call("DELETE", `/page-builder/custom-blocks/${cb.id}`);
assert.equal((await call("GET", "/page-builder/custom-blocks")).json.length, 1);
// export hydrates products inside compositions
const compEl = { id: "pb-comp", name: "Comp", market: "pt", blocks: [{ id: "cc", type: "composition", props: { tree: { kind: "stack", children: [{ kind: "text", text: "Favoritos", level: "h2", style: "display3" }, { kind: "products", id: "pp", limit: 3, productSource: { mode: "manual", ids: ["474166", "474182", "474179"] } }] } } }] };
const cexp = (await call("POST", "/page-builder/export", { element: compEl, author: "Gonçalo" })).json;
assert.equal(cexp.check.ok, true, cexp.check.errors.join("; "));
assert.ok(cexp.html.includes("CYRIELLE") && cexp.html.includes("MONA"), "composition products hydrated in the export");
assert.deepEqual(Object.keys(cexp.productSnapshot).sort(), ["474166", "474179", "474182"]);
console.log("API OK");

// ------------------------------------------------------------------ 7. export-test.html = renderer output for the example (plain HTML page)
const ET = new URL("../public/page-builder/export-test.html", import.meta.url);
const exEl = { ...example, blocks: example.blocks.map((b, i) => (i === 3 ? { ...b, props: { ...b.props, productSource: { mode: "manual", ids: E.SAMPLE_PRODUCTS.map((p) => p.id) } } } : b)) };
const exHtml = E.renderElement(exEl, { products: { [example.blocks[3].id]: E.SAMPLE_PRODUCTS.slice(0, 6) } }).html;
if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(ET)) {
  const page = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page Builder · teste do HTML exportado</title>
<style>
/* Simula o storefront: o homastores.com já carrega a Gilroy. Isto NÃO faz parte do HTML exportado. */
${E.PREVIEW_FONTS.replace(/\}@/g, "}\n@")}
body{margin:0;background:#fff}
</style>
</head>
<body>
<!-- ===== Daqui para baixo: HTML exatamente como o "Gerar HTML" do FeedForge o produz (exemplo do pedido: 4 imagens → título + texto → título + 8 produtos) ===== -->
${exHtml}
<!-- ===== Fim do HTML exportado ===== -->
</body>
</html>
`;
  fs.writeFileSync(ET, page);
  console.log("export-test.html escrito");
}
assert.ok(fs.readFileSync(ET, "utf8").includes(exHtml), "export-test.html = current renderer output (UPDATE_SNAPSHOTS=1 to rewrite)");
console.log("export-test OK");

console.log("\n✅ testes Page Builder passaram");
