// Local test for the direct Akeneo import (mocked Akeneo API). Run: node test/akeneo.test.mjs
import assert from "node:assert/strict";
import { useMemoryStore, db } from "../netlify/lib/store.mjs";
import { PK } from "../netlify/lib/pim.mjs";
import { valuesToColumns, buildSearch, completenessFilter, passesCompleteness } from "../netlify/lib/akeneo-api.mjs";

useMemoryStore();
Object.assign(process.env, { APP_PASSWORD: "pw", AKENEO_URL: "https://pim.test", AKENEO_CLIENT_ID: "cid", AKENEO_SECRET: "sec", AKENEO_USERNAME: "u", AKENEO_PASSWORD: "p" });

// ---- value conversion matches the XLSX export columns
const cols = valuesToColumns({
  ATT_NAME: [{ locale: "pt_PT", scope: "ecommerce", data: "Cama ELI" }, { locale: "fr_FR", scope: "ecommerce", data: "x" }, { locale: "pt_PT", scope: "print", data: "y" }],
  ATT_PLP_NAME: [{ locale: "pt_PT", scope: null, data: "Cama ELI bege" }],
  ATT_ARTICLE_DIMENSION_WIDE: [{ locale: null, scope: null, data: { amount: "90.0000", unit: "CENTIMETER" } }],
  ATT_PVP: [{ locale: null, scope: null, data: [{ amount: "199.00", currency: "EUR" }] }],
  ATT_MATERIAL: [{ locale: null, scope: null, data: ["MAT_WOOD", "MAT_METAL"] }],
  ATT_OUTDOOR: [{ locale: null, scope: null, data: false }],
  ATT_START_DATE_NEW: [{ locale: null, scope: null, data: "2026-11-01T00:00:00+00:00" }],
  ATT_COMPOSITION: [{ locale: null, scope: null, data: [{ TBL_ATT_MATERIAL: "MAT_X", TBL_ATT_COMPO_PERCENTAGE: "100" }] }],
}, { locales: ["pt_PT", "es_ES"], channel: "ecommerce" });
assert.deepEqual(cols, {
  "ATT_NAME-pt_PT-ecommerce": "Cama ELI", "ATT_PLP_NAME-pt_PT": "Cama ELI bege",
  ATT_ARTICLE_DIMENSION_WIDE: "90.0000", "ATT_ARTICLE_DIMENSION_WIDE-unit": "CENTIMETER", "ATT_PVP-EUR": "199.00",
  ATT_MATERIAL: "MAT_WOOD,MAT_METAL", ATT_OUTDOOR: "0", ATT_START_DATE_NEW: "2026-11-01",
  ATT_COMPOSITION: '[{"TBL_ATT_MATERIAL":"MAT_X","TBL_ATT_COMPO_PERCENTAGE":"100"}]',
});
assert.deepEqual(buildSearch({ families: ["FAM_BEDS"], incompleteOnly: true, skus: "1, 2" }, { channel: "ecommerce", locale: "pt_PT" }), {
  identifier: [{ operator: "IN", value: ["1", "2"] }], family: [{ operator: "IN", value: ["FAM_BEDS"] }],
  completeness: [{ operator: "<", value: 100, scope: "ecommerce", locales: ["pt_PT"] }],
});
// ---- completion rate filter
assert.deepEqual(buildSearch({ completeness: { op: "between", value: 90, value2: 50, locales: ["pt_PT", "es_ES"], all: true } }, { channel: "ecommerce", locale: "pt_PT" }).completeness, [
  { operator: "GREATER OR EQUALS THAN ON ALL LOCALES", value: 50, scope: "ecommerce", locales: ["pt_PT", "es_ES"] },
  { operator: "LOWER OR EQUALS THAN ON ALL LOCALES", value: 90, scope: "ecommerce", locales: ["pt_PT", "es_ES"] },
]);
assert.deepEqual(buildSearch({ completeness: { op: "gte", value: 80, locales: ["es_ES"] } }, { channel: "ecommerce", locale: "pt_PT" }).completeness, [{ operator: ">=", value: 80, scope: "ecommerce", locales: ["es_ES"] }]);
const row = { "completeness_ratio-pt_PT-ecommerce": "80", "completeness_ratio-es_ES-ecommerce": "40" };
const cf = (c) => completenessFilter({ completeness: c }, "pt_PT");
assert.equal(passesCompleteness(row, cf({ op: "lt", value: 50, locales: ["pt_PT", "es_ES"], all: false }), "ecommerce"), true, "any locale");
assert.equal(passesCompleteness(row, cf({ op: "lt", value: 50, locales: ["pt_PT", "es_ES"], all: true }), "ecommerce"), false, "all locales");
assert.equal(passesCompleteness(row, cf({ op: "between", value: 70, value2: 90, locales: ["pt_PT"] }), "ecommerce"), true);
assert.equal(passesCompleteness(row, completenessFilter({ incompleteOnly: true }, "pt_PT"), "ecommerce"), true, "old checkbox still works");
console.log("Conversão OK");

// ---- mocked Akeneo API: token, 2 pages of products, sub-model + root model
const calls = [];
const prod = (sku, parent) => ({ identifier: sku, family: "FAM_BEDS", parent, categories: ["ecom_beds", "1071102"], enabled: true, values: { "ATT_NAME": [{ locale: "pt_PT", scope: "ecommerce", data: `CAMA ${sku}` }] }, completenesses: [{ scope: "ecommerce", locale: "pt_PT", data: 80 }, { scope: "ecommerce", locale: "es_ES", data: 50 }] });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); calls.push(url);
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (url.includes("/.netlify/functions/")) return new Response("", { status: 202 });
  if (url.endsWith("/api/oauth/v1/token")) { assert.equal(opts.headers.authorization, "Basic " + Buffer.from("cid:sec").toString("base64")); return json({ access_token: "tok", expires_in: 3600 }); }
  assert.equal(opts.headers.authorization, "Bearer tok");
  if (url.includes("/api/rest/v1/channels")) return json({ _embedded: { items: [{ code: "ecommerce" }] } });
  if (url.includes("/api/rest/v1/families")) return json({ items_count: 50, _embedded: { items: [] } });
  if (url.includes("/api/rest/v1/products?") && !url.includes("page2")) return json({ _embedded: { items: [prod("468819", "FAM0000001748"), prod("999")] }, _links: { next: { href: "https://pim.test/api/rest/v1/products?page2=1" } } });
  if (url.includes("page2")) return json({ _embedded: { items: [prod("468820", "FAM0000001748")] }, _links: {} });
  if (url.includes("/product-models/FAM0000001748")) return json({ code: "FAM0000001748", parent: "FAM_00001032", family: "FAM_BEDS", family_variant: "fam_camas_cor_tam", categories: [], values: { ATT_PLP_NAME: [{ locale: "pt_PT", scope: null, data: "Cama ELI bege" }] } });
  if (url.includes("/product-models/FAM_00001032")) return json({ code: "FAM_00001032", parent: null, family: "FAM_BEDS", family_variant: "fam_camas_cor_tam", categories: [], values: {} });
  return json({ message: "not found" }, 404);
};

const api = (await import("../netlify/functions/pim-api.mjs")).default;
const call = async (method, path, body) => { const r = await api(new Request("https://app.test/pim-api" + path, { method, headers: { authorization: "Bearer pw", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, json: JSON.parse(await r.text()) }; };
let r = await call("POST", "/akeneo/test");
assert.equal(r.json.ok, true); assert.deepEqual(r.json.channels, ["ecommerce"]);
r = await call("POST", "/akeneo/import", { name: "camas", families: ["FAM_BEDS"], incompleteOnly: true });
const id = r.json.id;
assert.ok(calls.some((u) => u.endsWith("/.netlify/functions/pim-akeneo-background")), "background started");
const { importFromAkeneo } = await import("../netlify/functions/pim-akeneo-background.mjs");
const imp = await importFromAkeneo(id);
assert.equal(imp.done, 3); assert.equal(imp.models, 2); assert.equal(imp.truncated, false);
const productsCall = calls.find((u) => u.includes("/api/rest/v1/products?"));
const q = new URL(productsCall).searchParams;
assert.deepEqual(JSON.parse(q.get("search")).family, [{ operator: "IN", value: ["FAM_BEDS"] }]);
assert.equal(q.get("scope"), "ecommerce"); assert.equal(q.get("with_completenesses"), "true");
const data = await db.get(PK.rows(id));
assert.deepEqual(data.headers.slice(0, 7), ["entity_type", "code", "sku", "parent", "family", "family_variant", "categories"]);
const byKey = Object.fromEntries(data.rows.map((x) => [x.sku, x]));
assert.equal(byKey["468819"]["completeness_ratio-pt_PT-ecommerce"], "80");
assert.equal(byKey["FAM0000001748"]._model, "1");
const meta = await db.get(PK.job(id));
assert.equal(meta.status, "ready"); assert.equal(meta.count, 3); assert.equal(meta.models, 2);
// same downstream behaviour as a file: PLP name is owned by the sub-model
r = await call("GET", `/jobs/${id}/products/468819`);
assert.match(r.json.fields.find((f) => f.col === "ATT_PLP_NAME-pt_PT").lock.msg, /FAM0000001748/);
console.log("Importação OK");

// completion rate applied to the import: products are at 80% PT → "≥ 90% in pt_PT" keeps none
r = await call("POST", "/akeneo/import", { name: "≥90", completeness: { op: "gte", value: 90, locales: ["pt_PT"] } });
const imp2 = await importFromAkeneo(r.json.id);
assert.equal(imp2.done, 0); assert.equal(imp2.skipped, 3);
assert.deepEqual(JSON.parse(new URL(calls.filter((u) => u.includes("/api/rest/v1/products?") && u.includes("search=")).pop()).searchParams.get("search")).completeness, [{ operator: ">=", value: 90, scope: "ecommerce", locales: ["pt_PT"] }]);
console.log("Filtro de completude OK");

// ---- missing env → clear error, no call
delete process.env.AKENEO_PASSWORD;
r = await call("POST", "/akeneo/import", {});
assert.equal(r.status, 400); assert.match(r.json.error || r.json.message, /AKENEO_PASSWORD/);
console.log("\n✅ testes Akeneo passaram");
