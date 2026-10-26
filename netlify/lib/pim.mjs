// PIM optimizer — works on Akeneo XLSX/CSV exports (columns like ATT_NAME-pt_PT-ecommerce).
import { db } from "./store.mjs";
import BUNDLED from "./akeneo-dictionary.mjs";

export const PK = {
  config: () => "pim/config",
  dictionary: () => "pim/dictionary",          // { families: { FAM_X: { label, required: { ecommerce: [attr...] } } }, options: { ATT_COLOR: { "260": { pt_PT, es_ES } } }, attributes: { ATT_X: { pt_PT, type } } }
  jobs: () => "pim/jobs/index",
  job: (id) => `pim/jobs/${id}/meta`,
  rows: (id) => `pim/jobs/${id}/rows`,
  results: (id) => `pim/jobs/${id}/results`,   // { [sku]: { fields: { col: { value, source: "ai"|"fix"|"manual", status: "pending"|"accepted"|"rejected" } }, at } }
  lock: (id) => `pim/jobs/${id}/lock`,
};

// ---------------------------------------------------------------------------- config
export function defaultPimConfig() {
  return {
    channel: "ecommerce",
    sourceLocale: "pt_PT",
    targetLocales: ["pt_PT", "es_ES"],
    // Attribute codes that may be written (any locale; channel-scoped ones only for `channel`).
    // Everything else is locked and never exported.
    editable: ["ATT_NAME", "ATT_PLP_NAME", "ATT_LONG_DESCRIPTION"],
    // fields the AI generates per locale
    aiFields: ["ATT_NAME", "ATT_PLP_NAME", "ATT_LONG_DESCRIPTION"],
    // generated only for the other locales (PT stays as is) — both are required for ES completeness
    translateOnly: ["ATT_SHORT_DESCRIPTION", "ATT_PLP_DESCRIPTION"],
    seasonalValues: ["permanent_seasonal", "Promocional"],
    seasonalCategoryPattern: "Christmas|Natal|Halloween|Easter|Pascoa|Summer|Verao",
    limits: { ATT_NAME: 70, ATT_PLP_NAME: 60, ATT_SHORT_DESCRIPTION: 40, longMin: 400, longMax: 1200 },
    model: "claude-haiku-4-5",
    brandVoice: "hôma é uma marca portuguesa de casa e decoração: tom próximo, acolhedor e prático.",
    instructions: {
      ATT_NAME: "Nome de produto claro: [tipo de produto] + [característica principal] + [material/cor] + [medida quando relevante]. Primeira letra maiúscula; marcas e coleções como no original. Sem promoções.",
      ATT_PLP_NAME: "Versão curta do nome para listagens (PLP), sem repetir a medida se não for diferenciadora.",
      ATT_SHORT_DESCRIPTION: "Só ES: tradução da descrição curta PT (máx. 40 caracteres — limite do Akeneo/ERP), em maiúsculas se a PT estiver em maiúsculas.",
      ATT_PLP_DESCRIPTION: "Só ES: descrição PLP no formato da PT ('<medidas> | <COR>'), mas com as medidas do campo 'dimensoes' (a PT pode ter medidas erradas) e a cor de 'rotulos_es' em maiúsculas. Ex.: '240 x 140 x 0,3 cm | DORADO'.",
      ATT_LONG_DESCRIPTION: "Descrição otimizada para SEO e GEO (motores de pesquisa e assistentes de IA): 1.ª frase responde 'o que é e para que serve' com a palavra-chave principal; depois benefícios e utilizações reais; termina com a linha de especificações no formato ' | Dimensão: … | Material: … | Cor: …' usando só dados fornecidos. Linguagem natural, sem keyword stuffing, sem HTML.",
    },
  };
}

export async function getPimConfig() {
  const c = await db.get(PK.config());
  return { ...defaultPimConfig(), ...(c || {}) };
}

// ---------------------------------------------------------------------------- columns
// "ATT_NAME-pt_PT-ecommerce" -> { attr, locale, channel }, "ATT_PVP-EUR" -> { attr, currency }, "X-unit" -> { attr, unit:true }
export function parseColumn(col) {
  const parts = String(col).split("-");
  const out = { col, attr: parts[0], locale: null, channel: null, unit: false, currency: null };
  for (const p of parts.slice(1)) {
    if (p === "unit") out.unit = true;
    else if (/^[a-z]{2}_[A-Z]{2}$/.test(p)) out.locale = p;
    else if (/^[A-Z]{3}$/.test(p)) out.currency = p;
    else out.channel = p;
  }
  return out;
}

export function columnFor(headers, attr, locale, channel) {
  // existing header first; otherwise build the canonical Akeneo name
  const found = headers.find((h) => { const p = parseColumn(h); return p.attr === attr && !p.unit && p.locale === locale && (p.channel === channel || (!p.channel && channel === null)); });
  if (found) return found;
  const scoped = headers.some((h) => { const p = parseColumn(h); return p.attr === attr && p.channel; });
  return [attr, locale, scoped ? channel : null].filter(Boolean).join("-");
}

export function isEditable(col, cfg) {
  const p = parseColumn(col);
  if (p.unit || p.currency) return false;
  if (p.channel && p.channel !== cfg.channel) return false;
  if (cfg.editable.includes(p.attr)) return true;
  // translate-only attributes: writable in the other locales, never in the source locale
  if ((cfg.translateOnly || []).includes(p.attr) && p.locale && p.locale !== cfg.sourceLocale) return true;
  // deterministic fix: localizable select copied to the other locales (same option code)
  if (p.attr === "ATT_SEASONALITY" && p.locale && p.locale !== cfg.sourceLocale) return true;
  return false;
}

// AI fields per locale
export function fieldsFor(locale, cfg) {
  return locale === cfg.sourceLocale ? cfg.aiFields : [...cfg.aiFields, ...(cfg.translateOnly || [])];
}

// ---------------------------------------------------------------------------- dictionary
let expanded = null;
export function expandBundled() {
  if (expanded) return expanded;
  const d = BUNDLED;
  const families = {};
  for (const [code, [label, label_es, extra, missingBase]] of Object.entries(d.fam)) {
    const miss = new Set((missingBase || "").split(",").filter(Boolean));
    families[code] = { label, label_es, required: { ecommerce: [...d.base.filter((a) => !miss.has(a)), ...extra.split(",").filter(Boolean)] } };
  }
  const options = {};
  for (const [attr, m] of Object.entries(d.opt)) {
    options[attr] = Object.fromEntries(Object.entries(m).map(([c, l]) => [c, Array.isArray(l) ? { pt_PT: l[0], es_ES: l[1] || l[0] } : { pt_PT: l, es_ES: l }]));
  }
  options.att_colors = options.ATT_COLOR;
  const attributes = Object.fromEntries(Object.entries(d.attrs).map(([c, l]) => [c, { pt_PT: l }]));
  expanded = { families, options, attributes, source: d.source, importedAt: d.importedAt, bundled: true };
  return expanded;
}

export async function getDictionary() {
  const stored = await db.get(PK.dictionary());
  const base = expandBundled();
  if (!stored) return base;
  return {
    families: { ...base.families, ...(stored.families || {}) },
    options: { ...base.options, ...(stored.options || {}) },
    attributes: { ...base.attributes, ...(stored.attributes || {}) },
    source: stored.source || base.source, importedAt: stored.importedAt || base.importedAt,
  };
}

// ---------------------------------------------------------------------------- helpers
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
const fmt = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
const UNIT = { CENTIMETER: "cm", MILLIMETER: "mm", METER: "m", KILOGRAM: "kg", GRAM: "g", LITER: "L", CENTILITER: "cl", MILLILITER: "ml", WATT: "W", VOLT: "V", CUBIC_METER: "m³" };

export function humanCode(v, attr, dict, locale = "pt_PT") {
  if (v == null || v === "") return "";
  const codes = String(v).split(",").map((x) => x.trim()).filter(Boolean);
  const one = (c) => {
    const opt = dict?.options?.[attr]?.[c];
    let label = opt ? (opt[locale] || opt.pt_PT || c) : c.replace(/^(MAT|OPT|TBL)_/, "").replace(/_/g, " ").toLowerCase();
    if (label === label.toUpperCase() && /[A-ZÀ-Ý]/.test(label) && attr !== "ATT_BRAND") label = label.toLowerCase(); // "PRATEADO" -> "prateado"
    return label;
  };
  return [...new Set(codes.map(one).filter(Boolean))].join(", ");
}

// Table attribute ATT_COMPOSITION: [{"TBL_ATT_MATERIAL":"MAT_POLYESTER","PERCENT":..}]
function compositionText(v, dict, locale) {
  try {
    const rows = JSON.parse(v);
    return rows.map((r) => { const m = humanCode(r.TBL_ATT_MATERIAL, "ATT_MATERIAL", dict, locale); const pct = Object.entries(r).find(([k]) => /PERCENT|PERC/i.test(k))?.[1]; return pct ? `${pct}% ${m}` : m; }).join(", ");
  } catch { return ""; }
}

function measure(row, attr) {
  const v = num(row[attr]);
  if (!v) return null;
  const u = UNIT[row[`${attr}-unit`]] || "";
  return { v, u, text: `${fmt(v)}${u ? " " + u : ""}` };
}

export function dimensionsText(row) {
  const L = measure(row, "ATT_ARTICLE_DIMENSION_LENGHT"), W = measure(row, "ATT_ARTICLE_DIMENSION_WIDE"), H = measure(row, "ATT_ARTICLE_DIMENSION_HEIGHT"), D = measure(row, "ATT_DIAMETER");
  const vals = [L, W, H].filter(Boolean);
  const u = vals[0]?.u || "cm";
  let s = vals.length ? vals.map((m) => fmt(m.v)).join(" x ") + ` ${u}` : "";
  if (D) s = s ? `${s}, Ø ${D.text}` : `Ø ${D.text}`;
  return s;
}

export function isSeasonal(row, cfg) {
  const s = row["ATT_SEASONALITY-pt_PT"] ?? row.ATT_SEASONALITY ?? "";
  if (cfg.seasonalValues.includes(String(s))) return true;
  return new RegExp(cfg.seasonalCategoryPattern, "i").test(row.categories || "");
}

const BOILERPLATE = [
  /Sabia que[^.!?]*[.!?]/gi,
  /Conheça a nossa gama[^.!?]*[.!?]/gi,
  /hô!\s*hô!\s*hôma![^|]*/gi,
  /Cozinhar com os utensílios certos[^.!?]*[.!?]/gi,
  /Limitado ao stock existente\.?/gi,
];
export function stripBoilerplate(text) {
  let t = String(text ?? "");
  for (const re of BOILERPLATE) t = t.replace(re, " ");
  return t.replace(/\s*\|\s*\|/g, " |").replace(/\s{2,}/g, " ").replace(/^\s*\|\s*/, "").trim();
}
export function campaignText(text) {
  const m = String(text ?? "").match(/hô!\s*hô!\s*hôma![^|]*/i);
  return m ? m[0].trim() : "";
}

// Product context in plain language for the AI and the UI
export function productFacts(row, dict, cfg) {
  const L = cfg.sourceLocale;
  const facts = {
    sku: row.sku,
    familia: dict?.families?.[row.family]?.label || row.family,
    categorias: (row.categories || "").split(",").filter((c) => c.startsWith("ecom_")).map((c) => c.replace(/^ecom_/, "").replace(/_/g, " ")).join(", "),
    nome_atual: row[`ATT_NAME-${L}-${cfg.channel}`],
    nome_plp_atual: row[`ATT_PLP_NAME-${L}`] ?? row[`ATT_PLP_NAME-${L}-${cfg.channel}`],
    descricao_atual: row[`ATT_LONG_DESCRIPTION-${L}-${cfg.channel}`],
    descricao_fornecedor: row.ATT_SUPPLIERS_ARTICLE_DESCRIPTION,
    marca: row.ATT_BRAND && row.ATT_BRAND !== "N_A" ? humanCode(row.ATT_BRAND, "ATT_BRAND", dict, L) : "",
    cor: humanCode(row.ATT_COLOR, "ATT_COLOR", dict, L),
    cores: humanCode(row.att_colors, "ATT_COLOR", dict, L),
    composicao: row.ATT_COMPOSITION ? compositionText(row.ATT_COMPOSITION, dict, L) : "",
    divisao: humanCode(row.ATT_SECTIONS, "ATT_SECTIONS", dict, L),
    aroma: humanCode(row.ATT_SCENTFLAVOUR, "ATT_SCENTFLAVOUR", dict, L),
    colecao: /^(N\/?A|-)?$/i.test(row.ATT_SUPPLIER_COLLECTION || "") ? "" : row.ATT_SUPPLIER_COLLECTION,
    descricao_curta_pt: row[`ATT_SHORT_DESCRIPTION-${L}-${cfg.channel}`],
    descricao_plp_pt: row[`ATT_PLP_DESCRIPTION-${L}`],
    rotulos_es: { cor: humanCode(row.ATT_COLOR, "ATT_COLOR", dict, "es_ES"), material: humanCode(row.ATT_MATERIAL, "ATT_MATERIAL", dict, "es_ES") },
    material: humanCode(row.ATT_MATERIAL, "ATT_MATERIAL", dict, L),
    estilo: humanCode(row.ATT_STYLE, "ATT_STYLE", dict, L),
    dimensoes: dimensionsText(row),
    peso: measure(row, "ATT_ARTICLE_WEIGHT")?.text || "",
    capacidade: measure(row, "ATT_CAPACITY")?.text || "",
    pecas: num(row.ATT_PIECES) > 1 ? String(num(row.ATT_PIECES)) : "",
    potencia: measure(row, "ATT_POWER_WATTS")?.text || "",
    led: row.ATT_LED === "1" ? "sim" : "",
    exterior: row.ATT_OUTDOOR === "1" ? "sim" : "",
    sazonal: isSeasonal(row, cfg),
    dimensoes_suspeitas: suspiciousDims(row),
  };
  // numeric option codes without dictionary are meaningless to the AI
  for (const k of ["cor", "cores", "material", "estilo", "aroma"]) if (/^\d+$/.test(facts[k] || "")) facts[k] = "";
  if (facts.cores === facts.cor) facts.cores = "";
  if (!facts.rotulos_es.cor && !facts.rotulos_es.material) delete facts.rotulos_es;
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== "" && v != null && v !== false));
}

export function suspiciousDims(row) {
  const L = num(row.ATT_ARTICLE_DIMENSION_LENGHT), W = num(row.ATT_ARTICLE_DIMENSION_WIDE), H = num(row.ATT_ARTICLE_DIMENSION_HEIGHT);
  const flat = /TEXTILE|MATTRESSES|RUG|CARPET|FRAMES/.test(row.family || "");
  if (flat && W && H && (W === H || L === H) && H > 15) return true;          // e.g. tablecloth 240x140x140, cushion 59x59x59
  const name = String(row["ATT_NAME-pt_PT-ecommerce"] || "");
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/i);
  if (m && L && W) { const a = [Number(m[1].replace(",", ".")), Number(m[2].replace(",", "."))].sort((x, y) => x - y); const b = [L, W].sort((x, y) => x - y); if (a[0] !== b[0] || a[1] !== b[1]) return true; } // name says 60x90, attributes 90x90
  return false;
}

// ---------------------------------------------------------------------------- diagnosis
const isShouting = (s) => { const l = String(s).replace(/[^\p{L}]/gu, ""); return l.length >= 8 && l.replace(/[^\p{Lu}]/gu, "").length / l.length > 0.6; };
const titleCased = (s) => { const w = String(s).split(/\s+/).filter((x) => x.length > 3); return w.length >= 3 && w.filter((x) => /^\p{Lu}\p{Ll}/u.test(x)).length / w.length > 0.75; };

export function diagnose(row, headers, cfg, dict) {
  const flags = [];
  const add = (field, code, msg, severity = "warn") => flags.push({ field, code, msg, severity });
  const L = cfg.sourceLocale, C = cfg.channel;
  const name = String(row[`ATT_NAME-${L}-${C}`] ?? "").trim();
  const plp = String(row[columnFor(headers, "ATT_PLP_NAME", L, C)] ?? "").trim();
  const long = String(row[`ATT_LONG_DESCRIPTION-${L}-${C}`] ?? "").trim();

  if (!name) add("ATT_NAME", "empty", "Nome vazio", "error");
  else {
    if (name.length < 20) add("ATT_NAME", "short", `Nome curto (${name.length})`);
    if (name.length > cfg.limits.ATT_NAME) add("ATT_NAME", "long", `Nome longo (${name.length} > ${cfg.limits.ATT_NAME})`);
    if (isShouting(name)) add("ATT_NAME", "caps", "Nome em maiúsculas");
    if (/\b[a-z]+ [A-Z]{3,}\b/.test(name) && /\b[a-z]{3,} [A-Z]/.test(name)) add("ATT_NAME", "mixed_case", "Maiúsculas inconsistentes");
  }
  if (!plp) add("ATT_PLP_NAME", "empty", "Nome PLP vazio", "error");
  else if (isShouting(plp)) add("ATT_PLP_NAME", "caps", "Nome PLP em maiúsculas");

  if (!long) add("ATT_LONG_DESCRIPTION", "empty", "Descrição longa vazia", "error");
  else {
    if (long.length < cfg.limits.longMin) add("ATT_LONG_DESCRIPTION", "short", `Descrição curta para SEO (${long.length} < ${cfg.limits.longMin})`);
    if (BOILERPLATE.some((re) => { re.lastIndex = 0; return re.test(long); })) add("ATT_LONG_DESCRIPTION", "boilerplate", isSeasonal(row, cfg) ? "Texto genérico/campanha (produto sazonal: campanha mantém-se)" : "Texto genérico/campanha em produto não sazonal");
    if (titleCased(long.split(/[.|]/)[0])) add("ATT_LONG_DESCRIPTION", "title_case", "Primeira frase Em Maiúsculas Por Palavra");
    if (/<[a-z][^>]*>/i.test(long)) add("ATT_LONG_DESCRIPTION", "html", "HTML na descrição");
  }

  for (const loc of cfg.targetLocales.filter((l) => l !== L)) {
    for (const attr of fieldsFor(loc, cfg)) {
      const col = columnFor(headers, attr, loc, C);
      if (!String(row[col] ?? "").trim()) add(attr, `missing_${loc}`, `${attr} sem ${loc}`, "info");
    }
  }

  const completeness = Number(row[`completeness_ratio-${L}-${C}`]);
  if (Number.isFinite(completeness) && completeness < 100) add("_completeness", "incomplete", `Completude ${completeness}%`, "info");

  const req = dict?.families?.[row.family]?.required?.[C];
  if (req?.length) {
    const missing = req.filter((attr) => {
      const cols = headers.filter((h) => { const p = parseColumn(h); return p.attr === attr && !p.unit && (!p.locale || p.locale === L) && (!p.channel || p.channel === C); });
      if (!cols.length) return false; // column not in this export: cannot judge
      return cols.every((c) => row[c] == null || String(row[c]).trim() === "");
    });
    const label = (a) => dict?.attributes?.[a]?.pt_PT || a;
    const content = missing.filter((a) => ["ATT_NAME", "ATT_PLP_NAME", "ATT_LONG_DESCRIPTION", "ATT_SHORT_DESCRIPTION", "ATT_PLP_DESCRIPTION"].includes(a));
    const other = missing.filter((a) => !content.includes(a));
    if (content.length) add("_required", "missing_content", `Obrigatórios de conteúdo em falta (PT): ${content.map(label).join(", ")}`, "error");
    if (other.length) add("_required", "missing_data", `Obrigatórios de dados em falta (compras/logística): ${other.map(label).join(", ")}`, "info");
  }

  // PLP description dimensions vs dimension attributes
  const plpDesc = String(row[`ATT_PLP_DESCRIPTION-${L}`] ?? "");
  const dimVals = ["ATT_ARTICLE_DIMENSION_LENGHT", "ATT_ARTICLE_DIMENSION_WIDE", "ATT_ARTICLE_DIMENSION_HEIGHT", "ATT_DIAMETER"].map((a) => num(row[a])).filter(Boolean).map((n) => Math.round(n * 10) / 10);
  const plpNums = (plpDesc.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Math.round(Number(x.replace(",", ".")) * 10) / 10);
  if (plpNums.length >= 2 && dimVals.length && plpNums.some((n) => !dimVals.includes(n))) add("ATT_PLP_DESCRIPTION", "dims_mismatch", `Descrição PLP (${plpDesc}) não bate com as dimensões do artigo (${dimensionsText(row)})`);
  const W = num(row.ATT_ARTICLE_DIMENSION_WIDE), H = num(row.ATT_ARTICLE_DIMENSION_HEIGHT);
  if (/TEXTILE|RUG|CARPET/.test(row.family || "") && W && H && W === H && W > 30) add("_dimensions", "suspicious", `Dimensões suspeitas: altura = largura (${W}) num têxtil`, "info");
  return flags;
}

// ---------------------------------------------------------------------------- AI
const LANG = { pt_PT: "Português europeu (Portugal) — nunca português do Brasil", es_ES: "Espanhol de Espanha (castelhano)" };

export async function optimizeProducts(items, cfg) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error("ANTHROPIC_API_KEY não configurada"), { fatal: true });
  const fieldSpec = cfg.aiFields.map((f) => `- ${f}: ${cfg.instructions[f] || ""}`).join("\n");
  const locales = cfg.targetLocales;
  const system = `És editor de conteúdos de produto e especialista em SEO e GEO para e-commerce de casa e decoração.
${cfg.brandVoice}

Regras:
- Usa APENAS os factos fornecidos (nome, descrição atual, descrição do fornecedor, atributos). Nunca inventes medidas, materiais, cores, certificações ou utilizações improváveis.
- ATT_NAME até ${cfg.limits.ATT_NAME} caracteres; ATT_PLP_NAME até ${cfg.limits.ATT_PLP_NAME}; ATT_SHORT_DESCRIPTION até ${cfg.limits.ATT_SHORT_DESCRIPTION}; ATT_LONG_DESCRIPTION entre ${cfg.limits.longMin} e ${cfg.limits.longMax} caracteres.
- Em ES usa os "rotulos_es" para cor e material quando existirem.
- O NOME ATUAL É A FONTE DE VERDADE para medidas, material e cor. Nunca alteres medidas, material ou cor que já estejam no nome atual, mesmo que os atributos digam outra coisa (os atributos às vezes estão errados). Podes acrescentar informação que falte, nunca substituir.
- Se "dimensoes_suspeitas" for true, usa as medidas do nome atual na linha de especificações; se o nome não tiver medidas, omite "Dimensão".
- Não inventes qualidades ou características (natural, artesanal, macio, resistente às intempéries, etc.) que não estejam nos dados.
- Português europeu sem anglicismos (nada de "storage", "design" quando há equivalente simples, etc.).
- ES: tradução completa, nenhuma palavra em português. Glossário obrigatório: tapete→alfombra; almofada decorativa→cojín; almofada de cama/travesseiro→almohada; candeeiro→lámpara; vaso para plantas→maceta; vaso/jarra decorativa→jarrón; toalha de mesa→mantel; toalha de banho→toalla; roupeiro→armario; coroa→corona; cesto→cesta; caixa→caja; prateado→plateado; dourado→dorado; saboneteira→jabonera; coador→colador; tapete de banho→alfombra de baño.
- Remove textos genéricos de marketing ("Sabia que…", "Conheça a nossa gama…"). Só inclui texto de campanha no produto que tiver o campo "texto_campanha" (coloca-o antes da linha de especificações, traduzido no ES); nos outros produtos nunca incluas texto de campanha, mesmo que outro produto do lote o tenha.
- Sem HTML, emojis, preços, promoções ou MAIÚSCULAS integrais. Referências de coleção/marca mantêm-se como no original.
- Gera para cada língua pedida: ${locales.map((l) => `${l} = ${LANG[l] || l}`).join("; ")}. O ES é uma adaptação natural, não tradução literal.

Campos:
${fieldSpec}

Campos só para ${locales.filter((l) => l !== cfg.sourceLocale).join(", ")} (o PT mantém-se): ${(cfg.translateOnly || []).map((f) => `${f}: ${cfg.instructions[f] || "tradução fiel"}`).join(" ; ")}

Responde APENAS com JSON: {"<sku>": {${locales.map((l) => `"${l}": {${fieldsFor(l, cfg).map((f) => `"${f}": "..."`).join(", ")}}`).join(", ")}}}`;

  const user = "Produtos:\n" + JSON.stringify(items.map((it) => ({ ...it.facts, texto_campanha: it.campaign || undefined, problemas: it.flags })), null, 1);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({ model: process.env.AI_MODEL || cfg.model, max_tokens: 1800 * items.length, temperature: 0.4, system, messages: [{ role: "user", content: user }] }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1) ** 2)); continue; }
    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`), { fatal: [401, 403, 404].includes(res.status) || /workspace|api key|model|credit|billing/i.test(body) });
    }
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return json;
  }
  throw new Error("Anthropic indisponível (várias tentativas)");
}

export function cleanAi(attr, value, cfg) {
  let v = String(value ?? "").replace(/<[^>]+>/g, "").replace(/[\u{1F300}-\u{1FAFF}]/gu, "").replace(/\s{2,}/g, " ").trim();
  const max = attr === "ATT_LONG_DESCRIPTION" ? cfg.limits.longMax + 300 : cfg.limits[attr];
  if (attr === "ATT_SHORT_DESCRIPTION" && v.length > (cfg.limits.ATT_SHORT_DESCRIPTION || 40)) return v.slice(0, cfg.limits.ATT_SHORT_DESCRIPTION || 40).trim(); // hard ERP limit
  if (max && v.length > max) v = v.slice(0, max).replace(/\s+\S*$/, "");
  return v;
}

// ---------------------------------------------------------------------------- job index
export function buildIndex(rows, headers, cfg, dict, results = {}) {
  return rows.map((r) => {
    const flags = diagnose(r, headers, cfg, dict);
    const res = results[r.sku]?.fields || {};
    const vals = Object.values(res);
    const content = vals.filter((v) => v.source !== "fix");
    return {
      sku: r.sku,
      name: r[`ATT_NAME-${cfg.sourceLocale}-${cfg.channel}`] || r[`ATT_LABEL-${cfg.sourceLocale}`] || "",
      family: r.family || "",
      completeness: Number(r[`completeness_ratio-${cfg.sourceLocale}-${cfg.channel}`]) || null,
      seasonal: isSeasonal(r, cfg),
      flags: flags.map((f) => `${f.field}:${f.code}`),
      errors: flags.filter((f) => f.severity === "error").length,
      suggested: content.length,
      warnings: vals.filter((v) => v.warning && v.status !== "accepted").length,
      accepted: vals.filter((v) => v.status === "accepted").length,
      pending: vals.filter((v) => v.status === "pending").length,
    };
  });
}

export async function refreshMeta(id, meta) {
  const [cfg, dict, data, results] = await Promise.all([getPimConfig(), getDictionary(), db.get(PK.rows(id)), db.get(PK.results(id))]);
  meta.index = buildIndex(data.rows, data.headers, cfg, dict || {}, results || {});
  const fc = {};
  for (const i of meta.index) for (const f of i.flags) fc[f] = (fc[f] || 0) + 1;
  meta.flagCount = fc;
  meta.count = data.rows.length;
  meta.updatedAt = new Date().toISOString();
  await db.set(PK.job(id), meta);
  return meta;
}


// ---------------------------------------------------------------------------- deterministic fixes (no AI)
export function deterministicFixes(row, headers, cfg, dict) {
  const out = {};
  const L = cfg.sourceLocale;
  const req = dict?.families?.[row.family]?.required?.[cfg.channel] || [];
  // ATT_SEASONALITY is localizable: copy the option code to other locales when required by the family
  if (req.includes("ATT_SEASONALITY") && row[`ATT_SEASONALITY-${L}`]) {
    for (const loc of cfg.targetLocales.filter((l) => l !== L)) {
      const col = columnFor(headers, "ATT_SEASONALITY", loc, null);
      if (!row[col]) out[col] = row[`ATT_SEASONALITY-${L}`];
    }
  }
  return out;
}
