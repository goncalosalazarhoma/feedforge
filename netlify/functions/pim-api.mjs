// PIM optimizer API (/pim-api/*). Same auth as the feed API.
import { db, httpError } from "../lib/store.mjs";
import { json, authorized } from "../lib/http.mjs";
import { PK, getPimConfig, defaultPimConfig, parseColumn, columnFor, isEditable, diagnose, productFacts, dimensionsText, refreshMeta, getDictionary, fieldsFor, deterministicFixes } from "../lib/pim.mjs";

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, handler });
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
async function job(id) {
  const m = await db.get(PK.job(id));
  if (!m) throw httpError(404, "Ficheiro não encontrado");
  return m;
}

// ------------------------------------------------------------------ config & dictionary
route("GET", "/config", async () => ({ config: await getPimConfig(), defaults: defaultPimConfig(), dictionary: summarizeDict(await getDictionary()) }));
route("PUT", "/config", async ({ body }) => {
  const cur = await getPimConfig();
  const next = { ...cur, ...body, limits: { ...cur.limits, ...(body.limits || {}) }, instructions: { ...cur.instructions, ...(body.instructions || {}) } };
  await db.set(PK.config(), next);
  return next;
});
function summarizeDict(d) {
  if (!d) return null;
  return { families: Object.keys(d.families || {}).length, attributesWithOptions: Object.keys(d.options || {}).length, attributes: Object.keys(d.attributes || {}).length, importedAt: d.importedAt, source: d.source, bundled: !!d.bundled };
}
route("GET", "/dictionary", async () => getDictionary());
route("PUT", "/dictionary", async ({ body }) => {
  const cur = (await db.get(PK.dictionary())) || {};
  const next = {
    families: { ...(cur.families || {}), ...(body.families || {}) },
    options: { ...(cur.options || {}), ...(body.options || {}) },
    attributes: { ...(cur.attributes || {}), ...(body.attributes || {}) },
    importedAt: new Date().toISOString(),
    source: body.source || cur.source || "manual",
  };
  await db.set(PK.dictionary(), next);
  return summarizeDict(next);
});

// ------------------------------------------------------------------ jobs (uploaded files)
route("GET", "/jobs", async () => {
  const ids = (await db.get(PK.jobs())) || [];
  const metas = await Promise.all(ids.map((id) => db.get(PK.job(id))));
  return metas.filter(Boolean).map(({ index, ...m }) => m);
});

route("POST", "/jobs", async ({ body }) => {
  if (!Array.isArray(body.headers) || !body.headers.includes("sku")) throw httpError(400, "O ficheiro tem de ter a coluna 'sku' (export do Akeneo)");
  const id = uid();
  await db.set(PK.rows(id), { headers: body.headers, rows: [] });
  await db.set(PK.results(id), {});
  await db.set(PK.job(id), { id, name: body.name || "export", createdAt: new Date().toISOString(), status: "uploading", count: 0 });
  const ids = (await db.get(PK.jobs())) || [];
  await db.set(PK.jobs(), [id, ...ids].slice(0, 50));
  return { id };
});

route("POST", "/jobs/:id/rows", async ({ id, body }) => {
  const data = await db.get(PK.rows(id));
  if (!data) throw httpError(404, "Ficheiro não encontrado");
  for (const r of body.rows || []) {
    const o = {};
    for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined && v !== "") o[k] = String(v);
    if (o.sku) data.rows.push(o);
  }
  await db.set(PK.rows(id), data);
  return { count: data.rows.length };
});

route("POST", "/jobs/:id/finalize", async ({ id }) => {
  const meta = await job(id);
  const [cfg, dict, data] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id))]);
  const results = (await db.get(PK.results(id))) || {};
  let fixes = 0;
  for (const r of data.rows) {
    const f = deterministicFixes(r, data.headers, cfg, dict);
    if (!Object.keys(f).length) continue;
    results[r.sku] ||= { fields: {} };
    for (const [col, value] of Object.entries(f)) { results[r.sku].fields[col] = { value, source: "fix", status: "pending" }; fixes++; }
  }
  await db.set(PK.results(id), results);
  meta.fixes = fixes;
  meta.status = "ready";
  return stripIndex(await refreshMeta(id, meta));
});
const stripIndex = ({ index, ...m }) => m;

route("GET", "/jobs/:id", async ({ id }) => {
  const meta = await job(id);
  const lock = await db.get(PK.lock(id));
  return { ...stripIndex(meta), running: !!(lock && Date.now() - lock.at < 16 * 60 * 1000) };
});

route("POST", "/jobs/:id/rediagnose", async ({ id }) => stripIndex(await refreshMeta(id, await job(id))));

route("DELETE", "/jobs/:id", async ({ id }) => {
  for (const k of ["job", "rows", "results", "lock"]) await db.del(PK[k](id));
  const ids = (await db.get(PK.jobs())) || [];
  await db.set(PK.jobs(), ids.filter((x) => x !== id));
  return { ok: true };
});

route("GET", "/jobs/:id/products", async ({ id, query }) => {
  const meta = await job(id);
  let items = meta.index || [];
  const q = (query.get("q") || "").toLowerCase();
  if (q) items = items.filter((i) => i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  const f = query.get("filter");
  if (f === "errors") items = items.filter((i) => i.errors);
  if (f === "warnings") items = items.filter((i) => i.warnings);
  if (f === "pending") items = items.filter((i) => i.pending);
  if (f === "accepted") items = items.filter((i) => i.accepted);
  if (f === "todo") items = items.filter((i) => !i.suggested);
  if (f === "seasonal") items = items.filter((i) => i.seasonal);
  const flag = query.get("flag");
  if (flag) items = items.filter((i) => i.flags.includes(flag));
  const fam = query.get("family");
  if (fam) items = items.filter((i) => i.family === fam);
  const size = Math.min(Number(query.get("size")) || 50, 500), page = Math.max(Number(query.get("page")) || 1, 1);
  return { total: items.length, page, size, items: items.slice((page - 1) * size, page * size), skus: query.get("skus") === "1" ? items.map((i) => i.sku) : undefined };
});

route("GET", "/jobs/:id/products/:sku", async ({ id, sku }) => {
  sku = decodeURIComponent(sku);
  const [cfg, dict, data, results] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id)), db.get(PK.results(id))]);
  const row = data?.rows.find((r) => r.sku === sku);
  if (!row) throw httpError(404, "SKU não encontrado");
  const fields = [];
  const seen = new Set();
  const push = (col, attr, loc) => { if (seen.has(col)) return; seen.add(col); fields.push({ col, attr, locale: loc, current: row[col] ?? "", suggestion: results?.[sku]?.fields?.[col] || null, editable: isEditable(col, cfg) }); };
  const attrs = [...new Set([...cfg.editable, ...(cfg.translateOnly || [])])];
  for (const attr of attrs) for (const loc of cfg.targetLocales) {
    if (!cfg.editable.includes(attr) && loc === cfg.sourceLocale) { push(columnFor(data.headers, attr, loc, cfg.channel), attr, loc); continue; } // show PT (locked) next to ES
    push(columnFor(data.headers, attr, loc, cfg.channel), attr, loc);
  }
  for (const col of Object.keys(results?.[sku]?.fields || {})) push(col, parseColumn(col).attr, parseColumn(col).locale);
  return { sku, family: row.family, facts: productFacts(row, dict || {}, cfg), dimensions: dimensionsText(row), flags: diagnose(row, data.headers, cfg, dict || {}), fields, raw: row };
});

route("PUT", "/jobs/:id/products/:sku", async ({ id, sku, body }) => {
  sku = decodeURIComponent(sku);
  const cfg = await getPimConfig();
  const results = (await db.get(PK.results(id))) || {};
  const cur = results[sku] || { fields: {} };
  for (const [col, v] of Object.entries(body.fields || {})) {
    if (!isEditable(col, cfg)) throw httpError(400, `A coluna ${col} está trancada`);
    if (v === null) { delete cur.fields[col]; continue; }
    const prev = cur.fields[col] || {};
    cur.fields[col] = { value: v.value ?? prev.value ?? "", source: v.value != null && v.value !== prev.value ? (prev.source === "ai" ? "ai+edit" : "manual") : prev.source || "manual", status: v.status || prev.status || "pending" };
  }
  results[sku] = { ...cur, at: new Date().toISOString() };
  await db.set(PK.results(id), results);
  await refreshMeta(id, await job(id));
  return results[sku];
});

route("POST", "/jobs/:id/bulk", async ({ id, body }) => {
  // body: { action: "accept"|"reject"|"reset", skus?: [], cols?: [attr...] }
  const results = (await db.get(PK.results(id))) || {};
  const skus = body.skus?.length ? body.skus : Object.keys(results);
  let n = 0;
  for (const s of skus) {
    const r = results[s];
    if (!r) continue;
    for (const [col, v] of Object.entries(r.fields)) {
      if (body.cols?.length && !body.cols.includes(parseColumn(col).attr)) continue;
      if (body.action === "reset") { delete r.fields[col]; n++; continue; }
      if (body.action === "accept" && v.warning && !body.force) continue; // fields with guardrail warnings need a human look
      if (v.status === "pending" || body.force) { v.status = body.action === "accept" ? "accepted" : "rejected"; n++; }
    }
  }
  await db.set(PK.results(id), results);
  await refreshMeta(id, await job(id));
  return { changed: n };
});

route("POST", "/jobs/:id/run", async ({ id, body, req }) => {
  const meta = await job(id);
  const lock = await db.get(PK.lock(id));
  if (lock && Date.now() - lock.at < 16 * 60 * 1000) throw httpError(409, "Já está a correr");
  let skus = body.skus;
  if (!skus?.length) {
    const idx = meta.index || [];
    skus = (body.scope === "all" ? idx : idx.filter((i) => i.flags.some((f) => !f.startsWith("_")))).filter((i) => body.redo || !i.suggested).map((i) => i.sku);
  }
  meta.queue = skus;
  meta.redo = !!body.redo;
  meta.progress = { done: 0, total: skus.length, errors: 0, startedAt: new Date().toISOString() };
  await db.set(PK.job(id), meta);
  const res = await fetch(`${new URL(req.url).origin}/.netlify/functions/pim-background`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.APP_PASSWORD}`, "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (res.status !== 202 && !res.ok) throw httpError(500, `Não foi possível iniciar (${res.status})`);
  return { queued: skus.length };
});

route("GET", "/jobs/:id/export", async ({ id, query }) => {
  const cfg = await getPimConfig();
  const [data, results] = await Promise.all([db.get(PK.rows(id)), db.get(PK.results(id))]);
  const includePending = query.get("pending") === "1";
  const cols = new Set();
  const rows = [];
  for (const r of data.rows) {
    const res = results?.[r.sku]?.fields || {};
    const out = { sku: r.sku };
    for (const [col, v] of Object.entries(res)) {
      if (!isEditable(col, cfg)) continue;
      if (v.status === "accepted" || (includePending && v.status === "pending")) {
        if (String(v.value) !== String(r[col] ?? "")) { out[col] = v.value; cols.add(col); }
      }
    }
    if (Object.keys(out).length > 1) rows.push(out);
  }
  const headers = ["sku", ...[...cols].sort()];
  return { headers, rows, changes: rows.reduce((n, r) => n + Object.keys(r).length - 1, 0) };
});

// ------------------------------------------------------------------ handler
export default async (req) => {
  if (!authorized(req)) return json({ error: "Password inválida" }, 401);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/pim-api/, "") || "/";
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    try {
      const body = ["POST", "PUT"].includes(req.method) ? await req.json().catch(() => ({})) : {};
      const result = await r.handler({ ...params, body, query: url.searchParams, req });
      return result instanceof Response ? result : json(result);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, e.status || 500);
    }
  }
  return json({ error: "Rota não encontrada" }, 404);
};

export const config = { path: "/pim-api/*" };
