// The daily pipeline: fetch -> diff vs yesterday -> AI (new products only) -> rules -> edits -> locks -> Meta + GMC -> Sheets.
import { db, K, getConfig } from "./store.mjs";
import { fetchCsv, hash, hashFields, todayLisbon, daysBetween, mapLimit } from "./util.mjs";
import { applyRules, activeRules, usesDateFields } from "./rules.mjs";
import { checkQuality, duplicateTitles } from "./quality.mjs";
import { optimizeBatch, aiInputHash } from "./ai.mjs";
import { autoMapping, convertRow, gmcHeaders } from "./gmc.mjs";
import { writeTab, csvExportUrl } from "./sheets.mjs";

const LOCK_TTL = 20 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure transformation of ONE product (used by the run, the UI detail view and previews)
// ---------------------------------------------------------------------------
// AI copy goes live only once accepted (entries without status = legacy, already live)
export const aiLive = (e) => !!e && (!e.status || e.status === "accepted");
export const needsApproval = (cfg) => cfg.ai?.requireApproval !== false;

export function processOne(src, cfg, { ai = {}, overrides = {}, state = {}, today = todayLisbon(), rules, useAi = true, ruleCache = null } = {}) {
  rules ??= activeRules(cfg.rules, today);
  const id = String(src[cfg.idField] ?? "");
  const locked = cfg.lockedFields || [];
  const lockedSet = new Set(locked);
  const steps = { source: src };

  let row = { ...src };
  const aiFields = useAi && aiLive(ai[id]) ? ai[id].fields : null;
  if (aiFields) {
    for (const [f, v] of Object.entries(aiFields)) if (!lockedSet.has(f) && cfg.ai.fields.includes(f)) row[f] = v;
  }
  steps.ai = { ...row };

  const p = state.products?.[id];
  const first = p?.first || today;
  const meta = { isNew: first === today, daysSinceFirstSeen: daysBetween(first, today) };
  // Rules/labels are computed once per product and cached; recomputed only when the
  // product's input changes, it is new, or the set of active rules changes (edit or schedule).
  let r;
  if (ruleCache) {
    const inKey = hash(row) + (ruleCache.dynamic ? `:${meta.daysSinceFirstSeen}` : "");
    const c = ruleCache.items[id];
    if (c && c.k === inKey) {
      r = { row: { ...row, ...c.d }, excluded: c.ex, applied: c.ap, blocked: c.bl };
      ruleCache.hits++;
    } else {
      r = applyRules(rules, row, { locked, meta });
      const d = {};
      for (const k of Object.keys(r.row)) if (r.row[k] !== row[k]) d[k] = r.row[k];
      ruleCache.misses++;
      ruleCache.next[id] = { k: inKey, d, ex: r.excluded, ap: r.applied, bl: r.blocked };
    }
    if (c && c.k === inKey) ruleCache.next[id] = c;
  } else {
    r = applyRules(rules, row, { locked, meta });
  }
  row = r.row;
  steps.rules = { ...row };

  const ov = overrides[id] || {};
  for (const [f, v] of Object.entries(ov)) if (!lockedSet.has(f)) row[f] = v;

  // locked fields: always the raw source value, whatever happened above
  for (const f of locked) if (f in src) row[f] = src[f];

  return { id, row, excluded: r.excluded, appliedRules: r.applied, blocked: r.blocked, isNew: meta.isNew, firstSeen: first, steps };
}

export function mappingFor(cfg, headers) {
  return cfg.gmc?.mapping?.length ? cfg.gmc.mapping : autoMapping(headers);
}

// Prepare the rule cache for today: invalidated whenever the active rule set (or locks) changes.
export function prepareRuleCache(cfg, stored, today = todayLisbon()) {
  const rules = activeRules(cfg.rules, today);
  const key = hash({ rules: rules.map(({ name, ...r }) => r), locked: cfg.lockedFields });
  const valid = stored && stored.key === key;
  return { key, rules, dynamic: usesDateFields(rules), items: valid ? stored.items : {}, next: {}, hits: 0, misses: 0, invalidated: !!stored && !valid };
}

export function buildOutputs(cfg, source, { ai = {}, overrides = {}, state = {}, today = todayLisbon(), ruleCache = null } = {}) {
  const rules = ruleCache?.rules ?? activeRules(cfg.rules, today);
  const processed = source.rows.map((src) => processOne(src, cfg, { ai, overrides, state, today, rules, ruleCache }));
  const dups = duplicateTitles(processed.map((p) => p.row));

  const extra = new Set();
  for (const p of processed) for (const k of Object.keys(p.row)) if (!k.startsWith("_") && !source.headers.includes(k)) extra.add(k);
  const metaHeaders = [...source.headers, ...extra];
  const mapping = mappingFor(cfg, metaHeaders);
  const gHeaders = gmcHeaders(mapping);

  const meta = [], gmc = [], index = [];
  const flagCount = {};
  for (const p of processed) {
    const flags = checkQuality(p.row, cfg.quality, dups);
    for (const f of flags) flagCount[`${f.field}:${f.code}`] = (flagCount[`${f.field}:${f.code}`] || 0) + 1;
    if (!p.excluded.meta) meta.push(p.row);
    if (cfg.gmc?.enabled !== false && !p.excluded.gmc) gmc.push(convertRow(p.row, mapping, { currency: cfg.gmc?.currency }));
    index.push({
      id: p.id,
      title: p.row.title ?? "",
      image: p.row.image_link ?? "",
      price: p.row.price ?? "",
      availability: p.row.availability ?? "",
      isNew: p.isNew,
      firstSeen: p.firstSeen,
      ai: aiLive(ai[p.id]),
      aiPending: ai[p.id]?.status === "pending",
      edited: !!overrides[p.id] && Object.keys(overrides[p.id]).length > 0,
      excluded: p.excluded,
      flags: flags.map((f) => `${f.field}:${f.code}`),
      rules: p.appliedRules.length,
    });
  }
  return {
    meta: { headers: metaHeaders, rows: meta },
    gmc: { headers: gHeaders, rows: gmc },
    index,
    flagCount,
    mapping,
  };
}

// ---------------------------------------------------------------------------
// Diff today's source against yesterday's state
// ---------------------------------------------------------------------------
export function diffSource(rows, cfg, prevProducts = {}, today = todayLisbon()) {
  const locked = cfg.lockedFields || [];
  const seen = new Set();
  const products = {};
  const d = { new: [], removed: [], changedContent: [], changedLocked: [], unchanged: 0, duplicates: [] };
  const clean = [];

  for (const row of rows) {
    const id = String(row[cfg.idField] ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) { d.duplicates.push(id); continue; }
    seen.add(id);
    clean.push(row);
    const c = hashFields(row, locked, { exclude: true });
    const l = hashFields(row, locked);
    const prev = prevProducts[id];
    if (!prev) d.new.push(id);
    else if (prev.c !== c) d.changedContent.push(id);
    else if (prev.l !== l) d.changedLocked.push(id);
    else d.unchanged++;
    products[id] = { c, l, first: prev?.first || today, last: today };
  }
  for (const id of Object.keys(prevProducts)) if (!seen.has(id)) d.removed.push(id);
  return { diff: d, products, rows: clean };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
export async function runFeed(feedId, { mode = "full", trigger = "manual", deadline = Date.now() + 13 * 60 * 1000 } = {}) {
  const started = Date.now();
  const today = todayLisbon();
  const log = { id: `${started}`, feedId, mode, trigger, startedAt: new Date(started).toISOString(), steps: [], status: "running" };
  const step = (msg) => log.steps.push({ t: Date.now() - started, msg });

  const lock = await db.get(K.lock(feedId));
  if (lock && Date.now() - lock.at < LOCK_TTL) throw new Error("Já existe um run em curso para este feed");
  await db.set(K.lock(feedId), { at: Date.now(), runId: log.id });

  try {
    const cfg = await getConfig(feedId);
    const state = (await db.get(K.state(feedId))) || {};
    state.products ||= {};
    state.aiQueue ||= [];
    state.aiFails ||= {};
    const ai = (await db.get(K.ai(feedId))) || {};
    const overrides = (await db.get(K.overrides(feedId))) || {};
    let source;

    if (mode === "rebuild") {
      source = await db.get(K.source(feedId));
      if (!source) throw new Error("Ainda não existe nenhum feed descarregado — corre um run completo primeiro");
      step(`Rebuild a partir do feed de ${source.fetchedAt}`);
    } else {
      if (!cfg.sourceUrl) throw new Error("URL do feed de origem não configurado");
      const fetched = await fetchCsv(cfg.sourceUrl);
      step(`Feed descarregado: ${fetched.rows.length} linhas, ${fetched.headers.length} colunas`);
      if (!fetched.headers.includes(cfg.idField)) throw new Error(`Coluna de ID "${cfg.idField}" não existe no CSV`);

      const prevCount = Object.keys(state.products).length;
      const { diff, products, rows } = diffSource(fetched.rows, cfg, state.products, today);
      if (prevCount > 0 && rows.length < prevCount * (cfg.minRowRatio ?? 0.5)) {
        throw new Error(`Abortado por segurança: o feed de hoje tem ${rows.length} produtos vs ${prevCount} ontem (< ${Math.round((cfg.minRowRatio ?? 0.5) * 100)}%). O Sheets ficou com a versão anterior.`);
      }
      log.diff = { new: diff.new.length, removed: diff.removed.length, changedContent: diff.changedContent.length, changedLocked: diff.changedLocked.length, unchanged: diff.unchanged, duplicates: diff.duplicates.length };
      log.diffSample = { new: diff.new.slice(0, 50), removed: diff.removed.slice(0, 50), changedContent: diff.changedContent.slice(0, 50) };
      step(`Diferenças vs dia anterior: +${diff.new.length} novos, −${diff.removed.length} removidos, ${diff.changedContent.length} com conteúdo alterado, ${diff.changedLocked.length} só stock/preço, ${diff.unchanged} iguais`);

      source = { headers: fetched.headers, rows, fetchedAt: new Date().toISOString(), warnings: fetched.warnings };
      state.products = products;

      // ---- AI queue: only new products (+ explicit requests, + changed if enabled)
      const present = new Set(Object.keys(products));
      const requests = (await db.get(K.aiRequests(feedId))) || [];
      // drop queued ids that meanwhile got AI copy accepted in the UI
      const queue = new Set((state.aiQueue || []).filter((id) => present.has(id) && !ai[id]));
      for (const id of requests) if (present.has(id)) queue.add(id);
      const candidates = [...diff.new, ...(cfg.ai.reoptimizeOnSourceChange ? diff.changedContent : [])];
      if (cfg.ai.enabled && candidates.length) {
        const byId = new Map(rows.map((r) => [String(r[cfg.idField]), r]));
        for (const id of candidates) {
          if (ai[id] && !cfg.ai.reoptimizeOnSourceChange) continue;
          const pre = processOne(byId.get(id), cfg, { ai: {}, overrides, state, today });
          const flags = checkQuality(pre.row, cfg.quality);
          if (cfg.ai.mode === "all" || flags.some((f) => cfg.ai.fields.includes(f.field))) queue.add(id);
        }
      }
      state.aiQueue = [...queue];
      if (requests.length) await db.set(K.aiRequests(feedId), []);
      for (const id of diff.removed) delete state.aiFails?.[id];
    }

    // ---- AI processing (budgeted + time-boxed; the remainder stays queued for tomorrow)
    const generated = {};
    if (mode === "full" && cfg.ai.enabled && state.aiQueue.length) {
      if (!process.env.ANTHROPIC_API_KEY) step("AI ignorada: ANTHROPIC_API_KEY não definida");
      else {
        const byId = new Map(source.rows.map((r) => [String(r[cfg.idField]), r]));
        const take = state.aiQueue.slice(0, cfg.ai.maxPerRun || 300);
        const batches = [];
        for (let i = 0; i < take.length; i += 5) batches.push(take.slice(i, i + 5));
        let errors = 0;
        let fatal = null; // invalid key / model: stop AI, don't penalise products
        await mapLimit(batches, 3, async (ids) => {
          if (fatal || Date.now() > deadline - 90_000) return;
          const items = ids.filter((id) => byId.has(id)).map((id) => {
            const pre = processOne(byId.get(id), cfg, { ai: {}, overrides, state, today, rules: [] });
            return { row: byId.get(id), flags: checkQuality(pre.row, cfg.quality) };
          });
          try {
            const res = await optimizeBatch(items, cfg, { idField: cfg.idField });
            for (const it of items) {
              const id = String(it.row[cfg.idField]);
              if (res[id] && Object.keys(res[id]).length) {
                generated[id] = { fields: res[id], inputHash: aiInputHash(it.row, cfg), at: new Date().toISOString(), model: cfg.ai.model, status: needsApproval(cfg) ? "pending" : "accepted" };
              } else {
                state.aiFails[id] = (state.aiFails[id] || 0) + 1;
              }
            }
          } catch (e) {
            if (e.fatal) {
              if (!fatal) { fatal = e; step(`AI parada: ${e.message} — verifica ANTHROPIC_API_KEY / modelo. Os produtos continuam na fila.`); }
              return;
            }
            errors++;
            for (const id of ids) state.aiFails[id] = (state.aiFails[id] || 0) + 1;
            if (errors <= 3) step(`Erro AI: ${e.message}`);
          }
        });
        state.aiQueue =state.aiQueue.filter((id) => !generated[id] && (state.aiFails[id] || 0) < 3);
        Object.assign(ai, generated);
        log.ai = { optimized: Object.keys(generated).length, remaining: state.aiQueue.length, errors, fatal: fatal?.message };
        step(`AI: ${Object.keys(generated).length} produtos otimizados, ${state.aiQueue.length} em fila`);
      }
    }

    // ---- Build outputs
    const ruleCache = prepareRuleCache(cfg, await db.get(K.ruleCache(feedId)), today);
    const out = buildOutputs(cfg, source, { ai, overrides, state, today, ruleCache });
    log.rules = { active: ruleCache.rules.length, recalculated: ruleCache.misses, cached: ruleCache.hits };
    step(`Regras/labels: ${ruleCache.rules.length} ativas · ${ruleCache.misses} produtos calculados${ruleCache.invalidated ? " (regras ou agendamentos mudaram)" : ""}, ${ruleCache.hits} reutilizados da cache`);
    log.output = { meta: out.meta.rows.length, gmc: out.gmc.rows.length, flagged: out.index.filter((i) => i.flags.length).length };
    step(`Output: ${out.meta.rows.length} produtos Meta, ${out.gmc.rows.length} produtos GMC`);

    // ---- Google Sheets
    const links = {};
    if (cfg.sheetId) {
      const m = await writeTab(cfg.sheetId, cfg.sheetTabs.meta, out.meta.headers, out.meta.rows);
      links.meta = csvExportUrl(cfg.sheetId, m.gid);
      if (cfg.gmc?.enabled !== false) {
        const g = await writeTab(cfg.sheetId, cfg.sheetTabs.gmc, out.gmc.headers, out.gmc.rows);
        links.gmc = csvExportUrl(cfg.sheetId, g.gid);
      }
      step("Google Sheets atualizado");
    } else step("Sheets não configurado — output guardado só na app");

    // ---- Persist (merge AI with anything accepted in the UI meanwhile)
    const freshAi = (await db.get(K.ai(feedId))) || {};
    await db.set(K.ai(feedId), { ...freshAi, ...generated });
    state.lastRunAt = new Date().toISOString();
    if (mode === "full" && trigger === "schedule") state.lastRunDate = today;
    await db.set(K.state(feedId), state);
    if (mode === "full") await db.set(K.source(feedId), source);
    await db.set(K.ruleCache(feedId), { key: ruleCache.key, items: ruleCache.next });
    await db.set(K.output(feedId), { meta: out.meta, gmc: out.gmc, index: out.index, flagCount: out.flagCount, links, generatedAt: new Date().toISOString() });

    log.status = "ok";
    log.links = links;
    return log;
  } catch (e) {
    log.status = "error";
    log.error = e.message;
    step(`ERRO: ${e.message}`);
    throw Object.assign(e, { log });
  } finally {
    log.finishedAt = new Date().toISOString();
    log.durationMs = Date.now() - started;
    const runs = (await db.get(K.runs(feedId))) || [];
    await db.set(K.runs(feedId), [log, ...runs].slice(0, 40));
    await db.del(K.lock(feedId));
  }
}
