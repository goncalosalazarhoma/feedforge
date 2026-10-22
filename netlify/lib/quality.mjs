// Detects sub-optimised fields. Flags drive which NEW products go to the AI.

const PROMO = /(gr[aá]tis|portes|envio gratuito|free shipping|promo[cç][aã]o|promoci[oó]n|desconto|descuento|oferta|sale\b|\d+\s?%|compre j[aá]|compra ya|best seller|novidade!|!!)/i;
const HTML = /<\/?[a-z][^>]*>|&nbsp;|&amp;/i;

function isShouting(s) {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 8) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
  return upper / letters.length > 0.7;
}

/**
 * @param row    product row (after AI + rules + overrides)
 * @param q      config.quality
 * @param dupTitles Set of lower-cased titles appearing more than once
 * @returns {{ field: string, code: string, msg: string }[]}
 */
export function checkQuality(row, q, dupTitles = new Set()) {
  const flags = [];
  const add = (field, code, msg) => flags.push({ field, code, msg });
  const title = String(row.title ?? "").trim();
  const desc = String(row.description ?? "").trim();

  if (!title) add("title", "empty", "Título vazio");
  else {
    if (title.length < q.titleMin) add("title", "short", `Título curto (${title.length} < ${q.titleMin})`);
    if (title.length > q.titleMax) add("title", "long", `Título longo (${title.length} > ${q.titleMax})`);
    if (isShouting(title)) add("title", "caps", "Título em MAIÚSCULAS");
    if (PROMO.test(title)) add("title", "promo", "Texto promocional no título");
    if (dupTitles.has(title.toLowerCase()) && !row.item_group_id) add("title", "duplicate", "Título duplicado noutro produto");
  }

  if (!desc) add("description", "empty", "Descrição vazia");
  else {
    if (desc.length < q.descMin) add("description", "short", `Descrição curta (${desc.length} < ${q.descMin})`);
    if (desc.toLowerCase() === title.toLowerCase()) add("description", "same_as_title", "Descrição igual ao título");
    if (HTML.test(desc)) add("description", "html", "HTML na descrição");
    if (isShouting(desc)) add("description", "caps", "Descrição em MAIÚSCULAS");
    if (desc.length > 5000) add("description", "long", "Descrição > 5000 caracteres (limite GMC)");
  }

  for (const f of q.requireFields || []) {
    if (f in row && !String(row[f] ?? "").trim()) add(f, "empty", `${f} vazio`);
  }
  if ("gtin" in row && row.gtin && !/^\d{8}$|^\d{12,14}$/.test(String(row.gtin).trim())) add("gtin", "invalid", "GTIN/EAN com formato inválido");
  if ("image_link" in row && !String(row.image_link ?? "").startsWith("http")) add("image_link", "invalid", "image_link inválido");
  return flags;
}

export function duplicateTitles(rows) {
  const seen = new Map();
  for (const r of rows) {
    const t = String(r.title ?? "").trim().toLowerCase();
    if (t) seen.set(t, (seen.get(t) || 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([t]) => t));
}
