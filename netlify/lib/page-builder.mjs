// Page Builder: prompt → JSON of library blocks (Claude, tool use + schema validation) → deterministic HTML
// for a Raw HTML component in SFCC Page Designer. Elements, versions and generation logs live in Netlify Blobs.
// Page Builder activity is editorial, not a pipeline run — nothing here reports to Filo.
import { db, httpError } from "./store.mjs";
import { getCatalog, categoryTree, resolveSource } from "./products.mjs";
import {
  BLOCKS, PRODUCT_BLOCKS, elementSchema, singleBlockSchema, validateSchema, normalizeElement, normalizeBlock,
  renderElement, checkElement, productSnapshot, libraryForPrompt, slugify, diffElements,
} from "../../public/page-builder/engine.mjs";

export const PBK = {
  index: () => "pb/elements/index",
  element: (id) => `pb/elements/${id}`,
  versions: (id) => `pb/elements/${id}/versions`,
  job: (id) => `pb/jobs/${id}`,
  log: () => "pb/log",
  settings: () => "pb/settings",
};
const MAX_VERSIONS = 10;
const MAX_LOG = 300;
export const DEFAULT_MODEL = "claude-sonnet-4-5";      // layout generation (override: PAGE_BUILDER_MODEL)
export const DEFAULT_COPY_MODEL = "claude-haiku-4-5";  // copy-only refinements (override: PAGE_BUILDER_COPY_MODEL)
const PAGES = ["homepage", "plp", "pdp", "landing"];
const PAGE_LABEL = { homepage: "Homepage", plp: "PLP (página de categoria)", pdp: "PDP (página de produto)", landing: "Landing page" };

// ---------------------------------------------------------------------------- settings (Page Designer capability test result)
export async function getSettings() {
  const s = (await db.get(PBK.settings())) || {};
  return { caps: { js: !!s.caps?.js }, capabilityTest: s.capabilityTest || null };
}

// ---------------------------------------------------------------------------- products
// { [blockId]: cards } — manual lists keep missing/oos flags (validation), rules return in-stock matches
export async function hydrateElement(el) {
  const products = {}, counts = {};
  const blocks = (el.blocks || []).filter((b) => PRODUCT_BLOCKS.includes(b.type));
  if (!blocks.length) return { products, counts, generatedAt: null };
  const cat = await getCatalog(el.market);
  for (const b of blocks) {
    const src = b.props.productSource || {};
    const r = src.mode === "manual" ? resolveSource(cat.items, { mode: "manual", ids: src.ids || [] }, el.market) : resolveSource(cat.items, { ...src, limit: b.props.limit }, el.market);
    products[b.id] = r.items;
    counts[b.id] = r.total;
  }
  return { products, counts, generatedAt: cat.generatedAt };
}

// ---------------------------------------------------------------------------- Claude
async function callClaude({ model, system, messages, tool, maxTokens = 8000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, "ANTHROPIC_API_KEY não configurada");
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.4, system, messages, tools: [tool], tool_choice: { type: "tool", name: tool.name } }),
    });
    if (res.status === 429 || res.status >= 500) { lastErr = new Error(`Anthropic ${res.status}`); await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2)); continue; }
    if (!res.ok) throw httpError(502, `Anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const use = (data.content || []).find((c) => c.type === "tool_use");
    if (!use) throw httpError(502, "A IA não devolveu o JSON do elemento");
    return { input: use.input, toolUseId: use.id, usage: data.usage || {}, stop: data.stop_reason };
  }
  throw lastErr;
}

function treeForPrompt(tree, maxSub = 25) {
  return tree.children.slice(0, 40).map((c) => `- ${c.name} · ${c.count}${c.children.length ? `: ${c.children.slice(0, maxSub).map((s) => `${s.name} · ${s.count}`).join("; ")}` : ""}`).join("\n");
}

export function systemPrompt({ market, page, tree, copyOnly = false }) {
  const pt = market !== "es";
  return `És o motor do "Page Builder" da hôma (decoração e artigos para casa; lojas e site homastores.com em Portugal e Espanha; páginas montadas no SFCC Page Designer).
Recebes um pedido em linguagem natural e respondes SEMPRE com a ferramenta indicada, com um elemento feito SÓ de blocos da biblioteca abaixo. Nunca escreves HTML nem CSS (a única exceção é o campo html do text-block, só com <p>, <strong>, <em>, <a href>, <ul>, <ol>, <li>, <br>). O aspeto vem dos blocos (design system hôma do Figma) — não tentes mudar cores, letras ou tamanhos.

## Biblioteca de blocos (v1)
${libraryForPrompt()}
Props comuns a todos os blocos: background (white|beige|sand|brown|dark|image), backgroundImage, paddingTop/paddingBottom (0|12|16|24|32|36|40|48|80|118), fullBleed, hideOn (""|"mobile"|"desktop"), anchor. Em geral não os definas: cada bloco já tem valores por defeito alinhados com o Figma. Usa background para alternar secções (ex.: cta-section em beige) e só quando ajuda.

## Composição
- Segue a ordem e a estrutura que o pedido descreve: um bloco por cada parte pedida, sem acrescentar secções que ninguém pediu.
- "grelha de N imagens com link e CTA" → image-tiles com N items (columns = N, máx. 6), cada um com title, linkLabel e url.
- "título + texto" → text-block. Título de uma lista/grelha de produtos → section-heading imediatamente antes do product-grid/product-carousel, com o title do bloco de produtos vazio.
- Nunca uses h1 (a página já tem um): os blocos tratam dos níveis de título.
- Pedido fora da biblioteca (formulário, vídeo, contagem decrescente, mapa, mapa de lojas, código personalizado, animações…): usa os blocos mais próximos e explica em notes, numa frase cada, o que não foi possível e porquê.

## Texto (copy provisório, editável pela equipa)
- Língua: ${pt ? "português de Portugal (PT-PT, nunca PT-BR)" : "espanhol de Espanha (es-ES)"}.
- Tom hôma: caloroso, simples, próximo, focado na casa e no dia a dia. ${pt ? 'Trata o cliente por "você", como no homastores.com ("o seu Natal", "Descubra", "Conheça", "Explore").' : 'Trata o cliente por "tú", como em homastores.com/es ("tu primera compra", "Descubre").'}
- CTAs curtos, como no site: ${pt ? '"Ver produtos", "Comprar agora", "Ver coleção", "Descobrir", "Saber mais"' : '"Ver productos", "Comprar ahora", "Ver colección", "Descubrir", "Saber más"'}.
- NUNCA inventes preços, descontos, percentagens, prazos, datas, portes grátis, garantias, quantidades nem afirmações (ex.: "100% sustentável", "feito à mão", "o mais barato") que o pedido não dê. Na dúvida, escreve texto genérico e verdadeiro.
- Títulos curtos (idealmente até 6 palavras); textos de apoio com 1–2 frases.

## Imagens
- src: só se o pedido der um URL https; caso contrário "" (a equipa escolhe a imagem).
- alt: descreve a imagem pretendida, em ${pt ? "português" : "espanhol"}.
- description: briefing da fotografia para a equipa (ambiente, produtos, enquadramento, orientação).

## Links
- url: só caminhos ou URLs que o pedido dê (ex.: "/natal"); caso contrário "" — a equipa preenche. Nunca inventes URLs.

## Produtos (productSource)
- Prefere {"mode":"rule"} descrito pelo pedido. category e subcategory têm de ser EXATAMENTE nomes da lista abaixo, ou ficar "". "em promoção"/"saldos" → onSale:true; "até 20 €" → priceMax:20; "novidades" → sort:"newest"; "mais baratos" → sort:"price_asc".
- limit do bloco = número de produtos pedido (por defeito 8 numa grelha, 12 num carrossel).
- Só usa {"mode":"manual","ids":[…]} se o pedido indicar IDs/referências de produto.

## Categorias do feed ${market.toUpperCase()} (categoria · nº de produtos em stock: subcategorias)
${treeForPrompt(tree)}

Página onde o elemento vai ficar: ${PAGE_LABEL[page] || page}.${copyOnly ? "\n\nMODO SÓ TEXTO: altera apenas textos (title, subtitle, text, eyebrow, kicker, labels, alt, description, html). Mantém exatamente os blocos, a ordem, os ids, as imagens (src), os links (url), os produtos e as restantes props." : ""}`;
}

const ELEMENT_TOOL = { name: "emit_element", description: "Devolve o elemento completo (lista de blocos da biblioteca hôma).", input_schema: elementSchema() };
const BLOCK_TOOL = { name: "emit_block", description: "Devolve só o bloco atualizado.", input_schema: singleBlockSchema() };

// categories the model may only take from the real tree
function checkCategories(el, tree) {
  const notes = [];
  for (const b of el.blocks) {
    const s = b.props.productSource;
    if (!s || s.mode !== "rule") continue;
    const cat = s.category ? tree.children.find((c) => c.name === s.category) : null;
    if (s.category && !cat) { notes.push(`Categoria “${s.category}” não existe no feed — regra sem categoria (escolhe uma no bloco).`); s.category = ""; s.subcategory = ""; continue; }
    if (s.subcategory && !cat?.children.some((c) => c.name === s.subcategory)) { notes.push(`Subcategoria “${s.subcategory}” não existe em “${s.category}” — removida.`); s.subcategory = ""; }
  }
  return notes;
}

async function logGeneration(entry) {
  console.log("[page-builder] generate", JSON.stringify(entry));
  const log = (await db.get(PBK.log())) || [];
  log.unshift(entry);
  await db.set(PBK.log(), log.slice(0, MAX_LOG));
}

/**
 * generate({ prompt, market, page, current, instruction, blockId, copyOnly, author })
 *  - new element:     prompt
 *  - refine element:  current + instruction
 *  - refine a block:  current + blockId + instruction
 * Always returns the full element JSON + notes + diff against `current`.
 */
export async function generate(input = {}) {
  const t0 = Date.now();
  const market = input.market === "es" ? "es" : input.current?.market === "es" ? "es" : "pt";
  const page = PAGES.includes(input.page) ? input.page : PAGES.includes(input.current?.page) ? input.current.page : "landing";
  const current = input.current ? normalizeElement(input.current, { market, page }) : null;
  const mode = current && input.blockId ? "block" : current ? "element" : "new";
  const prompt = String(input.prompt || "").trim(), instruction = String(input.instruction || "").trim();
  if (mode === "new" && !prompt) throw httpError(400, "Descreve o elemento que precisas");
  if (mode !== "new" && !instruction) throw httpError(400, "Escreve a instrução para a IA");
  const copyOnly = !!input.copyOnly && mode !== "new";
  const model = copyOnly ? process.env.PAGE_BUILDER_COPY_MODEL || DEFAULT_COPY_MODEL : process.env.PAGE_BUILDER_MODEL || DEFAULT_MODEL;
  const cat = await getCatalog(market);
  const tree = categoryTree(cat.items.filter((p) => p.inStock));
  const system = systemPrompt({ market, page, tree, copyOnly });

  let user, tool = ELEMENT_TOOL, target = null;
  if (mode === "new") user = `Pedido:\n${prompt}`;
  if (mode === "element") user = `Elemento atual (JSON):\n${JSON.stringify(stripForPrompt(current))}\n\nInstrução: ${instruction}\n\nDevolve o elemento completo atualizado. Mantém os "id" dos blocos e tudo o que a instrução não pede para mudar.`;
  if (mode === "block") {
    target = current.blocks.find((b) => b.id === input.blockId);
    if (!target) throw httpError(404, "Bloco não encontrado no elemento");
    tool = BLOCK_TOOL;
    user = `Elemento (para contexto): ${current.blocks.map((b, i) => `${i + 1}. ${b.type}${b.id === target.id ? " ← selecionado" : ""}`).join(", ")}\n\nBloco selecionado (JSON):\n${JSON.stringify(target)}\n\nInstrução: ${instruction}\n\nDevolve só este bloco atualizado (mantém o "id"; mantém o "type" salvo se a instrução pedir outro tipo de bloco).`;
  }

  const messages = [{ role: "user", content: user }];
  let out, usage = { input_tokens: 0, output_tokens: 0 }, errors = [];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      out = await callClaude({ model, system, messages, tool });
      usage = { input_tokens: usage.input_tokens + (out.usage.input_tokens || 0), output_tokens: usage.output_tokens + (out.usage.output_tokens || 0) };
      errors = validateSchema(tool.input_schema, out.input);
      if (!errors.length) break;
      // one retry with the validation errors (tool_result is_error), then fall back to normalisation
      messages.push({ role: "assistant", content: [{ type: "tool_use", id: out.toolUseId, name: tool.name, input: out.input }] });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: out.toolUseId, is_error: true, content: `O JSON não respeita o schema:\n${errors.slice(0, 30).join("\n")}\nCorrige e devolve outra vez.` }] });
    }
  } catch (e) {
    await logGeneration({ at: new Date().toISOString(), mode, model, market, page, prompt: (prompt || instruction).slice(0, 300), ms: Date.now() - t0, ok: false, error: e.message, author: input.author || "" });
    throw e;
  }

  let element, notes = [];
  if (mode === "block") {
    const nb = normalizeBlock({ ...out.input.block, id: target.id });
    if (!nb) throw httpError(502, `A IA devolveu um tipo de bloco desconhecido (${out.input.block?.type})`);
    element = { ...current, blocks: current.blocks.map((b) => (b.id === target.id ? nb : b)) };
    notes = (out.input.notes || []).map(String);
  } else {
    const raw = out.input || {};
    // refinements keep the element identity; blocks the model kept keep their ids
    element = normalizeElement({ ...raw, id: current?.id || "", market, page, name: raw.name || current?.name }, { market, page });
    notes = element.notes;
  }
  element.notes = [];
  notes.push(...checkCategories(element, tree));
  if (errors.length) notes.push(`A resposta da IA tinha ${errors.length} problema(s) de formato, corrigidos automaticamente.`);
  const ms = Date.now() - t0;
  await logGeneration({ at: new Date().toISOString(), mode, model, market, page, prompt: (prompt || instruction).slice(0, 300), blocks: element.blocks.length, tokensIn: usage.input_tokens, tokensOut: usage.output_tokens, ms, ok: true, author: input.author || "", elementId: current?.id || "" });
  return { element, notes, diff: current ? diffElements(current, element) : [], model, usage, ms, mode };
}
const stripForPrompt = (el) => ({ name: el.name, blocks: el.blocks });

// ---------------------------------------------------------------------------- elements (Blobs)
const summary = (r) => ({
  id: r.id, name: r.name, market: r.market, page: r.page, author: r.author || "", updatedBy: r.updatedBy || r.author || "",
  blocks: r.element?.blocks?.length || 0, types: [...new Set((r.element?.blocks || []).map((b) => b.type))],
  createdAt: r.createdAt, updatedAt: r.updatedAt, generatedAt: r.lastExport?.generatedAt || null, bytes: r.lastExport?.bytes || null,
  snapshotIds: Object.keys(r.lastExport?.productSnapshot || {}),
});

async function saveIndex(r, remove = false) {
  const idx = ((await db.get(PBK.index())) || []).filter((x) => x.id !== r.id);
  if (!remove) idx.unshift(summary(r));
  await db.set(PBK.index(), idx);
}
async function uniqueId(base) {
  const taken = new Set(((await db.get(PBK.index())) || []).map((x) => x.id));
  const b = `pb-${slugify(base) || "elemento"}`;
  let id = b, n = 2;
  while (taken.has(id)) id = `${b}-${n++}`;
  return id;
}
async function pushVersion(id, entry) {
  const v = (await db.get(PBK.versions(id))) || [];
  v.unshift(entry);
  await db.set(PBK.versions(id), v.slice(0, MAX_VERSIONS));
}

// "desatualizado": a product in the last export changed price / list price / stock (or left the feed)
export function staleness(snapshot = {}, catalogItems = []) {
  const byId = new Map(catalogItems.map((p) => [p.id, p]));
  const changed = [];
  for (const [id, s] of Object.entries(snapshot)) {
    const p = byId.get(id);
    if (!p) { changed.push({ id, reason: "saiu do feed" }); continue; }
    const price = p.salePrice ?? p.price ?? 0, list = p.salePrice ? p.price : null;
    if (Number(price) !== Number(s.price) || (list ?? null) !== (s.listPrice ?? null)) changed.push({ id, reason: `preço ${s.price} → ${price}` });
    else if (!!p.inStock !== !!s.inStock) changed.push({ id, reason: p.inStock ? "voltou a ter stock" : "ficou sem stock" });
  }
  return changed;
}

async function withStaleFlags(list) {
  const cats = {};
  for (const x of list) {
    if (!x.snapshotIds?.length) { x.stale = false; continue; }
    try {
      cats[x.market] ||= await getCatalog(x.market);
      const rec = await db.get(PBK.element(x.id));
      const ch = staleness(rec?.lastExport?.productSnapshot, cats[x.market].items);
      x.stale = ch.length > 0; x.staleProducts = ch.slice(0, 10);
    } catch { x.stale = null; }
  }
  return list.map(({ snapshotIds, ...x }) => ({ ...x, products: snapshotIds?.length || 0 }));
}

function cleanElement(body) {
  const el = normalizeElement(body.element || body, {});
  delete el.notes;
  return el;
}

// export: resolve products now, render, validate, snapshot (stored on the saved element when it exists)
export async function exportElement(input, { save = true } = {}) {
  const el = cleanElement(input);
  const { caps } = await getSettings();
  const { products, generatedAt } = await hydrateElement(el);
  const r = renderElement(el, { products, caps });
  const check = checkElement(el, products, r.html, caps);
  const snapshot = productSnapshot(Object.fromEntries(Object.entries(products).map(([k, v]) => [k, v.filter((p) => !p.missing && !p.oos)])));
  const result = { html: r.html, bytes: r.bytes, elementId: r.elementId, check, productSnapshot: snapshot, feedGeneratedAt: generatedAt, generatedAt: new Date().toISOString(), caps };
  if (save && el.id && check.ok) {
    const rec = await db.get(PBK.element(el.id));
    if (rec) {
      rec.lastExport = { html: r.html, bytes: r.bytes, generatedAt: result.generatedAt, productSnapshot: snapshot, element: el, author: input.author || "" };
      await db.set(PBK.element(el.id), rec);
      await saveIndex(rec);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------- routes (/api/page-builder/*)
export function registerPageBuilder(route) {
  route("GET", "/page-builder/library", async () => ({
    blocks: Object.fromEntries(Object.entries(BLOCKS).map(([k, d]) => [k, { label: d.label, figma: d.figma, llm: d.llm }])),
    model: process.env.PAGE_BUILDER_MODEL || DEFAULT_MODEL, copyModel: process.env.PAGE_BUILDER_COPY_MODEL || DEFAULT_COPY_MODEL, ...(await getSettings()),
  }));

  route("GET", "/page-builder/settings", async () => getSettings());
  route("PUT", "/page-builder/settings", async ({ body }) => {
    const s = { caps: { js: !!body.caps?.js }, capabilityTest: body.capabilityTest ? { ...body.capabilityTest, at: new Date().toISOString() } : (await getSettings()).capabilityTest };
    await db.set(PBK.settings(), s);
    return s;
  });

  // generation runs in a background function (Sonnet can take longer than a synchronous function allows)
  route("POST", "/page-builder/generate", async ({ body, req }) => {
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await db.set(PBK.job(id), { id, status: "running", startedAt: new Date().toISOString(), input: body });
    const res = await fetch(`${new URL(req.url).origin}/.netlify/functions/page-builder-background`, {
      method: "POST", headers: { authorization: `Bearer ${process.env.APP_PASSWORD}`, "content-type": "application/json" }, body: JSON.stringify({ jobId: id }),
    });
    if (res.status !== 202 && !res.ok) throw httpError(502, `Não foi possível iniciar a geração (${res.status})`);
    return { jobId: id };
  });
  route("GET", "/page-builder/jobs/:id", async ({ id }) => {
    const j = await db.get(PBK.job(id));
    if (!j) throw httpError(404, "Pedido não encontrado");
    if (j.status === "running" && Date.now() - Date.parse(j.startedAt) > 16 * 60 * 1000) return { ...j, input: undefined, status: "error", error: "A geração não terminou (timeout)" };
    return { ...j, input: undefined };
  });

  route("POST", "/page-builder/hydrate", async ({ body }) => hydrateElement(cleanElement(body)));
  route("POST", "/page-builder/export", async ({ body }) => exportElement(body, { save: body.save !== false }));
  route("GET", "/page-builder/log", async () => ((await db.get(PBK.log())) || []).slice(0, 100));

  route("GET", "/page-builder/elements", async () => withStaleFlags((await db.get(PBK.index())) || []));

  route("POST", "/page-builder/elements", async ({ body }) => {
    const el = cleanElement(body);
    const now = new Date().toISOString();
    el.id = await uniqueId(el.name);
    const rec = { id: el.id, name: el.name, market: el.market, page: el.page, author: String(body.author || ""), updatedBy: String(body.author || ""), element: el, createdAt: now, updatedAt: now, lastExport: null };
    await db.set(PBK.element(el.id), rec);
    await pushVersion(el.id, { at: now, author: rec.author, element: el });
    await saveIndex(rec);
    return rec;
  });

  route("GET", "/page-builder/elements/:id", async ({ id }) => {
    const r = await db.get(PBK.element(id));
    if (!r) throw httpError(404, "Elemento não encontrado");
    return r;
  });

  route("PUT", "/page-builder/elements/:id", async ({ id, body }) => {
    const cur = await db.get(PBK.element(id));
    if (!cur) throw httpError(404, "Elemento não encontrado");
    const el = { ...cleanElement(body), id };
    const now = new Date().toISOString();
    const rec = { ...cur, name: el.name, market: el.market, page: el.page, element: el, updatedAt: now, updatedBy: String(body.author || cur.updatedBy || "") };
    await db.set(PBK.element(id), rec);
    await pushVersion(id, { at: now, author: rec.updatedBy, element: el });
    await saveIndex(rec);
    return rec;
  });

  route("GET", "/page-builder/elements/:id/versions", async ({ id }) => (await db.get(PBK.versions(id))) || []);

  route("POST", "/page-builder/elements/:id/duplicate", async ({ id, body }) => {
    const cur = await db.get(PBK.element(id));
    if (!cur) throw httpError(404, "Elemento não encontrado");
    const now = new Date().toISOString();
    const nid = await uniqueId(`${cur.name} copia`);
    const el = { ...cur.element, id: nid, name: `${cur.name} (cópia)` };
    const rec = { ...cur, id: nid, name: el.name, element: el, author: String(body.author || cur.author || ""), updatedBy: String(body.author || ""), createdAt: now, updatedAt: now, lastExport: null };
    await db.set(PBK.element(nid), rec);
    await pushVersion(nid, { at: now, author: rec.author, element: el });
    await saveIndex(rec);
    return rec;
  });

  route("DELETE", "/page-builder/elements/:id", async ({ id }) => {
    await db.del(PBK.element(id));
    await db.del(PBK.versions(id));
    await saveIndex({ id }, true);
    return { ok: true };
  });
}
