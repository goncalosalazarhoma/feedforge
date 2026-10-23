// Background function: AI optimisation of an uploaded PIM file (up to 15 min, resumable).
import { db } from "../lib/store.mjs";
import { authorized } from "../lib/http.mjs";
import { mapLimit } from "../lib/util.mjs";
import { PK, getPimConfig, columnFor, isEditable, diagnose, productFacts, campaignText, optimizeProducts, cleanAi, refreshMeta, getDictionary, fieldsFor } from "../lib/pim.mjs";

export async function runPimJob(id, { deadline = Date.now() + 13.5 * 60 * 1000 } = {}) {
  const lock = await db.get(PK.lock(id));
  if (lock && Date.now() - lock.at < 16 * 60 * 1000) return { skipped: true };
  await db.set(PK.lock(id), { at: Date.now() });
  try {
    const [cfg, dict, data, meta] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id)), db.get(PK.job(id))]);
    const bySku = new Map(data.rows.map((r) => [r.sku, r]));
    const queue = (meta.queue || []).filter((s) => bySku.has(s));
    const batches = [];
    for (let i = 0; i < queue.length; i += 3) batches.push(queue.slice(i, i + 3));
    const generated = {};
    let errors = 0, fatal = null, done = 0;

    const flush = async () => {
      const results = (await db.get(PK.results(id))) || {};
      for (const [sku, fields] of Object.entries(generated)) {
        const cur = results[sku] || { fields: {} };
        for (const [col, value] of Object.entries(fields)) {
          // never overwrite something the user already accepted or edited
          const prev = cur.fields[col];
          if (prev && (prev.status === "accepted" || prev.source === "manual" || prev.source === "ai+edit")) continue;
          cur.fields[col] = { value, source: "ai", status: "pending" };
        }
        results[sku] = { ...cur, at: new Date().toISOString() };
        delete generated[sku];
      }
      await db.set(PK.results(id), results);
      const m = await db.get(PK.job(id));
      m.progress = { ...(m.progress || {}), done, errors, fatal: fatal?.message };
      m.queue = queue.slice(0); // remaining computed below
      await db.set(PK.job(id), m);
      await db.set(PK.lock(id), { at: Date.now() });
    };

    const processed = new Set();
    await mapLimit(batches, 3, async (skus) => {
      if (fatal || Date.now() > deadline) return;
      const items = skus.map((sku) => {
        const row = bySku.get(sku);
        const flags = diagnose(row, data.headers, cfg, dict || {}).filter((f) => !f.field.startsWith("_")).map((f) => f.msg);
        const facts = productFacts(row, dict || {}, cfg);
        return { facts, flags, campaign: facts.sazonal ? campaignText(facts.descricao_atual) : "" };
      });
      try {
        const res = await optimizeProducts(items, cfg);
        for (const sku of skus) {
          const per = res[sku] || res[String(Number(sku))];
          if (!per) { errors++; continue; }
          const out = {};
          for (const loc of cfg.targetLocales) {
            for (const attr of fieldsFor(loc, cfg)) {
              const v = per?.[loc]?.[attr];
              const col = columnFor(data.headers, attr, loc, cfg.channel);
              if (v && isEditable(col, cfg)) out[col] = cleanAi(attr, v, cfg);
            }
          }
          generated[sku] = out;
          processed.add(sku);
        }
      } catch (e) {
        if (e.fatal) fatal = e; else errors++;
        console.error("[pim]", e.message);
      }
      done += skus.length;
      if (Object.keys(generated).length >= 15) await flush();
    });
    await flush();
    const m = await db.get(PK.job(id));
    m.queue = queue.filter((s) => !processed.has(s));
    m.progress = { ...(m.progress || {}), done: processed.size, errors, fatal: fatal?.message, finishedAt: new Date().toISOString(), remaining: m.queue.length };
    await db.set(PK.job(id), m);
    return m.progress;
  } finally {
    await db.del(PK.lock(id));
  }
}

export default async (req) => {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id) return new Response("id em falta", { status: 400 });
  try {
    const p = await runPimJob(id);
    console.log("[pim] done", id, JSON.stringify(p));
    await refreshMeta(id, await db.get(PK.job(id))); // refresh suggested/pending counts
  } catch (e) {
    console.error("[pim] falhou", e.message);
  }
};
