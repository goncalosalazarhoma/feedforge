// JSON API for the UI. All routes require  Authorization: Bearer <APP_PASSWORD>.
import { db, K, listFeeds, getConfig, httpError } from "../lib/store.mjs";
import { defaultConfig, LABEL_FIELDS, AI_FIELD_PRESETS } from "../lib/defaults.mjs";
import { fetchCsv, toCsv, todayLisbon } from "../lib/util.mjs";
import { processOne, buildOutputs, mappingFor } from "../lib/pipeline.mjs";
import { checkQuality } from "../lib/quality.mjs";
import { applyRules, OPS, ACTIONS } from "../lib/rules.mjs";
import { optimizeBatch, aiInputHash } from "../lib/ai.mjs";
import { autoMapping, convertRow, TRANSFORMS } from "../lib/gmc.mjs";
import { serviceAccountEmail } from "../lib/sheets.mjs";
import { json, authorized, triggerRun } from "../lib/http.mjs";

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, handler });
};

// ---------------------------------------------------------------- meta
route("GET", "/me", async () => ({
  ok: true,
  serviceAccount: serviceAccountEmail(),
  hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
  hasGoogle: !!serviceAccountEmail(),
  ops: Object.keys(OPS),
  actions: ACTIONS,
  transforms: TRANSFORMS,
  labelFields: LABEL_FIELDS,
  aiPresets: AI_FIELD_PRESETS,
}));

// ---------------------------------------------------------------- feeds
route("GET", "/feeds", async () => {
  const feeds = await listFeeds();
  return Promise.all(feeds.map(async (f) => {
    const runs = (await db.get(K.runs(f.id))) || [];
    return { ...f, lastRun: runs[0] ? { status: runs[0].status, finishedAt: runs[0].finishedAt, diff: runs[0].diff, output: runs[0].output } : null };
  }));
});

route("POST", "/feeds", async ({ body }) => {
  const name = String(body.name || "").trim();
  if (!name) throw httpError(400, "Nome obrigatório");
  const id = (body.id || name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const feeds = await listFeeds();
  if (feeds.some((f) => f.id === id)) throw httpError(409, "Já existe um feed com esse id");
  const cfg = defaultConfig({ id, name, language: body.language || "pt-PT" });
  if (body.sourceUrl) cfg.sourceUrl = body.sourceUrl;
  await db.set(K.config(id), cfg);
  await db.set(K.feeds(), [...feeds, { id, name }]);
  return cfg;
});

route("GET", "/feeds/:f", async ({ f }) => getConfig(f));

route("PUT", "/feeds/:f", async ({ f, body }) => {
  const cfg = await getConfig(f);
  const allowed = ["name", "language", "sourceUrl", "idField", "sheetId", "sheetTabs", "runHour", "scheduleEnabled", "minRowRatio", "lockedFields", "rules", "quality", "ai", "gmc"];
  for (const k of allowed) if (k in body) cfg[k] = body[k];
  if (cfg.sheetId && cfg.sheetId.includes("/d/")) cfg.sheetId = cfg.sheetId.split("/d/")[1].split("/")[0];
  if (!cfg.lockedFields.includes(cfg.idField)) cfg.lockedFields.unshift(cfg.idField);
  cfg.updatedAt = new Date().toISOString();
  await db.set(K.config(f), cfg);
  if ("name" in body) {
    const feeds = await listFeeds();
    await db.set(K.feeds(), feeds.map((x) => (x.id === f ? { ...x, name: cfg.name } : x)));
  }
  return cfg;
});

route("DELETE", "/feeds/:f", async ({ f }) => {
  const feeds = await listFeeds();
  await db.set(K.feeds(), feeds.filter((x) => x.id !== f));
  for (const k of ["config", "state", "ai", "aiRequests", "overrides", "source", "output", "runs", "lock", "ruleCache"]) await db.del(K[k](f));
  return { ok: true };
});

route("POST", "/feeds/:f/test-source", async ({ f, body }) => {
  const cfg = await getConfig(f);
  const url = body.url || cfg.sourceUrl;
  if (!url) throw httpError(400, "Indica o URL do CSV");
  const t = Date.now();
  const src = await fetchCsv(url);
  return { headers: src.headers, count: src.rows.length, sample: src.rows.slice(0, 5), warnings: src.warnings, ms: Date.now() - t, hasId: src.headers.includes(cfg.idField) };
});

route("GET", "/feeds/:f/summary", async ({ f }) => {
  const cfg = await getConfig(f);
  const [out, state, runs, requests, lock, source] = await Promise.all([
    db.get(K.output(f)), db.get(K.state(f)), db.get(K.runs(f)), db.get(K.aiRequests(f)), db.get(K.lock(f)), db.get(K.source(f)),
  ]);
  return {
    config: cfg,
    running: !!(lock && Date.now() - lock.at < 20 * 60 * 1000),
    output: out ? { meta: out.meta.rows.length, gmc: out.gmc.rows.length, links: out.links, generatedAt: out.generatedAt, flagCount: out.flagCount,
      flagged: out.index.filter((i) => i.flags.length).length, ai: out.index.filter((i) => i.ai).length, edited: out.index.filter((i) => i.edited).length,
      isNew: out.index.filter((i) => i.isNew).length, excluded: out.index.filter((i) => i.excluded.meta || i.excluded.gmc).length } : null,
    headers: source?.headers || [],
    sourceFetchedAt: source?.fetchedAt,
    aiQueue: (state?.aiQueue?.length || 0) + (requests?.length || 0),
    runs: (runs || []).slice(0, 10),
  };
});

route("GET", "/feeds/:f/runs", async ({ f }) => (await db.get(K.runs(f))) || []);

// ---------------------------------------------------------------- products
route("GET", "/feeds/:f/products", async ({ f, query }) => {
  const out = await db.get(K.output(f));
  if (!out) return { total: 0, items: [], page: 1 };
  let items = out.index;
  const q = (query.get("q") || "").toLowerCase().trim();
  if (q) items = items.filter((i) => i.id.toLowerCase().includes(q) || i.title.toLowerCase().includes(q));
  const filter = query.get("filter") || "all";
  const flag = query.get("flag");
  if (filter === "new") items = items.filter((i) => i.isNew);
  if (filter === "flagged") items = items.filter((i) => i.flags.length);
  if (filter === "ai") items = items.filter((i) => i.ai);
  if (filter === "edited") items = items.filter((i) => i.edited);
  if (filter === "excluded") items = items.filter((i) => i.excluded.meta || i.excluded.gmc);
  if (flag) items = items.filter((i) => i.flags.includes(flag));
  const size = Math.min(Number(query.get("size")) || 50, 200);
  const page = Math.max(Number(query.get("page")) || 1, 1);
  return { total: items.length, page, size, items: items.slice((page - 1) * size, page * size), ids: query.get("ids") === "1" ? items.map((i) => i.id) : undefined };
});

async function productContext(f, id) {
  const cfg = await getConfig(f);
  const [source, ai, overrides, state] = await Promise.all([db.get(K.source(f)), db.get(K.ai(f)), db.get(K.overrides(f)), db.get(K.state(f))]);
  if (!source) throw httpError(404, "Ainda não existe feed descarregado");
  const src = source.rows.find((r) => String(r[cfg.idField]) === id);
  if (!src) throw httpError(404, "Produto não encontrado no feed atual");
  return { cfg, source, src, ai: ai || {}, overrides: overrides || {}, state: state || {} };
}

route("GET", "/feeds/:f/products/:id", async ({ f, id }) => {
  const { cfg, source, src, ai, overrides, state } = await productContext(f, decodeURIComponent(id));
  const p = processOne(src, cfg, { ai, overrides, state });
  const mapping = mappingFor(cfg, source.headers);
  return {
    id: p.id,
    headers: [...new Set([...source.headers, ...Object.keys(p.row).filter((k) => !k.startsWith("_"))])],
    source: src,
    afterAi: p.steps.ai,
    afterRules: p.steps.rules,
    final: p.row,
    gmc: convertRow(p.row, mapping, { currency: cfg.gmc?.currency }),
    ai: ai[p.id] || null,
    overrides: overrides[p.id] || {},
    locked: cfg.lockedFields,
    aiFields: cfg.ai.fields,
    excluded: p.excluded,
    appliedRules: p.appliedRules.map((rid) => cfg.rules.find((r) => r.id === rid)?.name || rid),
    blocked: p.blocked,
    flags: checkQuality(p.row, cfg.quality),
    isNew: p.isNew,
    firstSeen: p.firstSeen,
  };
});

route("PUT", "/feeds/:f/products/:id/overrides", async ({ f, id, body }) => {
  id = decodeURIComponent(id);
  const cfg = await getConfig(f);
  const all = (await db.get(K.overrides(f))) || {};
  const cur = { ...(all[id] || {}) };
  for (const [k, v] of Object.entries(body.fields || {})) {
    if (cfg.lockedFields.includes(k)) throw httpError(400, `O campo "${k}" está trancado`);
    if (v === null) delete cur[k]; else cur[k] = String(v);
  }
  if (Object.keys(cur).length) all[id] = cur; else delete all[id];
  await db.set(K.overrides(f), all);
  return { ok: true, overrides: cur };
});

route("POST", "/feeds/:f/products/:id/ai-preview", async ({ f, id }) => {
  const { cfg, src, overrides, state } = await productContext(f, decodeURIComponent(id));
  const pre = processOne(src, cfg, { ai: {}, overrides, state, rules: [] });
  const res = await optimizeBatch([{ row: src, flags: checkQuality(pre.row, cfg.quality) }], cfg, { idField: cfg.idField });
  return { suggestion: res[String(src[cfg.idField])] || {} };
});

route("POST", "/feeds/:f/products/:id/ai-accept", async ({ f, id, body }) => {
  const { cfg, src } = await productContext(f, decodeURIComponent(id));
  const all = (await db.get(K.ai(f))) || {};
  const fields = {};
  for (const [k, v] of Object.entries(body.fields || {})) if (!cfg.lockedFields.includes(k) && String(v).trim()) fields[k] = String(v);
  all[String(src[cfg.idField])] = { fields, inputHash: aiInputHash(src, cfg), at: new Date().toISOString(), model: cfg.ai.model, manual: true };
  await db.set(K.ai(f), all);
  return { ok: true };
});

route("DELETE", "/feeds/:f/products/:id/ai", async ({ f, id }) => {
  const all = (await db.get(K.ai(f))) || {};
  delete all[decodeURIComponent(id)];
  await db.set(K.ai(f), all);
  return { ok: true };
});

route("POST", "/feeds/:f/ai-requests", async ({ f, body }) => {
  const ids = (body.ids || []).map(String);
  const cur = (await db.get(K.aiRequests(f))) || [];
  const next = [...new Set([...cur, ...ids])];
  if (body.clearExisting) {
    const all = (await db.get(K.ai(f))) || {};
    for (const id of ids) delete all[id];
    await db.set(K.ai(f), all);
  }
  await db.set(K.aiRequests(f), next);
  // give these products a fresh set of AI attempts
  const state = await db.get(K.state(f));
  if (state?.aiFails) {
    for (const id of ids) delete state.aiFails[id];
    await db.set(K.state(f), state);
  }
  return { queued: next.length };
});

// ---------------------------------------------------------------- rules / mapping previews
route("POST", "/feeds/:f/rules/preview", async ({ f, body }) => {
  const cfg = await getConfig(f);
  const [source, ai, state] = await Promise.all([db.get(K.source(f)), db.get(K.ai(f)), db.get(K.state(f))]);
  if (!source) throw httpError(400, "Corre primeiro um run para descarregar o feed");
  // preview ignores schedules (so future/expired rules can be checked); disabled rules are skipped
  const rules = (body.rules || cfg.rules).filter((r) => r.enabled !== false);
  const today = todayLisbon();
  let matched = 0, excluded = 0;
  const samples = [];
  for (const src of source.rows) {
    const before = processOne(src, cfg, { ai: ai || {}, state: state || {}, today, rules: [] }).row;
    const p = processOne(src, cfg, { ai: ai || {}, state: state || {}, today, rules });
    if (p.appliedRules.length) matched++;
    if (p.excluded.meta || p.excluded.gmc) excluded++;
    if (samples.length < 25) {
      const changes = Object.keys(p.row).filter((k) => !k.startsWith("_") && String(p.row[k] ?? "") !== String(before[k] ?? "")).map((k) => ({ field: k, before: before[k] ?? "", after: p.row[k] }));
      if (changes.length || p.excluded.meta || p.excluded.gmc) samples.push({ id: p.id, changes, excluded: p.excluded, blocked: p.blocked });
    }
  }
  return { total: source.rows.length, matched, excluded, samples };
});

route("GET", "/feeds/:f/gmc/auto-mapping", async ({ f }) => {
  const source = await db.get(K.source(f));
  return autoMapping(source?.headers || []);
});

route("GET", "/feeds/:f/export/:channel", async ({ f, channel }) => {
  const out = await db.get(K.output(f));
  if (!out) throw httpError(404, "Sem output");
  const ch = channel.replace(/\.csv$/, "");
  const data = ch === "gmc" ? out.gmc : out.meta;
  return new Response(toCsv(data.headers, data.rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${f}-${ch}.csv"` },
  });
});

// ---------------------------------------------------------------- runs
route("POST", "/feeds/:f/run", async ({ f, body, req }) => {
  await getConfig(f);
  const lock = await db.get(K.lock(f));
  if (lock && Date.now() - lock.at < 20 * 60 * 1000) throw httpError(409, "Já existe um run em curso");
  await triggerRun(new URL(req.url).origin, { feedId: f, mode: body.mode === "rebuild" ? "rebuild" : "full", trigger: "manual" });
  return { started: true };
});

route("DELETE", "/feeds/:f/lock", async ({ f }) => { await db.del(K.lock(f)); return { ok: true }; });

// ---------------------------------------------------------------- handler
export default async (req) => {
  if (!authorized(req)) return json({ error: process.env.APP_PASSWORD ? "Password inválida" : "APP_PASSWORD não configurada no Netlify" }, 401);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
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

export const config = { path: "/api/*" };
