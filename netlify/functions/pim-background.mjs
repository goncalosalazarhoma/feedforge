// Background function: AI optimisation of an uploaded PIM file (up to 15 min, resumable).
import { db } from "../lib/store.mjs";
import { authorized } from "../lib/http.mjs";
import { mapLimit } from "../lib/util.mjs";
import { proposeCategoriesAI, applyCategoryChange, splitCats, ancestors, humanCat, checkCategories } from "../lib/categories.mjs";
import { categoryContext } from "../lib/pim.mjs";
import { buildHierarchy, isModelRow, canEdit, humanCode } from "../lib/pim.mjs";
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

export async function runCategoryJob(id, { deadline = Date.now() + 13.5 * 60 * 1000 } = {}) {
  const [cfg, dict, data, meta] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id)), db.get(PK.job(id))]);
  const prodRows = data.rows.filter((r) => !isModelRow(r));
  const cctx = categoryContext(prodRows, dict);
  const bySku = new Map(prodRows.map((r) => [r.sku, r]));
  const queue = (meta.queue || []).filter((s) => bySku.has(s));
  const batches = [];
  for (let i = 0; i < queue.length; i += 10) batches.push(queue.slice(i, i + 10));
  const proposals = {};
  let errors = 0, fatal = null;
  await mapLimit(batches, 3, async (skus) => {
    if (fatal || Date.now() > deadline) return;
    const items = skus.map((sku) => { const r = bySku.get(sku); return { sku, nome: r[`ATT_NAME-${cfg.sourceLocale}-${cfg.channel}`], familia: r.family, categorias_atuais: splitCats(r.categories).filter((c) => c.startsWith("ecom_")), alertas: checkCategories(r, cctx, cfg).flags.map((f) => f.msg), pvp: r["ATT_PVP-EUR"] || undefined, descricao: String(r[`ATT_LONG_DESCRIPTION-${cfg.sourceLocale}-${cfg.channel}`] || "").slice(0, 300) }; });
    try { Object.assign(proposals, await proposeCategoriesAI(items, cctx.tax, cfg)); } catch (e) { if (e.fatal) fatal = e; else errors++; console.error("[pim-cat]", e.message); }
  });
  const results = (await db.get(PK.results(id))) || {};
  let changed = 0;
  let kept = 0;
  // the AI looked at the product and changed nothing: keep its explanation visible (no change to export)
  const keep = (sku, row, prev, why) => {
    if (prev && prev.catDiff && (prev.catDiff.add.length || prev.catDiff.remove.length)) { prev.aiView = why; return; } // deterministic proposal stays; add the AI view
    (results[sku] ||= { fields: {} }).fields.categories = { value: row.categories, source: "ai", status: "kept", reason: why, catDiff: { add: [], remove: [] } };
    kept++;
  };
  for (const [sku0, p] of Object.entries(proposals)) {
    const sku = bySku.has(sku0) ? sku0 : [...bySku.keys()].find((k) => k.replace(/^0+/, "") === sku0.replace(/^0+/, "")) || sku0;
    const row = bySku.get(sku);
    if (!row) continue;
    const prev = results[sku]?.fields?.categories;
    if (prev && (prev.source === "manual" || prev.status === "accepted")) continue;
    if (!p.add.length && !p.remove.length) { keep(sku, row, prev, p.reason || "A AI considerou as categorias atuais corretas (sem justificação devolvida)."); continue; }
    // merge with deterministic proposal if any
    const remove = [...new Set([...(prev?.catDiff?.remove || []), ...p.remove])].filter((c) => !p.add.includes(c));
    let add = [...new Set([...(prev?.catDiff?.add || []), ...p.add])].filter((c) => !remove.includes(c) || p.add.includes(c));
    // drop parent-adds that only existed because of a category the AI removed
    const final = splitCats(applyCategoryChange(row.categories, add, remove)).filter((c) => c.startsWith("ecom_"));
    add = add.filter((c) => p.add.includes(c) || !(prev?.catDiff?.add || []).includes(c) || final.some((o) => o !== c && ancestors(o, cctx.tax).includes(c)) || !cctx.tax[c] || !Object.values(cctx.tax).some((v) => v.parent === c));
    const value = applyCategoryChange(row.categories, add, remove);
    if (value === row.categories) { keep(sku, row, prev, p.reason); continue; }
    (results[sku] ||= { fields: {} }).fields.categories = { value, source: "ai", status: "pending", reason: [...String(prev?.reason || "").split(" · ").filter((part) => part && !remove.some((c) => part.includes(`"${humanCat(c, cctx.tax)}"`))), p.reason].filter(Boolean).join(" · "), catDiff: { add, remove } };
    changed++;
  }
  await db.set(PK.results(id), results);
  const m = await db.get(PK.job(id));
  m.progress = { done: Object.keys(proposals).length, total: queue.length, errors, fatal: fatal?.message, finishedAt: new Date().toISOString(), remaining: 0, mode: "categories", changed, kept, noAnswer: fatal ? 0 : queue.filter((s) => !proposals[s] && !proposals[s.replace(/^0+/, "")]).length };
  m.queue = [];
  await db.set(PK.job(id), m);
  return m.progress;
}

export async function runPimJob(id, { deadline = Date.now() + 13.5 * 60 * 1000 } = {}) {
  const lock = await db.get(PK.lock(id));
  if (lock && Date.now() - lock.at < 16 * 60 * 1000) return { skipped: true };
  await db.set(PK.lock(id), { at: Date.now() });
  try {
    const [cfg, dict, data, meta] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id)), db.get(PK.job(id))]);
    const bySku = new Map(data.rows.map((r) => [r.sku, r]));
    const h = buildHierarchy(data.rows, dict || {});
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
        const src = h.hasModels ? h.mergedRow(row) : row;
        // with product models: only the fields this row owns are generated (the rest lives on another level)
        const owned = h.hasModels ? [...new Set(cfg.targetLocales.flatMap((loc) => fieldsFor(loc, cfg)))].filter((a) => !row.parent && !isModelRow(row) ? true : h.owns(row, a)) : null;
        const flags = diagnose(src, data.headers, cfg, dict || {}).filter((f) => !f.field.startsWith("_") && (!owned || owned.includes(f.field))).map((f) => f.msg);
        const facts = productFacts(src, dict || {}, cfg);
        if (owned && (row.parent || isModelRow(row))) facts.campos_a_gerar = owned;
        if (isModelRow(row)) { facts.tipo = "modelo"; facts.variantes = h.variantsOf(row, (a, v) => humanCode(v, a, dict || {}, cfg.sourceLocale)); }
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
              if (v && canEdit(bySku.get(sku), col, cfg, h)) {
                let clean = cleanAi(attr, v, cfg);
                // campaign text only where the original had it (the model sometimes copies it from another product in the batch)
                const item = items[skus.indexOf(sku)];
                if (attr === "ATT_LONG_DESCRIPTION" && !item?.campaign) clean = clean.replace(/\s*\|?\s*¡?h[oô]!\s*¡?h[oô]!\s*¡?h[oô]ma![\s\S]*?(?=\s\|\s|$)/i, "").replace(/\s{2,}/g, " ").trim();
                const warning = guard(attr, loc, clean, h.hasModels ? h.mergedRow(bySku.get(sku)) : bySku.get(sku), cfg, dict);
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
    const meta0 = await db.get(PK.job(id));
    const p = meta0?.mode === "categories" ? await runCategoryJob(id) : await runPimJob(id);
    console.log("[pim] done", id, JSON.stringify(p));
    await refreshMeta(id, await db.get(PK.job(id))); // refresh suggested/pending counts
  } catch (e) {
    console.error("[pim] falhou", e.message);
  }
};
