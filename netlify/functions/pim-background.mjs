// Background function: AI optimisation of an uploaded PIM file (up to 15 min, resumable).
import { db } from "../lib/store.mjs";
import { authorized } from "../lib/http.mjs";
import { mapLimit } from "../lib/util.mjs";
import { PK, getPimConfig, columnFor, isEditable, diagnose, productFacts, campaignText, optimizeProducts, cleanAi, refreshMeta, getDictionary, fieldsFor } from "../lib/pim.mjs";

const nums = (s) => (String(s || "").match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(",", "."))).sort((a, b) => a - b).join("|");
// Guardrails: the AI must not change facts stated in the original name
function guard(attr, loc, value, row, cfg, dict) {
  if (attr === "ATT_LONG_DESCRIPTION") {
    const src = JSON.stringify(row).toLowerCase();
    const invented = ["natura", "artesana", "feito à mão", "hecho a mano", "resistente à água", "impermeável", "intempéries", "intemperie"].filter((w) => value.toLowerCase().includes(w) && !src.includes(w));
    return invented.length ? `Possível característica inventada: ${invented.join(", ")}` : null;
  }
  if (!["ATT_NAME", "ATT_PLP_NAME"].includes(attr)) return null;
  const orig = row[`ATT_NAME-${cfg.sourceLocale}-${cfg.channel}`] || "";
  const on = nums(orig), nn = nums(value);
  if (attr === "ATT_NAME" && on && nn !== on) return `Medidas diferentes do nome original ("${orig}")`;
  if (attr === "ATT_PLP_NAME" && nn && on && !on.includes(nn.split("|")[0])) return `Medidas diferentes do nome original ("${orig}")`;
  if (loc === cfg.sourceLocale) {
    const low = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const mats = Object.values(dict?.options?.ATT_MATERIAL || {}).map((o) => low(o.pt_PT)).filter((m) => m.length > 3);
    const lost = mats.filter((m) => new RegExp(`\\b${m}\\b`).test(low(orig)) && !new RegExp(`\\b${m}\\b`).test(low(value)));
    const argila = /argila|barro|ceramica|madeira|bambu|vidro|metal|algodao|linho|veludo/.exec(low(orig));
    if (lost.length || (argila && !low(value).includes(argila[0]))) return `Material do nome original alterado ("${orig}")`;
  }
  return null;
}

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
          if (prev && (prev.source === "manual" || prev.source === "ai+edit")) continue;
          if (prev && prev.status === "accepted" && !meta.redo) continue;
          const v = typeof value === "object" ? value : { value };
          cur.fields[col] = { value: v.value, source: "ai", status: "pending", ...(v.warning ? { warning: v.warning } : {}) };
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
              if (v && isEditable(col, cfg)) {
                let clean = cleanAi(attr, v, cfg);
                // campaign text only where the original had it (the model sometimes copies it from another product in the batch)
                const item = items[skus.indexOf(sku)];
                if (attr === "ATT_LONG_DESCRIPTION" && !item?.campaign) clean = clean.replace(/\s*\|?\s*¡?h[oô]!\s*¡?h[oô]!\s*¡?h[oô]ma![\s\S]*?(?=\s\|\s|$)/i, "").replace(/\s{2,}/g, " ").trim();
                const warning = guard(attr, loc, clean, bySku.get(sku), cfg, dict);
                out[col] = warning ? { value: clean, warning } : clean;
              }
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
