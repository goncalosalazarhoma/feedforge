// PIM optimizer API (/pim-api/*). Same auth as the feed API.
import { db, httpError } from "../lib/store.mjs";
import { json, authorized } from "../lib/http.mjs";
import { PK, getPimConfig, defaultPimConfig, parseColumn, columnFor, isEditable, diagnose, productFacts, dimensionsText, refreshMeta, getDictionary, fieldsFor, deterministicFixes, labelChanges, categoryFixes, categoryContext } from "../lib/pim.mjs";
import { humanCat, splitCats, checkCategories } from "../lib/categories.mjs";
import { buildHierarchy, isModelRow, normaliseRows, canEdit, effectiveFields } from "../lib/pim.mjs";

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
  return { categories: Object.keys(d.categories || {}).length, families: Object.keys(d.families || {}).length, attributesWithOptions: Object.keys(d.options || {}).length, attributes: Object.keys(d.attributes || {}).length, importedAt: d.importedAt, source: d.source, bundled: !!d.bundled };
}
route("GET", "/dictionary", async () => getDictionary());
route("PUT", "/dictionary", async ({ body }) => {
  const cur = (await db.get(PK.dictionary())) || {};
  const next = {
    families: { ...(cur.families || {}), ...(body.families || {}) },
    options: { ...(cur.options || {}), ...(body.options || {}) },
    attributes: { ...(cur.attributes || {}), ...(body.attributes || {}) },
    categories: { ...(cur.categories || {}), ...(body.categories || {}) },
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
  if (!Array.isArray(body.headers) || !(body.headers.includes("sku") || body.headers.includes("code"))) throw httpError(400, "O ficheiro tem de ter a coluna 'sku' (produtos) ou 'code' (modelos) — export do Akeneo");
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
    if (o.sku || o.code) data.rows.push(o);
  }
  await db.set(PK.rows(id), data);
  return { count: data.rows.length };
});

// apply deterministic fixes + label rules to a job (never overwrites manual/accepted AI work)
async function applyAuto(id) {
  const [cfg, dict, data] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id))]);
  const results = (await db.get(PK.results(id))) || {};
  let fixes = 0, labels = 0;
  const cctx = categoryContext(data.rows.filter((r) => !isModelRow(r)), dict);
  const h = buildHierarchy(data.rows, dict);
  for (const r of data.rows) {
    const cur = (results[r.sku] ||= { fields: {} });
    const model = isModelRow(r);
    const src = model ? h.mergedRow(r) : r;
    // with product models, drop what an earlier version proposed on a field this row does not own
    for (const [col, v] of Object.entries(cur.fields)) if ((v.source === "fix" || v.source === "label") && !canEdit(r, col, cfg, h)) delete cur.fields[col];
    // category fixes (never over an AI/manual proposal) — products only
    const cf = model ? null : categoryFixes(r, cfg, cctx);
    const pc = cur.fields.categories;
    if (cf && (!pc || pc.source === "fix")) { cur.fields.categories = { value: cf.value, source: "fix", status: pc?.value === cf.value ? pc.status : "pending", reason: cf.reason, catDiff: cf.catDiff }; fixes++; }
    // fixes
    for (const [col, f] of Object.entries(deterministicFixes(src, data.headers, cfg, dict))) {
      if (!canEdit(r, col, cfg, h)) continue; // owned by another level (or a variant axis)
      if (model && String(r[col] ?? "") !== "" ) continue;
      const prev = cur.fields[col];
      if (prev && prev.source !== "fix") continue;
      cur.fields[col] = { value: f.value, source: "fix", status: prev?.value === f.value ? prev.status : "pending", reason: f.reason };
      fixes++;
    }
    // labels: recompute from scratch (removing a rule removes its labels)
    for (const [col, v] of Object.entries(cur.fields)) if (v.source === "label") delete cur.fields[col];
    const accepted = Object.fromEntries(Object.entries(cur.fields).filter(([, v]) => v.status === "accepted").map(([c, v]) => [c, v.value]));
    for (const [col, value] of Object.entries(labelChanges(src, data.headers, cfg, accepted))) {
      if (!canEdit(r, col, cfg, h)) continue;
      if (cur.fields[col] && cur.fields[col].source === "manual") continue;
      cur.fields[col] = { value, source: "label", status: "accepted", reason: "Regra de label" };
      labels++;
    }
    if (!Object.keys(cur.fields).length) delete results[r.sku];
  }
  await db.set(PK.results(id), results);
  return { fixes, labels };
}

route("POST", "/jobs/:id/finalize", async ({ id }) => {
  const meta = await job(id);
  const data = await db.get(PK.rows(id));
  if (data && !data.normalised) { data.rows = normaliseRows(data.rows); data.normalised = true; await db.set(PK.rows(id), data); }
  const r = await applyAuto(id);
  meta.fixes = r.fixes;
  meta.status = "ready";
  return stripIndex(await refreshMeta(id, meta));
});

route("POST", "/jobs/:id/auto", async ({ id }) => {
  const r = await applyAuto(id);
  const meta = await refreshMeta(id, await job(id));
  return { ...r, completeness: meta.completeness };
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
  if (f === "models") items = items.filter((i) => i.entity === "model");
  if (f === "products") items = items.filter((i) => i.entity !== "model");
  const parent = query.get("parent");
  if (parent) items = items.filter((i) => i.parent === parent);
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
  const h = buildHierarchy(data.rows, dict || {});
  const model = isModelRow(row);
  const view = model ? h.mergedRow(row) : row;
  const fields = [];
  const seen = new Set();
  const push = (col, attr, loc) => {
    if (seen.has(col)) return; seen.add(col);
    const f = { col, attr, locale: loc, current: (model ? row[col] : view[col]) ?? "", suggestion: results?.[sku]?.fields?.[col] || null, editable: canEdit(row, col, cfg, h) };
    if (h.hasModels && isEditable(col, cfg) && !f.editable && col !== "categories") {
      if (h.isAxis(row, attr)) f.lock = { reason: "axis", msg: "Eixo de variante — não pode ser alterado" };
      else {
        const o = h.ownerOf(row, attr);
        if (o.key && o.key !== sku) {
          const ownerRow = h.byKey.get(o.key);
          f.lock = { reason: h.isModel(ownerRow) ? "inherited" : "below", owner: o.key, msg: h.isModel(ownerRow) ? `Herdado do modelo ${o.key} — edita lá` : `Definido em cada variante (ex.: ${o.key})` };
          if (h.isModel(ownerRow)) f.ownerSuggestion = results?.[o.key]?.fields?.[col] || null;
        } else f.lock = { reason: "unknown", msg: o.outside ? "Pertence ao modelo raiz, que não está no ficheiro" : "Nível do Akeneo desconhecido — exporta com as colunas family e family_variant" };
      }
    }
    fields.push(f);
  };
  const attrs = [...new Set([...cfg.editable, ...(cfg.translateOnly || [])])];
  for (const attr of attrs) for (const loc of cfg.targetLocales) {
    if (!cfg.editable.includes(attr) && loc === cfg.sourceLocale) { push(columnFor(data.headers, attr, loc, cfg.channel), attr, loc); continue; } // show PT (locked) next to ES
    push(columnFor(data.headers, attr, loc, cfg.channel), attr, loc);
  }
  for (const [col, v] of Object.entries(results?.[sku]?.fields || {})) if (v.status !== "kept") push(col, parseColumn(col).attr, parseColumn(col).locale);
  const images = (await db.get(PK.images(id)))?.items?.[sku] || null;
  const cctx = categoryContext(data.rows, dict);
  const catLabel = (c) => ({ code: c, label: humanCat(c, cctx.tax), ecom: c.startsWith("ecom_") });
  const catSug = results?.[sku]?.fields?.categories;
  const categories = { flags: checkCategories(row, cctx, cfg).flags, current: splitCats(row.categories).map(catLabel), suggestion: catSug ? { ...catSug, add: (catSug.catDiff?.add || []).map(catLabel), remove: (catSug.catDiff?.remove || []).map(catLabel) } : null };
  const hier = h.hasModels ? {
    entity: model ? "model" : "product",
    virtual: !!row._virtual,
    chain: h.chainOf(model ? row : row).slice(0, -1).map((x) => ({ key: x.sku, virtual: !!x._virtual })),
    children: (h.children.get(sku) || []).map((c) => ({ key: c.sku, entity: isModelRow(c) ? "model" : "product", name: c[`ATT_PLP_NAME-${cfg.sourceLocale}`] || c[`ATT_NAME-${cfg.sourceLocale}-${cfg.channel}`] || "" })),
    variants: model ? h.variantsOf(row) : null,
  } : null;
  return { sku, family: view.family, hier, facts: productFacts(view, dict || {}, cfg), dimensions: dimensionsText(view), flags: diagnose(view, data.headers, cfg, dict || {}).filter((f) => !model || (!f.field.startsWith("_") && h.owns(row, f.field))), fields, images, categories: model ? null : categories, raw: row };
});

route("PUT", "/jobs/:id/products/:sku", async ({ id, sku, body }) => {
  sku = decodeURIComponent(sku);
  const [cfg, dict, data] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id))]);
  const results = (await db.get(PK.results(id))) || {};
  const cur = results[sku] || { fields: {} };
  const h = buildHierarchy(data.rows, dict);
  const row = h.byKey.get(sku);
  for (const [col, v] of Object.entries(body.fields || {})) {
    if (v !== null && !canEdit(row, col, cfg, h)) {
      const o = h.ownerOf(row, parseColumn(col).attr);
      throw httpError(400, h.isAxis(row, parseColumn(col).attr) ? `${col} é um eixo de variante — não pode ser alterado` : o.key && o.key !== sku ? `${col} só se edita no modelo ${o.key}` : `A coluna ${col} está trancada`);
    }
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
      if (body.action === "accept" && col === "categories" && !(body.cols || []).includes("categories")) continue; // categories are accepted on purpose
      if (v.status === "kept") continue; // AI verdict "keep as is" — nothing to accept
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
  const idx = meta.index || [];
  if (!skus?.length) {
    const byIdx = new Map(idx.map((i) => [i.sku, i]));
    const picked = body.scope === "all" ? idx : idx.filter((i) => i.flags.some((f) => !f.startsWith("_")));
    const targets = new Set();
    if (idx.some((i) => i.entity === "model" || i.parent)) {
      // product models: a problem on an inherited field is fixed once, on the model that owns it
      const [cfg, dict, data] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id))]);
      const h = buildHierarchy(data.rows, dict);
      const aiAttrs = [...new Set(cfg.targetLocales.flatMap((l) => fieldsFor(l, cfg)))];
      for (const i of picked) {
        const row = h.byKey.get(i.sku);
        if (!row) continue;
        const fields = body.scope === "all" ? aiAttrs : i.flags.filter((f) => !f.startsWith("_")).map((f) => f.split(":")[0]);
        for (const a of fields) { if (!aiAttrs.includes(a)) continue; const o = h.ownerOf(row, a); if (o.key && !h.isAxis(row, a)) targets.add(o.key); }
      }
    } else for (const i of picked) targets.add(i.sku);
    skus = [...targets].filter((k) => body.redo || !byIdx.get(k)?.suggested);
  }
  if (body.mode === "categories" && !body.skus?.length) {
    skus = (body.scope === "all" ? idx : idx.filter((i) => i.flags.some((f) => f.startsWith("_categories:")))).filter((i) => i.entity !== "model").map((i) => i.sku);
  }
  meta.queue = skus;
  meta.redo = !!body.redo;
  meta.mode = body.mode === "categories" ? "categories" : "text";
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
  const [cfg, dict] = await Promise.all([getPimConfig(), getDictionary()]);
  const [data, results] = await Promise.all([db.get(PK.rows(id)), db.get(PK.results(id))]);
  const h = buildHierarchy(data.rows, dict);
  const includePending = query.get("pending") === "1";
  const cols = new Set(), prodCols = new Set(), modelCols = new Set();
  const rows = [];
  for (const r of data.rows) {
    const res = results?.[r.sku]?.fields || {};
    const model = isModelRow(r);
    const out = { sku: r.sku };
    for (const [col, v] of Object.entries(res)) {
      if (!canEdit(r, col, cfg, h)) continue; // never export a value on a level Akeneo would reject
      if (v.status === "accepted" || (includePending && v.status === "pending")) {
        if (String(v.value) !== String(r[col] ?? "")) { out[col] = v.value; cols.add(col); (model ? modelCols : prodCols).add(col); }
      }
    }
    if (Object.keys(out).length > 1) rows.push({ out, r, model });
  }
  const changes = rows.reduce((n, x) => n + Object.keys(x.out).length - 1, 0);
  // Akeneo identity columns: products by sku, product models by code (+ parent)
  const ident = (r, model) => (h.hasModels ? { entity_type: model ? "product_model" : "product", code: model ? r.code || r.sku : "", sku: model ? "" : r.sku, parent: r.parent || "" } : { sku: r.sku });
  if (query.get("full") === "1") {
    const byChanged = new Map(rows.map((x) => [x.r.sku, x.out]));
    const idCols = h.hasModels ? ["entity_type", "code", "sku", "parent"] : ["sku"];
    const headers = [...new Set([...idCols, ...data.headers, ...[...cols].filter((c) => !data.headers.includes(c)).sort()])];
    const full = data.rows.filter((r) => !r._virtual || byChanged.has(r.sku)).map((r) => { const m = isModelRow(r); return { ...r, ...(byChanged.get(r.sku) || {}), ...ident(r, m) }; });
    return { headers, rows: full, changes, full: true };
  }
  if (h.hasModels && query.get("split") === "1") {
    return {
      changes, split: true,
      files: [
        { name: "produtos", headers: ["sku", ...[...prodCols].sort()], rows: rows.filter((x) => !x.model).map((x) => x.out) },
        { name: "modelos", headers: ["code", ...[...modelCols].sort()], rows: rows.filter((x) => x.model).map((x) => ({ ...x.out, code: x.r.code || x.r.sku })) },
      ].filter((f) => f.rows.length),
    };
  }
  const headers = h.hasModels ? ["entity_type", "code", "sku", "parent", ...[...cols].sort()] : ["sku", ...[...cols].sort()];
  return { headers, rows: rows.map((x) => ({ ...x.out, ...ident(x.r, x.model) })), changes, models: h.hasModels };
});

// ------------------------------------------------------------------ category proposals (review list)
route("GET", "/jobs/:id/categories", async ({ id }) => {
  const [dict, data, results] = await Promise.all([getDictionary(), db.get(PK.rows(id)), db.get(PK.results(id))]);
  const cctx = categoryContext(data.rows, dict);
  const lab = (c) => ({ code: c, label: humanCat(c, cctx.tax) });
  const cfg = await getPimConfig();
  const items = [];
  for (const r of data.rows) {
    if (isModelRow(r)) continue;
    const sg = results?.[r.sku]?.fields?.categories;
    const flags = checkCategories(r, cctx, cfg).flags.map((f) => f.msg);
    if (!sg && !flags.length) continue;
    const base = { sku: r.sku, name: r["ATT_NAME-pt_PT-ecommerce"] || "", family: r.family, flags, current: splitCats(r.categories).filter((c) => c.startsWith("ecom_")).map(lab) };
    if (!sg) { items.push({ ...base, add: [], remove: [], source: null, status: "none", reason: "Ainda sem análise da AI — corre \"Propor re-categorização (AI)\"." }); continue; }
    items.push({ ...base, add: (sg.catDiff?.add || []).map(lab), remove: (sg.catDiff?.remove || []).map(lab), source: sg.source, status: sg.status, reason: sg.reason || "", aiView: sg.aiView || "" });
  }
  return { items };
});

route("POST", "/jobs/:id/categories/:sku", async ({ id, sku, body }) => {
  const results = (await db.get(PK.results(id))) || {};
  const f = results[decodeURIComponent(sku)]?.fields?.categories;
  if (!f) throw httpError(404, "Sem proposta");
  f.status = body.status === "accepted" ? "accepted" : body.status === "rejected" ? "rejected" : "pending";
  await db.set(PK.results(id), results);
  return { ok: true, status: f.status };
});

// ------------------------------------------------------------------ images
route("POST", "/jobs/:id/images", async ({ id, req }) => {
  await job(id);
  const res = await fetch(`${new URL(req.url).origin}/.netlify/functions/pim-images-background`, {
    method: "POST", headers: { authorization: `Bearer ${process.env.APP_PASSWORD}`, "content-type": "application/json" }, body: JSON.stringify({ id }),
  });
  if (res.status !== 202 && !res.ok) throw httpError(500, `Não foi possível iniciar (${res.status})`);
  return { started: true };
});
route("GET", "/jobs/:id/images", async ({ id }) => (await db.get(PK.images(id))) || { items: {} });

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
