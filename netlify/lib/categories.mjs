// Re-categorisation for the PIM optimizer.
// Taxonomy = Akeneo category tree (if imported into the dictionary) merged with what is learned from the uploaded files.

const isEcom = (c) => c.startsWith("ecom_");
export const splitCats = (v) => String(v || "").split(",").map((c) => c.trim()).filter(Boolean);
export const humanCat = (code, tax) => tax?.[code]?.label || code.replace(/^ecom_/, "").replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());

// Price bands encoded as categories: ecom_up_to_10, ecom_from_15_to_25, ecom_more_than_100 / ecom_over_100
export function bandOf(code) {
  let m;
  if ((m = code.match(/^ecom_up_to_(\d+)$/))) return [0, Number(m[1])];
  if ((m = code.match(/^ecom_from_(\d+)_to_(\d+)$/))) return [Number(m[1]), Number(m[2])];
  if ((m = code.match(/^ecom_(?:more_than|over|from)_(\d+)$/))) return [Number(m[1]), Infinity];
  return null;
}
const themeLike = (c) => !!bandOf(c) || /^ecom_(T\d+|for_|home_lovers|Gifts$|Themes$)/.test(c);

// Learn taxonomy (parents + family distribution) from rows. Parent of B = a code present in every product that has B, used more often.
export function learnTaxonomy(rows, base = {}) {
  const count = {}, co = {}, famCount = {}, famCat = {};
  for (const r of rows) {
    const cats = splitCats(r.categories).filter(isEcom);
    famCount[r.family] = (famCount[r.family] || 0) + 1;
    for (const c of cats) {
      count[c] = (count[c] || 0) + 1;
      (famCat[r.family] ||= {})[c] = (famCat[r.family][c] || 0) + 1;
      for (const o of cats) if (o !== c) { (co[c] ||= {})[o] = (co[c][o] || 0) + 1; }
    }
  }
  const tax = { ...base };
  const known = Object.keys(count);
  for (const c of known) {
    if (tax[c]?.parent !== undefined) continue;
    let parent = null;
    if (!themeLike(c)) {
      // 1) prefix: ecom_textile_rug -> ecom_textile (longest known prefix)
      const pref = known.filter((o) => o !== c && c.startsWith(o + "_") && !themeLike(o)).sort((a, b) => b.length - a.length)[0];
      if (pref) parent = pref;
      // 2) co-occurrence (only with enough evidence): a code present in every product that has c
      else if (count[c] >= 2) {
        const cands = Object.entries(co[c] || {}).filter(([o, n]) => n === count[c] && count[o] > count[c] && !themeLike(o) && !o.startsWith(c + "_")).sort((a, b) => count[a[0]] - count[b[0]]);
        parent = cands[0]?.[0] || null;
      }
    }
    tax[c] = { ...(tax[c] || {}), parent, learned: true, n: count[c] };
  }
  return { tax, count, famCat, famCount };
}

export function ancestors(code, tax) {
  const out = [];
  let p = tax[code]?.parent, guard = 0;
  while (p && guard++ < 8) { out.push(p); p = tax[p]?.parent; }
  return out;
}
const rootOf = (code, tax) => { const a = ancestors(code, tax); return a.length ? a[a.length - 1] : code; };

const XMAS = /\b(natal|natalíci[oa]s?|natalici[oa]s?|navidad|pai natal|rena|presépio|bola[s]? de natal|árvore de natal)\b/i;

/** Deterministic category checks + safe proposals. Returns { flags:[{code,msg}], add:[], remove:[], reasons:[] } */
export function checkCategories(row, ctx, cfg) {
  const { tax, famCat, famCount } = ctx;
  const cats = splitCats(row.categories);
  const ecom = cats.filter(isEcom);
  const name = String(row[`ATT_NAME-${cfg.sourceLocale}-${cfg.channel}`] || "");
  const flags = [], add = new Set(), remove = new Set(), reasons = [];

  if (!ecom.length) flags.push({ code: "no_ecom", msg: "Sem categoria ecommerce (não aparece na navegação do site)", severity: "error" });

  // missing parents
  for (const c of ecom) for (const p of ancestors(c, tax)) if (!cats.includes(p)) { add.add(p); reasons.push(`Falta a categoria-mãe "${humanCat(p, tax)}" de "${humanCat(c, tax)}"`); }

  // only a top-level category with known children
  const children = (c) => Object.entries(tax).filter(([, v]) => v.parent === c).map(([k]) => k);
  const leafless = ecom.filter((c) => !themeLike(c) && children(c).length && !ecom.some((o) => ancestors(o, tax).includes(c)));
  if (leafless.length) flags.push({ code: "no_leaf", msg: `Só no nível superior: ${leafless.map((c) => humanCat(c, tax)).join(", ")}`, severity: "warn" });

  // category unlikely for the family (root never/rarely used by other products of the same family)
  const fc = famCat[row.family] || {}, fn = famCount[row.family] || 0;
  if (fn >= 5) {
    for (const c of ecom.filter((x) => !themeLike(x) && !/Christmas|Gift|Other_Decorations|decor$/i.test(x))) {
      const share = (fc[c] || 0) / fn;
      const rootShare = (fc[rootOf(c, tax)] || 0) / fn;
      if (share <= 1 / fn && rootShare < 0.15) { flags.push({ code: "unlikely", msg: `"${humanCat(c, tax)}" é improvável para a família ${row.family}`, severity: "warn" }); }
    }
  }

  // Christmas keywords but not in Christmas
  if (XMAS.test(name) && !cats.includes("ecom_Christmas") && tax.ecom_Christmas) { add.add("ecom_Christmas"); reasons.push("Nome de Natal sem a categoria Natal"); flags.push({ code: "xmas_missing", msg: "Produto de Natal fora da categoria Natal", severity: "warn" }); }

  // price band vs PVP
  const pvp = Number(String(row["ATT_PVP-EUR"] || row.ATT_PVP || "").replace(",", "."));
  const bands = Object.keys(tax).filter((c) => bandOf(c));
  const mine = ecom.filter((c) => bandOf(c));
  if (pvp > 0 && mine.length) {
    for (const c of mine) {
      const [lo, hi] = bandOf(c);
      if (pvp < lo || pvp > hi) {
        remove.add(c);
        const right = bands.find((b) => { const [l, h] = bandOf(b); return pvp >= l && pvp <= h; });
        if (right) add.add(right);
        reasons.push(`Faixa de preço "${humanCat(c, tax)}" não bate com o PVP ${pvp.toFixed(2)} €${right ? ` → "${humanCat(right, tax)}"` : ""}`);
        flags.push({ code: "price_band", msg: `Faixa de preço errada para PVP ${pvp.toFixed(2)} €`, severity: "warn" });
      }
    }
  }
  return { flags, add: [...add], remove: [...remove], reasons };
}

export function applyCategoryChange(current, add, remove) {
  const cats = splitCats(current);
  const out = cats.filter((c) => !remove.includes(c) || !isEcom(c)); // never remove ERP (non-ecom) codes
  for (const c of add) if (isEcom(c) && !out.includes(c)) out.push(c);
  return out.join(",");
}

// Candidate list sent to the AI (all known ecommerce categories with labels and parents)
export function taxonomyForPrompt(tax) {
  return Object.entries(tax).filter(([c]) => isEcom(c)).map(([c, v]) => `${c} = ${humanCat(c, tax)}${v.parent ? ` (em ${v.parent})` : ""}`).join("\n");
}

// AI proposal: only codes from the taxonomy are accepted.
export async function proposeCategoriesAI(items, tax, cfg) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error("ANTHROPIC_API_KEY não configurada"), { fatal: true });
  const system = `És responsável pela navegação (categorias) de um e-commerce de casa e decoração (hôma, Portugal/Espanha).
Para cada produto, propõe as categorias ecommerce corretas usando APENAS códigos desta lista:
${taxonomyForPrompt(tax)}

Regras:
- Cada produto deve estar numa categoria final (a mais específica possível) e nas respetivas categorias-mãe.
- Remove categorias claramente erradas (ex.: um tapete em "cadeiras"). Não removas categorias de campanha/tema/presentes/faixas de preço (Christmas, Gifts, for_..., T1..T6, up_to_..., from_..._to_...) exceto se forem absurdas.
- Cada produto traz "alertas" (problemas detetados automaticamente). Para CADA alerta tens de: propor a correção concreta (adicionar/remover), OU explicar no motivo porque é que as categorias atuais estão certas apesar do alerta.
- "Só no nível superior: X": adiciona a subcategoria de X que encaixa no produto; se nenhuma encaixar e o produto já estiver bem classificado noutra árvore (ex.: candeeiro já em Iluminação > Candeeiros de mesa), remove X.
- "improvável para a família": remove se estiver errada; se fizer sentido (ex.: produto multiuso), explica porquê.
- Só devolve listas vazias se as categorias estiverem certas — e nesse caso o motivo explica a decisão para cada alerta.
- O "motivo" é SEMPRE preenchido: uma ou duas frases curtas em português.
Responde APENAS com JSON: {"<sku>": {"adicionar": ["ecom_..."], "remover": ["ecom_..."], "motivo": "..."}}`;
  const user = "Produtos:\n" + JSON.stringify(items, null, 1);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json", ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}) },
      body: JSON.stringify({ model: process.env.AI_MODEL || cfg.model, max_tokens: 300 * items.length + 200, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1) ** 2)); continue; }
    if (!res.ok) { const b = await res.text(); throw Object.assign(new Error(`Anthropic ${res.status}: ${b.slice(0, 300)}`), { fatal: [401, 403, 404].includes(res.status) || /workspace|api key|model|credit|billing/i.test(b) }); }
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    // validate
    const out = {};
    for (const [sku, v] of Object.entries(json)) {
      const add = (v.adicionar || []).filter((c) => tax[c]);
      const remove = (v.remover || []).filter((c) => tax[c]);
      out[sku] = { add, remove, reason: String(v.motivo || "").slice(0, 300) };
    }
    return out;
  }
  throw new Error("Anthropic indisponível");
}
