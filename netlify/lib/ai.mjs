// AI optimisation with Claude (Anthropic Messages API, no SDK needed).
import { hashFields } from "./util.mjs";

const CONTEXT_FIELDS = [
  "id", "title", "description", "brand", "product_type", "google_product_category", "color", "size",
  "material", "pattern", "gender", "age_group", "item_group_id", "shipping_weight",
];

const LANG = { "pt-PT": "Português europeu (Portugal) — nunca português do Brasil", "es-ES": "Espanhol de Espanha" };

// What the AI sees for a product. If these inputs don't change, the cached result stays valid.
export function aiInputHash(row, cfg) {
  return hashFields(row, [...new Set([...CONTEXT_FIELDS, ...cfg.ai.fields])]) + ":" + cfg.ai.fields.join(",");
}

function buildPrompt(products, cfg) {
  const { ai, quality, language } = cfg;
  const fieldSpec = ai.fields.map((f) => `- "${f}": ${ai.fieldInstructions?.[f] || "Melhora este campo mantendo-o factual."}`).join("\n");
  const items = products.map(({ row, flags }) => {
    const ctx = {};
    for (const f of new Set([...CONTEXT_FIELDS, ...ai.fields])) if (row[f]) ctx[f] = String(row[f]).slice(0, 2500);
    return { ...ctx, _problemas_detetados: flags.map((x) => x.msg) };
  });

  const system = `És um especialista em product feeds para Meta Catalog e Google Merchant Center.
${ai.brandVoice}
Língua obrigatória: ${LANG[language] || language}.

Regras de ouro:
- Usa APENAS factos presentes nos dados do produto. Nunca inventes medidas, materiais, cores ou características.
- Títulos entre ${quality.titleMin} e ${Math.min(quality.titleMax, 150)} caracteres; a informação mais importante nos primeiros 70.
- Proibido: texto promocional, preços, "portes grátis", MAIÚSCULAS integrais, emojis, HTML, pontos de exclamação.
- Mantém a marca, referências de coleção (ex.: nomes em maiúsculas como TIMELESS) e dimensões tal como estão.
- Se um campo já está bom, devolve-o igual.

Campos a otimizar:
${fieldSpec}

Responde APENAS com JSON válido no formato {"<id>": {${ai.fields.map((f) => `"${f}": "..."`).join(", ")}}} — sem markdown, sem comentários.`;

  const user = `Produtos:\n${JSON.stringify(items, null, 1)}`;
  return { system, user };
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Resposta AI sem JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function sanitize(field, value, cfg) {
  let v = String(value ?? "").replace(/<[^>]+>/g, "").replace(/[\u{1F300}-\u{1FAFF}]/gu, "").replace(/\s{2,}/g, " ").trim();
  if (field === "title" && v.length > Math.min(cfg.quality.titleMax, 150)) v = v.slice(0, Math.min(cfg.quality.titleMax, 150)).replace(/\s+\S*$/, "");
  if (field === "description" && v.length > 5000) v = v.slice(0, 5000);
  return v;
}

/**
 * Optimise a batch of products (≤ 5 recommended).
 * @param products [{ row, flags }]
 * @returns { [id]: { field: value } }
 */
export async function optimizeBatch(products, cfg, { idField = "id" } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY não configurada");
  const { system, user } = buildPrompt(products.map((p) => ({ ...p, row: { ...p.row, id: p.row[idField] } })), cfg);

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || cfg.ai.model || "claude-haiku-4-5",
        max_tokens: 1200 * products.length,
        temperature: 0.3,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Anthropic ${res.status}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2));
      continue;
    }
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = extractJson(text);
    const out = {};
    for (const p of products) {
      const id = String(p.row[idField]);
      const r = parsed[id];
      if (!r) continue;
      out[id] = {};
      for (const f of cfg.ai.fields) {
        if (r[f] != null && String(r[f]).trim() !== "") out[id][f] = sanitize(f, r[f], cfg);
      }
    }
    return out;
  }
  throw lastErr;
}
