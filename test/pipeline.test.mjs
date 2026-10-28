// Local test: in-memory store, mocked feed URL + mocked Anthropic API. Run: npm test
import assert from "node:assert/strict";
import { useMemoryStore, db, K } from "../netlify/lib/store.mjs";
import { defaultConfig } from "../netlify/lib/defaults.mjs";
import { runFeed } from "../netlify/lib/pipeline.mjs";
import { toCsv } from "../netlify/lib/util.mjs";

useMemoryStore();
process.env.ANTHROPIC_API_KEY = "test";

const HEADERS = ["id", "item_group_id", "title", "description", "availability", "condition", "price", "sale_price", "sale_price_effective_date", "link", "image_link", "additional_image_link", "brand", "gtin", "mpn", "product_type", "color", "size", "material", "shipping_weight", "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"];
const base = (id, over = {}) => ({
  id, item_group_id: `${id}-VM`, title: "Tapete saída de banho verde TIMELESS 50x70cm", description: "Tapete de banho em algodão 100%, macio e absorvente, ideal para casas de banho. Lavável na máquina a 30ºC. Dimensões 50x70cm, cor verde.",
  availability: "in stock", condition: "new", price: "6.00 EUR", sale_price: "", sale_price_effective_date: "", link: `https://homa.pt/p/${id}`, image_link: `https://homa.pt/i/${id}.jpg`,
  additional_image_link: "https://homa.pt/a.jpg,https://homa.pt/b.jpg", brand: "atmosphera", gtin: "03560239512345", mpn: "", product_type: "Casa de banho > Tapetes", color: "verde", size: "50x70", material: "algodão",
  shipping_weight: "0.3 kg", custom_label_0: "regular", custom_label_1: "standard", custom_label_2: "standard", custom_label_3: "standard", custom_label_4: "0-25", ...over,
});

let feedRows = [
  base("441499"),
  base("444394", { title: "CESTO ROUPA", description: "Cesto", brand: "5five", price: "18.00 EUR" }),
  base("457156", { title: "Saboneteira wc efeito areia", description: "", brand: "hôma", price: "3.50 EUR", sale_price: "2.50 EUR" }),
];
let aiCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.includes("feed.test")) return new Response(toCsv(HEADERS, feedRows));
  if (url.includes("api.anthropic.com")) {
    aiCalls++;
    const body = JSON.parse(opts.body);
    const items = JSON.parse(body.messages[0].content.replace(/^Produtos:\n/, ""));
    const out = {};
    for (const it of items) out[it.id] = { title: `Título otimizado ${it.id} para testes de feed`, description: `Descrição otimizada para ${it.id}. `.repeat(8) };
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }));
  }
  return realFetch(url, opts);
};

const cfg = defaultConfig({ id: "pt", name: "hôma PT" });
cfg.sourceUrl = "https://feed.test/meta.csv";
cfg.rules = [
  { id: "r1", name: "Label promo", enabled: true, match: "all", conditions: [{ field: "sale_price", op: "not_empty" }], actions: [{ type: "set", field: "custom_label_0", value: "promo" }] },
  { id: "r2", name: "Tentar mexer no preço (deve ser bloqueado)", enabled: true, match: "all", conditions: [], actions: [{ type: "set", field: "price", value: "0 EUR" }] },
  { id: "r3", name: "Bucket", enabled: true, match: "all", conditions: [], actions: [{ type: "price_bucket", field: "custom_label_4", buckets: "0-5,5-10,10-50,50+" }] },
  { id: "r4", name: "Excluir 5five do GMC", enabled: true, match: "all", conditions: [{ field: "brand", op: "equals", value: "5FIVE" }], actions: [{ type: "exclude", channel: "gmc" }] },
];
await db.set(K.config("pt"), cfg);
await db.set(K.feeds(), [{ id: "pt", name: "hôma PT" }]);

// ---- Day 1 (first run: all new)
let log = await runFeed("pt", { trigger: "schedule" });
assert.equal(log.status, "ok");
assert.equal(log.diff.new, 3);
let out = await db.get(K.output("pt"));
// approval on by default: AI copy waits for review and is NOT in the feed yet
assert.equal(out.meta.rows.find((r) => r.id === "444394").title, "CESTO ROUPA", "pending AI copy not published");
assert.ok(out.index.find((i) => i.id === "444394").aiPending);
const aiStore = await db.get(K.ai("pt"));
for (const e of Object.values(aiStore)) if (e.status === "pending") e.status = "accepted";
await db.set(K.ai("pt"), aiStore);
log = await runFeed("pt", { mode: "rebuild", trigger: "manual" });
out = await db.get(K.output("pt"));
cfg.ai.requireApproval = false; await db.set(K.config("pt"), cfg); // rest of the test: auto-publish mode
console.log("Approval OK");
const m1 = Object.fromEntries(out.meta.rows.map((r) => [r.id, r]));
assert.equal(m1["441499"].title, base("441499").title, "good product should not go to AI");
assert.match(m1["444394"].title, /otimizado/, "flagged product optimised");
assert.equal(m1["457156"].custom_label_0, "promo");
assert.equal(m1["457156"].price, "3.50 EUR", "locked price untouched by rule");
assert.equal(m1["457156"].custom_label_4, "0-5");
assert.equal(out.gmc.rows.length, 2, "5five excluded from GMC");
assert.equal(out.gmc.rows[0].availability, "in_stock");
assert.equal(out.gmc.rows[0].identifier_exists, "yes");
assert.ok(!("custom_label_9" in out.gmc.rows[0]));
const callsDay1 = aiCalls;
console.log("Day 1 OK —", log.steps.map((s) => s.msg).join(" | "));

// ---- Day 2: price/stock change on one, content change on another, new product, one removed
feedRows = [
  base("441499", { price: "5.00 EUR", availability: "out of stock" }),
  base("444394", { title: "CESTO ROUPA BAMBU", description: "Cesto", brand: "5five", price: "18.00 EUR" }),
  base("500001", { title: "Vela", description: "" }),
];
log = await runFeed("pt", { trigger: "schedule" });
assert.deepEqual([log.diff.new, log.diff.removed, log.diff.changedContent, log.diff.changedLocked], [1, 1, 1, 1]);
out = await db.get(K.output("pt"));
const m2 = Object.fromEntries(out.meta.rows.map((r) => [r.id, r]));
assert.equal(m2["441499"].price, "5.00 EUR", "locked passthrough updated");
assert.equal(m2["441499"].availability, "out of stock");
assert.match(m2["444394"].title, /otimizado/, "existing product keeps cached AI (no re-optimisation)");
assert.match(m2["500001"].title, /otimizado/, "new product optimised");
assert.equal(aiCalls - callsDay1, 1, "only one AI call for the single new product");
assert.ok(!m2["457156"], "removed product dropped");
const g = out.gmc.rows.find((r) => r.id === "441499");
assert.equal(g.availability, "out_of_stock");
console.log("Day 2 OK —", log.steps.map((s) => s.msg).join(" | "));

// ---- Day 3: identical feed -> rules/labels come from cache
log = await runFeed("pt", { trigger: "manual" });
assert.equal(log.rules.recalculated, 0, "nothing recalculated");
assert.equal(log.rules.cached, 3);
console.log("Rule cache OK —", log.steps.find((s) => s.msg.startsWith("Regras")).msg);

// ---- Scheduler: expired + future rules don't apply; editing rules invalidates cache once
cfg.rules.push(
  { id: "r5", name: "Black Friday (expirada)", enabled: true, match: "all", conditions: [], schedule: { mode: "range", start: "2025-11-20", end: "2025-11-30" }, actions: [{ type: "set", field: "custom_label_3", value: "bf2025" }] },
  { id: "r6", name: "Natal (futura)", enabled: true, match: "all", conditions: [], schedule: { mode: "from", start: "2099-12-01" }, actions: [{ type: "set", field: "custom_label_3", value: "natal" }] },
  { id: "r7", name: "Campanha ativa", enabled: true, match: "all", conditions: [], schedule: { mode: "range", start: "2020-01-01", end: "2099-01-01" }, actions: [{ type: "set", field: "custom_label_2", value: "campanha" }] },
);
await db.set(K.config("pt"), cfg);
log = await runFeed("pt", { mode: "rebuild" });
assert.equal(log.rules.recalculated, 3, "rule change invalidates cache");
out = await db.get(K.output("pt"));
assert.ok(out.meta.rows.every((r) => r.custom_label_3 === "standard" && r.custom_label_2 === "campanha"));
log = await runFeed("pt", { mode: "rebuild" });
assert.equal(log.rules.recalculated, 0);
console.log("Scheduler OK");

// ---- Safety guard: feed collapses
feedRows = [base("441499")];
cfg.minRowRatio = 0.9;
await db.set(K.config("pt"), cfg);
await assert.rejects(runFeed("pt"), /Abortado por segurança/);
console.log("Safety guard OK");

console.log("\n✅ todos os testes passaram");
