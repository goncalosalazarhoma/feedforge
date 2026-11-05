// hôma Page Builder engine — block library, JSON Schema, validation and the deterministic HTML renderer.
// Pure ES module with no dependencies: imported by the Netlify functions (generation / export), by the
// editor in the browser (live preview) and by the tests. The AI only ever fills this JSON; it never writes HTML.
//
// Adding a block type: see README → "Page Builder › Adicionar um tipo de bloco".

export const VERSION = 1;
export const HOST = "https://www.homastores.com";
export const MARKET_PATH = { pt: "/pt/pt", es: "/es/es" };
export const LOCALE = { pt: "pt-PT", es: "es-ES" };

// ---------------------------------------------------------------------------- design tokens (Figma "Website")
export const TOKENS = {
  font: 'Gilroy,"Helvetica Neue",Arial,sans-serif',
  text: "#181818", headline: "#000000", secondary: "#444444", disabled: "#757575", arrow: "#aeaeae",
  border: "#e5e5e5", surface: "#f3f3f3", white: "#ffffff", nearBlack: "#101010",
  beige: "#f3f1ea", cardBg: "#f8f6f4", block: "#dfdbd2", brand: "#daaa00", accent: "#fcaf17",
  brown: "#583d3e", green: "#279989", success: "#194e31", danger: "#8e030f", info: "#0f69ae", warning: "#8c4b02",
  shadow: "0 2px 8px rgba(0,42,70,.10)",
};
export const BACKGROUNDS = {
  white: { label: "Branco", bg: "#ffffff", dark: false },
  beige: { label: "Bege #f3f1ea", bg: "#f3f1ea", dark: false },
  sand: { label: "Color block #dfdbd2", bg: "#dfdbd2", dark: false },
  brown: { label: "Castanho #583d3e (texto branco)", bg: "#583d3e", dark: true },
  dark: { label: "Escuro #181818 (texto branco)", bg: "#181818", dark: true },
  image: { label: "Imagem", bg: "#181818", dark: true },
};
export const SPACING = [0, 12, 16, 24, 32, 36, 40, 48, 80, 118]; // 118 = padding da lista de produtos (Figma)
const MOBILE_SPACE = { 118: 48, 80: 48, 48: 32, 40: 32, 36: 24 };
export const ICONS = {
  truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>',
  return: '<path d="M9 7 5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>',
  store: '<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5h16"/><path d="M9.5 20v-6h5v6"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 10h18M7 14.5h4"/>',
  leaf: '<path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15"/><path d="M5 19c3-4 6-7 10-9"/>',
  gift: '<rect x="4" y="10" width="16" height="10"/><path d="M3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
};

// ---------------------------------------------------------------------------- field helpers
const opt = (pairs) => pairs.map((p) => (Array.isArray(p) ? p : [p, String(p)]));
const F = {
  text: (label, o = {}) => ({ kind: "text", label, max: 160, ...o }),
  long: (label, o = {}) => ({ kind: "text", label, max: 600, multiline: true, ...o }),
  rich: (label, o = {}) => ({ kind: "rich", label, max: 6000, ...o }),
  image: (label, o = {}) => ({ kind: "image", label, required: true, ...o }),
  link: (label, o = {}) => ({ kind: "link", label, ...o }),
  enum: (label, options, def, o = {}) => ({ kind: "enum", label, options: opt(options), default: def, ...o }),
  int: (label, min, max, def, o = {}) => ({ kind: "int", label, min, max, default: def, ...o }),
  bool: (label, def = false, o = {}) => ({ kind: "bool", label, default: def, ...o }),
  products: (label) => ({ kind: "products", label }),
};

export const COMMON = {
  background: F.enum("Fundo", Object.entries(BACKGROUNDS).map(([k, v]) => [k, v.label]), "white"),
  backgroundImage: F.image("Imagem de fundo (se o fundo for “Imagem”)", { required: false }),
  paddingTop: F.enum("Espaço em cima", SPACING.map((n) => [n, `${n}px`]), 48),
  paddingBottom: F.enum("Espaço em baixo", SPACING.map((n) => [n, `${n}px`]), 48),
  fullBleed: F.bool("Largura total (sem margens laterais)"),
  hideOn: F.enum("Esconder em", [["", "—"], ["mobile", "Mobile"], ["desktop", "Desktop"]], ""),
  anchor: F.text("Âncora (#id)", { max: 40 }),
};

const IMG = (w, h) => ({ src: "", alt: "", description: `Fotografia ${w}×${h}` });

// ---------------------------------------------------------------------------- block library (v1)
export const BLOCKS = {
  "section-heading": {
    label: "Título de secção", figma: "Section Headings",
    llm: "Eyebrow + título (+ texto e link opcionais à direita). Usa antes de listas de produtos, grelhas ou zig-zags para lhes dar título.",
    props: { eyebrow: F.text("Eyebrow", { max: 60 }), title: F.text("Título", { required: true, max: 90 }), text: F.long("Texto", { max: 300 }), link: F.link("Link"), align: F.enum("Alinhamento", [["left", "Esquerda"], ["center", "Centro"]], "left") },
    defaults: { paddingTop: 48, paddingBottom: 24 },
    sample: { props: { eyebrow: "Novidades", title: "Coleção de Outono/Inverno", text: "Peças pensadas para dar conforto e cor à sua casa nos dias mais frios.", link: { label: "Ver coleção", url: "/colecao-outono-inverno" } } },
  },
  "hero-banner": {
    label: "Banner hero", figma: "Banner highlight full (1920×744)",
    llm: "Imagem a toda a largura com gradiente escuro, título grande (Display 2), subtítulo e botão sobre a imagem. Topo de página ou campanha.",
    props: { image: F.image("Imagem (1920×744)"), title: F.text("Título", { required: true, max: 70 }), subtitle: F.long("Subtítulo", { max: 200 }), cta: F.link("Botão"), overlayStrength: F.enum("Gradiente", [["light", "Leve"], ["medium", "Médio"], ["strong", "Forte"]], "medium"), textPosition: F.enum("Texto", [["left", "Esquerda"], ["center", "Centro"]], "left") },
    defaults: { fullBleed: true, paddingTop: 0, paddingBottom: 0 },
    sample: { props: { image: { src: "https://www.homastores.com/dw/image/v2/BFDH_PRD/on/demandware.static/-/Sites-Homa_PT-Library/default/dwd87779c6/home/shoplook/hp-shop-trend-image_solidcolor.webp?sw=1920&q=80", alt: "Sala com sofá branco e almofadas", description: "" }, title: "Tudo para um Natal ainda mais seu", subtitle: "Decoração, iluminação e presentes para todos os cantos da casa.", cta: { label: "Descobrir o Natal", url: "/natal" } } },
  },
  "campaign-highlight": {
    label: "Destaque de campanha", figma: "Campaign highlight (1280×810, mobile 375×810)",
    llm: "Imagem grande com kicker (Caption, maiúsculas espaçadas), título Display 1 Light sobre a imagem e link com seta. Para destacar uma campanha ou coleção.",
    props: { image: F.image("Imagem (1280×810)"), kicker: F.text("Kicker", { max: 40 }), title: F.text("Título", { required: true, max: 70 }), link: F.link("Link") },
    defaults: { paddingTop: 48, paddingBottom: 48 },
    sample: { props: { image: { src: "https://www.homastores.com/dw/image/v2/BFDH_PRD/on/demandware.static/-/Sites-Homa_PT-Library/default/dwd87779c6/home/shoplook/hp-shop-trend-image_solidcolor.webp?sw=1280&q=80", alt: "Sala decorada", description: "" }, kicker: "Nunca igual. Sempre Natal.", title: "Coleção de Natal", link: { label: "Ver coleção", url: "/natal" } } },
  },
  "image-tiles": {
    label: "Grelha de imagens", figma: "Shop by style (4 tiles × 640px)",
    llm: "N imagens com link lado a lado (2 a 6 colunas; no mobile fazem scroll horizontal), cada uma com título branco centrado e link sublinhado. Para estilos, divisões, coleções ou campanhas.",
    props: { columns: F.int("Colunas (desktop)", 2, 6, 4), height: F.int("Altura (px, desktop)", 320, 800, 640) },
    items: { label: "Imagem", min: 1, max: 6, fields: { image: F.image("Imagem"), title: F.text("Título", { max: 50 }), linkLabel: F.text("Texto do link", { max: 30 }), url: F.link("Link (URL)", { urlOnly: true, required: true }) } },
    defaults: { paddingTop: 48, paddingBottom: 48 },
    sample: { props: { columns: 4 }, items: ["Sala de estar", "Quarto", "Cozinha", "Casa de banho"].map((t, i) => ({ image: { src: `https://picsum.photos/seed/homa${i}/640/960`, alt: t, description: "" }, title: t, linkLabel: "Ver produtos", url: { url: `/${["sala", "quarto", "cozinha", "casa-de-banho"][i]}` } })) },
  },
  "modular-cards": {
    label: "Cartões modulares", figma: "Modular Cards (2-up 960×960)",
    llm: "Dois cartões quadrados lado a lado: cartão com imagem (título + botão) ou cartão de cor sólida castanha #583d3e (título + texto + link). Para destacar duas campanhas, ou imagem + mensagem.",
    props: {},
    items: { label: "Cartão", min: 1, max: 4, fields: { variant: F.enum("Tipo", [["image", "Imagem"], ["solid", "Cor sólida"]], "image"), image: F.image("Imagem", { required: false }), bg: F.enum("Cor (cartão sólido)", [["brown", "Castanho #583d3e"], ["dark", "Escuro #181818"], ["sand", "Color block #dfdbd2"], ["beige", "Bege #f3f1ea"]], "brown"), title: F.text("Título", { max: 60 }), text: F.long("Texto", { max: 220 }), cta: F.link("Botão / link") } },
    defaults: { paddingTop: 48, paddingBottom: 48 },
    sample: { items: [{ variant: "image", image: { src: "https://picsum.photos/seed/homa7/960/960", alt: "Mesa de Natal", description: "" }, title: "Mesa de Natal", cta: { label: "Comprar agora", url: "/natal/mesa" } }, { variant: "solid", bg: "brown", title: "Novo catálogo", text: "Folheie as novidades da estação e encontre inspiração para cada divisão.", cta: { label: "Ver catálogo", url: "/catalogo" } }] },
  },
  "zig-zag": {
    label: "Zig-zag", figma: "Zig Zag Section",
    llm: "Linhas alternadas imagem / texto (eyebrow, título, texto, link). Ideal para landings editoriais (ex.: sustentabilidade, materiais, histórias de produto).",
    props: { startSide: F.enum("1.ª imagem à", [["left", "Esquerda"], ["right", "Direita"]], "left") },
    items: { label: "Linha", min: 1, max: 6, fields: { image: F.image("Imagem"), eyebrow: F.text("Eyebrow", { max: 50 }), title: F.text("Título", { max: 80 }), text: F.long("Texto", { max: 500 }), cta: F.link("Link") } },
    defaults: { paddingTop: 48, paddingBottom: 48 },
    sample: { items: [0, 1].map((i) => ({ image: { src: `https://picsum.photos/seed/homaz${i}/800/800`, alt: "Detalhe de materiais", description: "" }, eyebrow: "Sustentabilidade", title: i ? "Algodão de origem responsável" : "Materiais naturais", text: "Escolhemos materiais que duram e que fazem bem à sua casa e ao planeta.", cta: { label: "Saber mais", url: "/sustentabilidade" } })) },
  },
  "text-block": {
    label: "Bloco de texto", figma: "our story (1200)",
    llm: "Título + texto corrido (pode ter negrito, itálico, links e listas). Para introduções, histórias, explicações.",
    props: { title: F.text("Título", { max: 90 }), html: F.rich("Texto"), align: F.enum("Alinhamento", [["left", "Esquerda"], ["center", "Centro"]], "left"), maxWidth: F.enum("Largura máxima", [[720, "720px"], [960, "960px"], [1200, "1200px"]], 960) },
    defaults: { paddingTop: 48, paddingBottom: 48 },
    sample: { props: { title: "A nossa história", html: "<p>Na hôma acreditamos que uma casa se faz de <strong>pequenos detalhes</strong>.</p><ul><li>Design acessível</li><li>Materiais pensados para durar</li></ul>", align: "center" } },
  },
  "cta-section": {
    label: "Secção CTA", figma: "cta section",
    llm: "Título + texto de apoio + botão, centrados, sobre um fundo de cor. Para fechar uma página ou levar a uma ação.",
    props: { title: F.text("Título", { required: true, max: 80 }), text: F.long("Texto", { max: 300 }), cta: F.link("Botão") },
    defaults: { background: "beige", paddingTop: 80, paddingBottom: 80 },
    sample: { props: { title: "Adira ao cartão happy hôma", text: "5€ de desconto em cartão por cada 250€ em compras.", cta: { label: "Saber mais", url: "/cartao-happy-homa" } } },
  },
  "category-tiles": {
    label: "Categorias", figma: "Category Slider / Categories/Section",
    llm: "Fila (grelha ou carrossel) de categorias com imagem quadrada e nome. Para navegação por categorias.",
    props: { layout: F.enum("Layout", [["grid", "Grelha"], ["scroll", "Carrossel (scroll)"]], "grid") },
    items: { label: "Categoria", min: 1, max: 12, fields: { image: F.image("Imagem"), label: F.text("Nome", { max: 40 }), url: F.link("Link (URL)", { urlOnly: true, required: true }) } },
    defaults: { paddingTop: 24, paddingBottom: 48 },
    sample: { items: ["Decoração", "Cozinha", "Têxtil", "Arrumação", "Banho", "Jardim"].map((t, i) => ({ image: { src: `https://picsum.photos/seed/homac${i}/400/400`, alt: t, description: "" }, label: t, url: { url: `/${["decoracao", "cozinha", "textil", "arrumacao", "banho", "jardim"][i]}` } })) },
  },
  benefits: {
    label: "Vantagens", figma: "Benefits Section",
    llm: "3 a 4 vantagens com ícone (truck, return, store, card, leaf, gift, chat), título e texto curto. Só com vantagens reais que o pedido refira.",
    props: {},
    items: { label: "Vantagem", min: 1, max: 4, fields: { icon: F.enum("Ícone", Object.keys(ICONS).map((k) => [k, k]), "truck"), title: F.text("Título", { max: 40 }), text: F.long("Texto", { max: 140 }) } },
    defaults: { paddingTop: 48, paddingBottom: 48 },
    sample: { items: [{ icon: "truck", title: "Entrega em casa", text: "Receba as suas compras onde quiser." }, { icon: "store", title: "Levantamento em loja", text: "Escolha a loja mais perto de si." }, { icon: "return", title: "Devoluções", text: "Pode devolver em qualquer loja hôma." }, { icon: "card", title: "Cartão happy hôma", text: "Ganhe desconto nas próximas compras." }] },
  },
  "product-grid": {
    label: "Grelha de produtos", figma: "Card/Product/Default",
    llm: "Grelha de cartões de produto do feed (4 por linha no desktop, 2 no mobile), com título opcional e link “ver todos”. Para títulos com eyebrow, põe um section-heading antes e deixa title vazio.",
    props: { title: F.text("Título", { max: 90 }), productSource: F.products("Produtos"), limit: F.int("Número de produtos", 1, 24, 8), showBadges: F.bool("Mostrar badges", true), viewAll: F.link("Link “ver todos”") },
    defaults: { paddingTop: 24, paddingBottom: 48 },
    sample: { props: { title: "", limit: 8, productSource: { mode: "rule", category: "Decoração", onSale: false, inStock: true, sort: "feed_order", limit: 8 }, viewAll: { label: "Ver todos", url: "/decoracao" } } },
  },
  "product-carousel": {
    label: "Carrossel de produtos", figma: "Products list (Shop the Look)",
    llm: "Fila horizontal de cartões de produto (scroll-snap) sobre fundo bege #f3f1ea, com título. Para listas de destaque em homepage/PDP.",
    props: { title: F.text("Título", { max: 90 }), productSource: F.products("Produtos"), limit: F.int("Número de produtos", 2, 24, 12), showBadges: F.bool("Mostrar badges", true) },
    defaults: { background: "beige", paddingTop: 118, paddingBottom: 118 },
    sample: { props: { title: "Os mais vendidos", limit: 8, productSource: { mode: "rule", category: "Decoração", inStock: true, sort: "feed_order", limit: 8 } } },
  },
  spacer: {
    label: "Espaço", figma: "—",
    llm: "Espaço vertical (escala 12–80px). Raramente necessário: cada bloco já tem espaço em cima/baixo.",
    props: { size: F.enum("Altura", SPACING.filter(Boolean).map((n) => [n, `${n}px`]), 48) },
    defaults: { paddingTop: 0, paddingBottom: 0 },
    sample: { props: { size: 48 } },
  },
};
export const BLOCK_TYPES = Object.keys(BLOCKS);
export const PRODUCT_BLOCKS = ["product-grid", "product-carousel"];
export const SORTS = [["feed_order", "Ordem do feed"], ["price_asc", "Preço ↑"], ["price_desc", "Preço ↓"], ["newest", "Mais recentes"]];

// ---------------------------------------------------------------------------- JSON Schema (for Claude tool use + validation)
function fieldSchema(f) {
  switch (f.kind) {
    case "text": return { type: "string", maxLength: f.max, description: f.label };
    case "rich": return { type: "string", maxLength: f.max, description: `${f.label} — HTML simples: <p>, <strong>, <em>, <a href>, <ul>, <ol>, <li>, <br>` };
    case "image": return { type: "object", description: f.label, properties: { src: { type: "string", description: "URL https da imagem; deixa vazio se não foi dado" }, alt: { type: "string", maxLength: 160, description: "texto alternativo (obrigatório)" }, description: { type: "string", maxLength: 300, description: "que fotografia deve ir aqui (para a equipa escolher)" } }, required: ["src", "alt"], additionalProperties: false };
    case "link":
      if (f.urlOnly) return { type: "object", description: f.label, properties: { url: { type: "string", description: "caminho em homastores.com; vazio se não foi dado" } }, required: ["url"], additionalProperties: false };
      return { type: "object", description: f.label, properties: { label: { type: "string", maxLength: 40 }, url: { type: "string", description: "caminho em homastores.com; vazio se não foi dado" } }, required: ["label", "url"], additionalProperties: false };
    case "enum": return { enum: f.options.map(([v]) => v), description: f.label };
    case "int": return { type: "integer", minimum: f.min, maximum: f.max, description: f.label };
    case "bool": return { type: "boolean", description: f.label };
    case "products": return {
      type: "object", description: "Origem dos produtos: mode 'rule' (preferido, resolvido a partir do feed) ou 'manual' (ids)",
      properties: {
        mode: { enum: ["rule", "manual"] }, ids: { type: "array", items: { type: "string" }, maxItems: 48 },
        category: { type: "string", description: "categoria de 1.º nível, EXATAMENTE como na lista dada" }, subcategory: { type: "string", description: "subcategoria, EXATAMENTE como na lista dada" },
        onSale: { type: "boolean" }, inStock: { type: "boolean" }, priceMin: { type: "number", minimum: 0 }, priceMax: { type: "number", minimum: 0 },
        sort: { enum: SORTS.map(([v]) => v) }, limit: { type: "integer", minimum: 1, maximum: 48 },
      },
      required: ["mode"], additionalProperties: false,
    };
    default: throw new Error(`campo desconhecido ${f.kind}`);
  }
}
const objSchema = (fields, required = []) => ({ type: "object", properties: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, fieldSchema(f)])), required, additionalProperties: false });

export function blockSchema(type) {
  const d = BLOCKS[type];
  const req = Object.entries(d.props).filter(([, f]) => f.required).map(([k]) => k);
  const s = {
    type: "object", description: `${d.label} — ${d.llm}`,
    properties: { type: { const: type }, id: { type: "string" }, props: objSchema({ ...COMMON, ...d.props }, req) },
    required: ["type", "props"], additionalProperties: false,
  };
  if (d.items) {
    s.properties.items = { type: "array", minItems: d.items.min, maxItems: d.items.max, items: objSchema(d.items.fields) };
    s.required.push("items");
  }
  return s;
}

export function elementSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string", maxLength: 80, description: "nome curto do elemento (para a lista)" },
      blocks: { type: "array", minItems: 1, maxItems: 20, items: { anyOf: BLOCK_TYPES.map(blockSchema) } },
      notes: { type: "array", items: { type: "string", maxLength: 300 }, description: "o que o pedido tinha e não foi possível fazer com a biblioteca (formulários, vídeo, contagem decrescente…)" },
    },
    required: ["name", "blocks"], additionalProperties: false,
  };
}
export function singleBlockSchema() {
  return { type: "object", properties: { block: { anyOf: BLOCK_TYPES.map(blockSchema) }, notes: { type: "array", items: { type: "string" } } }, required: ["block"], additionalProperties: false };
}

// small JSON Schema validator for exactly the subset generated above (type, properties, required,
// additionalProperties:false, enum, const, maxLength, minimum, maximum, items, minItems, maxItems, anyOf)
export function validateSchema(schema, value, path = "$") {
  const errs = [];
  const typeOk = (t, v) => (t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v) : t === "array" ? Array.isArray(v) : t === "object" ? v !== null && typeof v === "object" && !Array.isArray(v) : typeof v === t);
  if (schema.anyOf) {
    // discriminate blocks by their `type` const for readable errors
    const byConst = schema.anyOf.find((s) => s.properties?.type?.const && value?.type === s.properties.type.const);
    if (byConst) return validateSchema(byConst, value, path);
    if (schema.anyOf.some((s) => !validateSchema(s, value, path).length)) return errs;
    return [`${path}: não corresponde a nenhum tipo permitido${value?.type ? ` (type "${value.type}" não existe)` : ""}`];
  }
  if ("const" in schema && value !== schema.const) return [`${path}: tem de ser ${JSON.stringify(schema.const)}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: valor ${JSON.stringify(value)} fora de ${JSON.stringify(schema.enum)}`];
  if (schema.type && !typeOk(schema.type, value)) return [`${path}: esperado ${schema.type}`];
  if (typeof value === "string" && schema.maxLength != null && value.length > schema.maxLength) errs.push(`${path}: texto com mais de ${schema.maxLength} caracteres`);
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) errs.push(`${path}: mínimo ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errs.push(`${path}: máximo ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path}: mínimo ${schema.minItems} elementos`);
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${path}: máximo ${schema.maxItems} elementos`);
    if (schema.items) value.forEach((v, i) => errs.push(...validateSchema(schema.items, v, `${path}[${i}]`)));
  }
  if (schema.type === "object" && value) {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}.${k}: obrigatório`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errs.push(...validateSchema(schema.properties[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: propriedade não permitida`);
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------- normalisation (coerce, never throws)
const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);
export const slugify = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
let seq = 0;
export const newId = (p = "b") => `${p}${Date.now().toString(36).slice(-4)}${(seq++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 4)}`;

export function normalizeSource(v = {}, limit) {
  if (v?.mode === "manual") return { mode: "manual", ids: [...new Set((Array.isArray(v.ids) ? v.ids : []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 48) };
  const num = (x) => (x === "" || x == null || !Number.isFinite(Number(x)) ? null : Math.max(0, Number(x)));
  const r = { mode: "rule", category: str(v?.category, 120), subcategory: str(v?.subcategory, 120), onSale: !!v?.onSale, inStock: v?.inStock !== false };
  if (num(v?.priceMin) != null) r.priceMin = num(v.priceMin);
  if (num(v?.priceMax) != null) r.priceMax = num(v.priceMax);
  r.sort = SORTS.some(([s]) => s === v?.sort) ? v.sort : "feed_order";
  r.limit = Math.max(1, Math.min(48, Math.round(Number(limit ?? v?.limit) || 8)));
  return r;
}

function normField(f, v) {
  switch (f.kind) {
    case "text": return str(v ?? f.default ?? "", f.max);
    case "rich": return sanitizeRich(str(v, f.max), "pt").html;
    case "image": return { src: str(v?.src, 1000).trim(), alt: str(v?.alt, 160), description: str(v?.description, 300) };
    case "link": return f.urlOnly ? { url: str(typeof v === "string" ? v : v?.url, 500).trim() } : { label: str(v?.label, 40), url: str(v?.url, 500).trim() };
    case "enum": return f.options.some(([o]) => o === v) ? v : f.options.some(([o]) => String(o) === String(v)) ? f.options.find(([o]) => String(o) === String(v))[0] : f.default;
    case "int": { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(f.min, Math.min(f.max, n)) : f.default; }
    case "bool": return v == null ? f.default : !!v;
    case "products": return normalizeSource(v);
    default: return v;
  }
}

export function normalizeBlock(raw = {}) {
  const d = BLOCKS[raw?.type];
  if (!d) return null;
  const rawProps = { ...(raw.props || {}) };
  const props = {};
  for (const [k, f] of Object.entries({ ...COMMON, ...d.props })) {
    const v = k in rawProps ? rawProps[k] : d.defaults?.[k] ?? (f.kind === "products" ? undefined : f.default);
    props[k] = normField(f, v);
  }
  if (props.anchor) props.anchor = slugify(props.anchor);
  // one number for "how many products": block.limit is the source of truth, mirrored into rule.limit
  if (props.productSource) {
    if (rawProps.limit == null && raw.props?.productSource?.limit) props.limit = normField(d.props.limit, raw.props.productSource.limit);
    if (props.productSource.mode === "rule") props.productSource.limit = props.limit;
  }
  const b = { id: /^[a-z][a-z0-9-]{1,40}$/i.test(raw.id || "") ? raw.id : newId(), type: raw.type, props };
  if (d.items) {
    const src = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.props?.rows) ? raw.props.rows : Array.isArray(raw.props?.items) ? raw.props.items : [];
    b.items = src.slice(0, d.items.max).map((it) => Object.fromEntries(Object.entries(d.items.fields).map(([k, f]) => [k, normField(f, it?.[k])])));
  }
  return b;
}

export function normalizeElement(raw = {}, base = {}) {
  const market = MARKET_PATH[raw.market] ? raw.market : MARKET_PATH[base.market] ? base.market : "pt";
  const notes = [];
  const blocks = [];
  for (const rb of Array.isArray(raw.blocks) ? raw.blocks : []) {
    const b = normalizeBlock(rb);
    if (b) blocks.push(b); else notes.push(`Bloco “${rb?.type}” não existe na biblioteca e foi ignorado.`);
  }
  const seen = new Set();
  for (const b of blocks) { if (seen.has(b.id)) b.id = newId(); seen.add(b.id); }
  return {
    version: VERSION,
    id: raw.id || base.id || "",
    name: str(raw.name || base.name || "Novo elemento", 120),
    market,
    page: ["homepage", "plp", "pdp", "landing"].includes(raw.page) ? raw.page : ["homepage", "plp", "pdp", "landing"].includes(base.page) ? base.page : "landing",
    blocks: blocks.slice(0, 30),
    notes: [...(Array.isArray(raw.notes) ? raw.notes.map((n) => str(n, 300)).filter(Boolean) : []), ...notes],
  };
}

export function blankBlock(type) {
  const d = BLOCKS[type];
  const items = d.items ? Array.from({ length: Math.min(d.items.min || 1, 2) }, () => ({})) : undefined;
  return normalizeBlock({ type, props: {}, items });
}
export function sampleBlock(type) {
  const d = BLOCKS[type];
  return normalizeBlock({ type, id: `s-${type}`, props: { ...(d.sample?.props || {}) }, items: d.sample?.items });
}

// ---------------------------------------------------------------------------- escaping, links, rich text
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// editorial links: absolute https://www.homastores.com/{pt/pt|es/es}/... ("/natal" → market prefix added)
export function normalizeUrl(u, market = "pt") {
  let s = String(u ?? "").trim();
  if (!s) return { url: "", error: "link vazio" };
  if (/[\s<>"'`]/.test(s)) return { url: "", error: "link com caracteres inválidos" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) return { url: "", error: "protocolo não permitido" };
  if (s.startsWith("//")) s = "https:" + s;
  if (s.startsWith("/")) s = HOST + s;
  if (!/^https?:\/\//i.test(s)) s = HOST + "/" + s.replace(/^\.?\/*/, "");
  let x;
  try { x = new URL(s); } catch { return { url: "", error: "link inválido" }; }
  if (!/^(www\.)?homastores\.com$/i.test(x.hostname)) return { url: "", error: "tem de ser um link de www.homastores.com" };
  x.protocol = "https:"; x.hostname = "www.homastores.com"; x.port = "";
  const mk = MARKET_PATH[market] || MARKET_PATH.pt;
  let warn = "";
  const m = x.pathname.match(/^\/(pt\/pt|es\/es)(\/|$)/);
  if (!m) x.pathname = mk + (x.pathname === "/" ? "/" : x.pathname);
  else if ("/" + m[1] !== mk) warn = `link para o outro mercado (${m[1]})`;
  return { url: x.toString(), ...(warn ? { warn } : {}) };
}
export const isHttpsUrl = (u) => { if (!/^https:\/\/[^\s"'<>`]+$/i.test(String(u || ""))) return false; try { return new URL(u).protocol === "https:"; } catch { return false; } };

// text-block HTML: only p, br, strong/b, em/i, a[href to homastores.com], ul, ol, li — everything else becomes text
const RICH_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "a", "ul", "ol", "li"]);
export function sanitizeRich(html, market = "pt") {
  const removed = [];
  let s = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|iframe|object|embed|template|noscript|svg|math|textarea|select)\b[\s\S]*?<\/\1\s*>/gi, (m, t) => (removed.push(t), ""));
  s = s.replace(/<(script|style|iframe|object|embed|template|noscript|svg|math)\b[^>]*>/gi, (m, t) => (removed.push(t), ""));
  const out = [], stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let last = 0, m;
  const text = (t) => out.push(t.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  while ((m = re.exec(s))) {
    text(s.slice(last, m.index));
    last = re.lastIndex;
    const close = !!m[1], tag = m[2].toLowerCase();
    if (!RICH_TAGS.has(tag)) { removed.push(tag); continue; }
    if (tag === "br") { if (!close) out.push("<br>"); continue; }
    if (close) {
      const i = stack.lastIndexOf(tag);
      if (i < 0) continue;
      while (stack.length > i) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (tag === "a") {
      const h = m[3].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const n = normalizeUrl(h ? h[1] ?? h[2] ?? h[3] : "", market);
      if (!n.url) { removed.push("a[href inválido]"); stack.push("a#skip"); continue; }
      out.push(`<a href="${esc(n.url)}">`); stack.push("a");
      continue;
    }
    out.push(`<${tag}>`); stack.push(tag);
  }
  text(s.slice(last));
  while (stack.length) { const t = stack.pop(); if (t !== "a#skip") out.push(`</${t}>`); }
  return { html: out.join("").replace(/<\/a#skip>/g, ""), removed: [...new Set(removed)] };
}

// ---------------------------------------------------------------------------- formatting
export const money = (n, market = "pt") => new Intl.NumberFormat(LOCALE[market] || "pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(Number(n) || 0);
const discount = (price, list) => (list && price && list > price ? Math.round((1 - price / list) * 100) : 0);

// ---------------------------------------------------------------------------- CSS (every selector is prefixed with the element root id)
const BASE_CSS = `
&{font-family:${TOKENS.font};color:#181818;-webkit-font-smoothing:antialiased;max-width:1920px;margin:0 auto;font-size:16px;line-height:28px}
& *,& *::before,& *::after{box-sizing:border-box}
& h2,& h3,& p,& ul,& ol{margin:0;padding:0;font-weight:inherit}
& a{color:inherit}
& img{display:block;max-width:100%;border:0}
& .hpb-b{position:relative;padding-left:40px;padding-right:40px}
& .hpb-b.fb{padding-left:0;padding-right:0}
& .hpb-in{max-width:1840px;margin:0 auto}
& .bg-white{background:#ffffff}& .bg-beige{background:#f3f1ea}& .bg-sand{background:#dfdbd2}& .bg-brown{background:#583d3e;color:#fff}& .bg-dark{background:#181818;color:#fff}& .bg-image{background:#181818 center/cover no-repeat;color:#fff}
& .dk h2,& .dk h3{color:#fff}
& h2,& h3{color:#000}
& .t-d1{font-size:58px;line-height:74px;font-weight:300;letter-spacing:-2px}
& .t-d2{font-size:46px;line-height:68px;font-weight:500}
& .t-d3{font-size:34px;line-height:48px;font-weight:500;letter-spacing:-.02em}
& .t-h4{font-size:24px;line-height:36px;font-weight:500}
& .t-h6{font-size:20px;line-height:32px;font-weight:500}
& .t-sub{font-size:18px;line-height:28px;font-weight:300;text-transform:uppercase}
& .t-b1{font-size:16px;line-height:28px;font-weight:400}
& .t-b2{font-size:14px;line-height:24px;font-weight:400}
& .t-cap{font-size:14px;line-height:24px;font-weight:700;letter-spacing:7px;text-transform:uppercase}
& .btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 32px;font-size:14px;line-height:20px;font-weight:400;text-decoration:none;border:1px solid #181818;border-radius:0;cursor:pointer}
& .btn-p{background:#181818;color:#fff}
& .btn-s{background:#fff;color:#181818}
& .btn-i{background:transparent;color:#fff;border-color:#fff;text-transform:uppercase;letter-spacing:1px}
& .dk .btn-p{background:#fff;color:#181818;border-color:#fff}
& .lnk{font-size:16px;line-height:28px;font-weight:500;text-decoration:underline;text-underline-offset:4px}
& .ph{display:flex;align-items:center;justify-content:center;background:#e5e5e5;color:#757575;font-size:12px;line-height:18px;text-align:center;padding:16px;width:100%;height:100%}
@media (max-width:767px){
& .hpb-b{padding-left:16px;padding-right:16px}
& .hm{display:none!important}
& .t-d1{font-size:32px;line-height:46px}
& .t-d2{font-size:32px;line-height:46px}
& .t-d3{font-size:24px;line-height:32px}
& .t-h4{font-size:20px;line-height:32px}
& .t-h6{font-size:18px;line-height:28px}
& .t-sub{font-size:14px;line-height:24px}
& .t-cap{font-size:12px;line-height:20px}
}
@media (min-width:768px){& .hd{display:none!important}}`;

const CARD_CSS = `
& .pc{display:flex;flex-direction:column;gap:8px;text-decoration:none;color:#181818;min-width:0}
& .pc-img{position:relative;display:block;aspect-ratio:285/380;background:#f8f6f4;overflow:hidden}
& .pc-img img{width:100%;height:100%;object-fit:cover}
& .pc-bd{position:absolute;left:8px;bottom:8px;display:flex;flex-wrap:wrap;gap:4px}
& .bd{font-size:12px;line-height:18px;padding:2px 8px;border-radius:4px;background:#fff;border:1px solid #e5e5e5;color:#181818}
& .bd-brand{background:#daaa00;border-color:#daaa00;color:#101010}
& .bd-success{background:#194e31;border-color:#194e31;color:#fff}
& .pc-n{font-size:16px;line-height:28px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
& .pc-d{font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#181818}
& .pc-p{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
& .pc-p b{font-size:16px;line-height:28px;font-weight:500}
& .pc-p s{font-size:14px;line-height:24px;color:#444}
& .pc-p em{font-size:14px;line-height:24px;color:#8e030f;font-style:normal}
& .pc-txt{display:flex;flex-direction:column}
@media (max-width:767px){& .pc-d{font-size:14px;line-height:24px}}`;

const BLOCK_CSS = {
  "section-heading": `
& .sh{display:flex;align-items:flex-end;justify-content:space-between;gap:40px}
& .sh-m{display:flex;flex-direction:column;gap:8px;min-width:0}
& .sh-s{max-width:480px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}
& .sh.c{flex-direction:column;align-items:center;text-align:center;gap:16px}
& .sh.c .sh-s{align-items:center;max-width:720px}
& .sh .t-sub{color:#444}& .dk .sh .t-sub{color:#fff}
@media (max-width:767px){& .sh{flex-direction:column;align-items:flex-start;gap:16px}& .sh.c{align-items:center}}`,
  "hero-banner": `
& .hero{position:relative;aspect-ratio:1920/744;min-height:480px;overflow:hidden;color:#fff;display:flex;align-items:center}
& .hero>img,& .hero>.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
& .hero-ov{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,var(--o)) 0%,rgba(0,0,0,0) 75%)}
& .hero.c .hero-ov{background:rgba(0,0,0,calc(var(--o) * .7))}
& .ov-light{--o:.3}& .ov-medium{--o:.5}& .ov-strong{--o:.7}
& .hero-c{position:relative;padding:80px;max-width:760px;display:flex;flex-direction:column;gap:16px;align-items:flex-start}
& .hero.c{justify-content:center;text-align:center}& .hero.c .hero-c{align-items:center;margin:0 auto}
& .hero h2{color:#fff}& .hero .btn{margin-top:16px}
@media (max-width:767px){& .hero{aspect-ratio:375/560;min-height:0;align-items:flex-end}& .hero-ov{background:linear-gradient(0deg,rgba(0,0,0,var(--o)) 0%,rgba(0,0,0,0) 80%)}& .hero-c{padding:24px 16px 40px;gap:12px}& .hero .btn{margin-top:8px}}`,
  "campaign-highlight": `
& .camp{position:relative;max-width:1280px;margin:0 auto;aspect-ratio:1280/810;overflow:hidden;color:#fff;display:flex;align-items:flex-end}
& .fb .camp{max-width:none}
& .camp>img,& .camp>.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
& .camp-ov{position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,0) 60%)}
& .camp-c{position:relative;padding:80px;display:flex;flex-direction:column;gap:16px;align-items:flex-start;max-width:900px}
& .camp h2{color:#fff}& .camp .lnk{color:#fff}
@media (max-width:767px){& .camp{aspect-ratio:375/810}& .camp-c{padding:24px 16px 48px;gap:12px}}`,
  "image-tiles": `
& .tiles{display:grid;gap:12px}
& .tile{position:relative;display:block;overflow:hidden;color:#fff;text-decoration:none;background:#181818}
& .tile>img,& .tile>.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
& .tile-ov{position:absolute;inset:0;background:rgba(0,0,0,.2)}
& .tile-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:24px}
& .tile h3{color:#fff}
@media (max-width:767px){& .tiles{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;margin:0 -16px;padding:0 16px}& .tiles::-webkit-scrollbar{display:none}& .fb .tiles{margin:0;padding:0}& .tile{flex:0 0 72%;max-width:280px;scroll-snap-align:start;height:420px!important}}`,
  "modular-cards": `
& .mc{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
& .mc-c{position:relative;aspect-ratio:1/1;overflow:hidden;display:flex;align-items:flex-end;color:#fff}
& .mc-c>img,& .mc-c>.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
& .mc-ov{position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.5) 0%,rgba(0,0,0,0) 55%)}
& .mc-t{position:relative;padding:80px;display:flex;flex-direction:column;gap:16px;align-items:flex-start;max-width:720px}
& .mc-c.solid{align-items:center}
& .mc-c h3{color:inherit}
& .mc-c.sand,& .mc-c.beige{color:#181818}& .mc-c.sand h3,& .mc-c.beige h3{color:#000}
@media (max-width:767px){& .mc{grid-template-columns:1fr}& .mc-t{padding:24px 16px 32px;gap:12px}}`,
  "zig-zag": `
& .zz{display:flex;flex-direction:column;gap:48px}
& .zz-r{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:center;gap:0}
& .zz-i{aspect-ratio:1/1;overflow:hidden;background:#f8f6f4}
& .zz-i img{width:100%;height:100%;object-fit:cover}
& .zz-t{padding:0 80px;display:flex;flex-direction:column;gap:16px;align-items:flex-start;max-width:720px}
& .zz-r.rv .zz-i{order:2}
& .zz-t .t-sub{color:#444}& .dk .zz-t .t-sub{color:#fff}
@media (max-width:767px){& .zz{gap:32px}& .zz-r{grid-template-columns:1fr}& .zz-r.rv .zz-i{order:0}& .zz-t{padding:24px 0 0;gap:12px}}`,
  "text-block": `
& .tb{margin:0 auto;display:flex;flex-direction:column;gap:24px}
& .tb.c{text-align:center}
& .rt p+p,& .rt p+ul,& .rt ul+p,& .rt p+ol,& .rt ol+p{margin-top:16px}
& .rt ul,& .rt ol{padding-left:24px}
& .tb.c .rt ul,& .tb.c .rt ol{list-style-position:inside;padding-left:0}
& .rt a{text-decoration:underline;text-underline-offset:3px}
& .rt strong,& .rt b{font-weight:600}
@media (max-width:767px){& .tb{gap:16px}}`,
  "cta-section": `
& .cta{max-width:720px;margin:0 auto;text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px}
& .cta .btn{margin-top:16px}`,
  "category-tiles": `
& .cat{display:grid;gap:12px}
& .cat-i{display:flex;flex-direction:column;gap:12px;text-decoration:none;color:inherit;min-width:0}
& .cat-im{display:block;aspect-ratio:1/1;background:#f8f6f4;overflow:hidden}
& .cat-im img{width:100%;height:100%;object-fit:cover}
& .cat-l{font-size:16px;line-height:28px;font-weight:500}
& .cat.sc{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}& .cat.sc::-webkit-scrollbar{display:none}
& .cat.sc .cat-i{flex:0 0 240px;scroll-snap-align:start}
@media (max-width:767px){& .cat{grid-template-columns:repeat(2,minmax(0,1fr))!important}& .cat.sc .cat-i{flex-basis:140px}}`,
  benefits: `
& .bn{display:grid;gap:32px;text-align:center}
& .bn-i{display:flex;flex-direction:column;align-items:center;gap:8px}
& .bn-i svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;margin-bottom:8px}
& .bn-i .t-b2{color:#444}& .dk .bn-i .t-b2{color:#fff}
@media (max-width:767px){& .bn{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:24px 12px}}`,
  "product-grid": `
& .pg-h{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;max-width:1176px;margin:0 auto 32px}
& .pg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:32px 12px;max-width:1176px;margin:0 auto}
& .pg-va{max-width:1176px;margin:32px auto 0;text-align:center}
@media (max-width:767px){& .pg{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 12px}& .pg-h{margin-bottom:24px}}`,
  "product-carousel": `
& .car-h{margin-bottom:32px}
& .car-w{position:relative}
& .car{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;scroll-padding-left:0}
& .car::-webkit-scrollbar{display:none}
& .car>.pc{flex:0 0 285px;scroll-snap-align:start}
& .arr{position:absolute;top:calc(50% - 60px);width:42px;height:42px;border-radius:50%;background:#aeaeae;border:0;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
& .arr svg{width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2}
& .arr-l{left:32px}& .arr-r{right:32px}
@media (max-width:767px){& .car>.pc{flex-basis:160px}& .car-h{margin-bottom:24px}& .arr-l{left:16px}& .arr-r{right:16px}}`,
  spacer: "",
};

// ---------------------------------------------------------------------------- render
const img = (im, { w, h, cls = "", eager = false, preview }) => {
  if (!im?.src || !isHttpsUrl(im.src)) return preview ? `<div class="ph ${cls}">${esc(im?.description || im?.alt || "Imagem")}${im?.src ? "<br>(URL tem de ser https)" : ""}</div>` : "";
  return `<img${cls ? ` class="${cls}"` : ""} src="${esc(im.src)}" alt="${esc(im.alt)}" width="${w}" height="${h}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
};
const hrefOf = (u, market) => normalizeUrl(typeof u === "string" ? u : u?.url, market).url;
const button = (cta, cls, market, arrow = false) => {
  if (!cta?.label) return "";
  const href = hrefOf(cta.url, market);
  return href ? `<a class="${cls}" href="${esc(href)}">${esc(cta.label)}${arrow ? " →" : ""}</a>` : `<span class="${cls}">${esc(cta.label)}${arrow ? " →" : ""}</span>`;
};
const badgeHtml = (b) => `<span class="bd${b.tone === "brand" ? " bd-brand" : b.tone === "success" ? " bd-success" : ""}">${esc(b.label)}</span>`;

export function productCard(p, market = "pt", showBadges = true) {
  const href = isHttpsUrl(p.url) ? p.url : "";
  const d = discount(p.price, p.listPrice);
  const tag = href ? "a" : "div";
  const attrs = `class="pc"${href ? ` href="${esc(href)}"` : ""} data-item-id="${esc(p.id)}" data-item-name="${esc(p.name)}" data-item-price="${(Number(p.price) || 0).toFixed(2)}"`;
  return `<${tag} ${attrs}><span class="pc-img">${isHttpsUrl(p.image) ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" width="285" height="380" loading="lazy" decoding="async">` : ""}${showBadges && p.badges?.length ? `<span class="pc-bd">${p.badges.slice(0, 2).map(badgeHtml).join("")}</span>` : ""}</span>`
    + `<span class="pc-txt"><span class="pc-n">${esc(p.name)}</span>${p.description ? `<span class="pc-d">${esc(p.description)}</span>` : ""}</span>`
    + `<span class="pc-p"><b>${esc(money(p.price, market))}</b>${p.listPrice && d > 0 ? `<s>${esc(money(p.listPrice, market))}</s><em>-${d}%</em>` : ""}</span></${tag}>`;
}

export const visibleProducts = (b, products = {}) => (products[b.id] || []).filter((p) => p && !p.missing && !p.oos).slice(0, b.props.limit || 8);

function renderBlockInner(b, ctx) {
  const P = b.props, { market, preview } = ctx;
  const items = b.items || [];
  switch (b.type) {
    case "section-heading": {
      const side = P.text || P.link?.label ? `<div class="sh-s">${P.text ? `<p class="t-b1">${esc(P.text)}</p>` : ""}${button(P.link, "lnk", market)}</div>` : "";
      return `<div class="sh${P.align === "center" ? " c" : ""}"><div class="sh-m">${P.eyebrow ? `<p class="t-sub">${esc(P.eyebrow)}</p>` : ""}<h2 class="t-d3">${esc(P.title)}</h2></div>${side}</div>`;
    }
    case "hero-banner":
      return `<div class="hero${P.textPosition === "center" ? " c" : ""} ov-${P.overlayStrength}">${img(P.image, { w: 1920, h: 744, eager: ctx.index === 0, preview })}<span class="hero-ov"></span><div class="hero-c"><h2 class="t-d2">${esc(P.title)}</h2>${P.subtitle ? `<p class="t-b1">${esc(P.subtitle)}</p>` : ""}${button(P.cta, "btn btn-i", market)}</div></div>`;
    case "campaign-highlight":
      return `<div class="camp">${img(P.image, { w: 1280, h: 810, preview })}<span class="camp-ov"></span><div class="camp-c">${P.kicker ? `<p class="t-cap">${esc(P.kicker)}</p>` : ""}<h2 class="t-d1">${esc(P.title)}</h2>${button(P.link, "lnk", market, true)}</div></div>`;
    case "image-tiles":
      return `<div class="tiles">${items.map((it) => {
        const href = hrefOf(it.url, market), tag = href ? "a" : "div";
        return `<${tag} class="tile"${href ? ` href="${esc(href)}"` : ""}>${img(it.image, { w: 640, h: P.height, preview })}<span class="tile-ov"></span><span class="tile-c">${it.title ? `<h3 class="t-h4">${esc(it.title)}</h3>` : ""}${it.linkLabel ? `<span class="lnk">${esc(it.linkLabel)}</span>` : ""}</span></${tag}>`;
      }).join("")}</div>`;
    case "modular-cards":
      return `<div class="mc">${items.map((it) => it.variant === "solid"
        ? `<div class="mc-c solid ${it.bg} bg-${it.bg}${BACKGROUNDS[it.bg]?.dark ? " dk" : ""}"><div class="mc-t">${it.title ? `<h3 class="t-d3">${esc(it.title)}</h3>` : ""}${it.text ? `<p class="t-b1">${esc(it.text)}</p>` : ""}${button(it.cta, "lnk", market, true)}</div></div>`
        : `<div class="mc-c">${img(it.image, { w: 960, h: 960, preview })}<span class="mc-ov"></span><div class="mc-t">${it.title ? `<h3 class="t-d3">${esc(it.title)}</h3>` : ""}${button(it.cta, "btn btn-i", market)}</div></div>`).join("")}</div>`;
    case "zig-zag":
      return `<div class="zz">${items.map((it, i) => `<div class="zz-r${(i % 2 === 1) !== (P.startSide === "right") ? " rv" : ""}"><div class="zz-i">${img(it.image, { w: 800, h: 800, preview })}</div><div class="zz-t">${it.eyebrow ? `<p class="t-sub">${esc(it.eyebrow)}</p>` : ""}${it.title ? `<h3 class="t-d3">${esc(it.title)}</h3>` : ""}${it.text ? `<p class="t-b1">${esc(it.text)}</p>` : ""}${button(it.cta, "lnk", market, true)}</div></div>`).join("")}</div>`;
    case "text-block":
      return `<div class="tb mw${P.maxWidth}${P.align === "center" ? " c" : ""}">${P.title ? `<h2 class="t-d3">${esc(P.title)}</h2>` : ""}<div class="rt t-b1">${sanitizeRich(P.html, market).html}</div></div>`;
    case "cta-section":
      return `<div class="cta"><h2 class="t-d3">${esc(P.title)}</h2>${P.text ? `<p class="t-b1">${esc(P.text)}</p>` : ""}${button(P.cta, "btn btn-p", market)}</div>`;
    case "category-tiles":
      return `<div class="cat${P.layout === "scroll" ? " sc" : ""}">${items.map((it) => {
        const href = hrefOf(it.url, market), tag = href ? "a" : "div";
        return `<${tag} class="cat-i"${href ? ` href="${esc(href)}"` : ""}><span class="cat-im">${img(it.image, { w: 400, h: 400, preview })}</span><span class="cat-l">${esc(it.label)}</span></${tag}>`;
      }).join("")}</div>`;
    case "benefits":
      return `<div class="bn">${items.map((it) => `<div class="bn-i"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[it.icon] || ""}</svg>${it.title ? `<h3 class="t-h6">${esc(it.title)}</h3>` : ""}${it.text ? `<p class="t-b2">${esc(it.text)}</p>` : ""}</div>`).join("")}</div>`;
    case "product-grid": {
      const list = visibleProducts(b, ctx.products);
      const head = P.title ? `<div class="pg-h"><h2 class="t-d3">${esc(P.title)}</h2>${button(P.viewAll, "lnk", market)}</div>` : "";
      const foot = !P.title && P.viewAll?.label ? `<div class="pg-va">${button(P.viewAll, "btn btn-s", market)}</div>` : "";
      return `${head}<div class="pg">${list.map((p) => productCard(p, market, P.showBadges)).join("") || (preview ? `<div class="ph" style="grid-column:1/-1;min-height:120px">Sem produtos — escolhe produtos ou ajusta a regra</div>` : "")}</div>${foot}`;
    }
    case "product-carousel": {
      const list = visibleProducts(b, ctx.products);
      const arrows = ctx.caps?.js && list.length > 4 ? `<button type="button" class="arr arr-l hm" aria-label="Anterior" data-hpb-dir="-1"><svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg></button><button type="button" class="arr arr-r hm" aria-label="Seguinte" data-hpb-dir="1"><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg></button>` : "";
      return `${P.title ? `<div class="car-h"><h2 class="t-d3">${esc(P.title)}</h2></div>` : ""}<div class="car-w"><div class="car">${list.map((p) => productCard(p, market, P.showBadges)).join("") || (preview ? `<div class="ph" style="min-height:120px">Sem produtos — escolhe produtos ou ajusta a regra</div>` : "")}</div>${arrows}</div>`;
    }
    case "spacer":
      return "";
    default:
      return "";
  }
}

// per-block rules that depend on props (no inline styles: they may be stripped by Page Designer)
function blockCss(b) {
  const s = `& .k-${b.id}`;
  const P = b.props, out = [];
  if (b.type === "image-tiles") out.push(`${s} .tiles{grid-template-columns:repeat(${Math.max(1, Math.min(P.columns, (b.items || []).length || 1))},minmax(0,1fr))}${s} .tile{height:${P.height}px}`);
  if (b.type === "category-tiles" && P.layout !== "scroll") out.push(`${s} .cat{grid-template-columns:repeat(${Math.max(1, Math.min(6, (b.items || []).length || 1))},minmax(0,1fr))}`);
  if (b.type === "benefits") out.push(`${s} .bn{grid-template-columns:repeat(${Math.max(1, (b.items || []).length)},minmax(0,1fr))}`);
  if (b.type === "spacer") out.push(`${s}{height:${P.size}px}@media (max-width:767px){${s}{height:${MOBILE_SPACE[P.size] ?? P.size}px}}`);
  if (P.background === "image" && isHttpsUrl(P.backgroundImage?.src)) out.push(`${s}{background-image:url("${P.backgroundImage.src.replace(/["\\()]/g, encodeURIComponent).replace(/&/g, "\\26 ")}")}`); // "&" is the root placeholder → CSS escape
  return out.join("");
}

function wrapClasses(b) {
  const P = b.props, cls = ["hpb-b", `k-${b.id}`, `bg-${P.background}`];
  if (BACKGROUNDS[P.background]?.dark) cls.push("dk");
  if (P.fullBleed) cls.push("fb");
  if (P.hideOn === "mobile") cls.push("hm");
  if (P.hideOn === "desktop") cls.push("hd");
  cls.push(`pt${P.paddingTop}`, `pb${P.paddingBottom}`);
  return cls.join(" ");
}

function spacingCss(blocks) {
  const used = new Set();
  for (const b of blocks) { used.add(`t${b.props.paddingTop}`); used.add(`b${b.props.paddingBottom}`); }
  const d = [], m = [];
  for (const u of used) {
    const side = u[0] === "t" ? "top" : "bottom", n = Number(u.slice(1));
    d.push(`& .p${u}{padding-${side}:${n}px}`);
    if (MOBILE_SPACE[n] != null) m.push(`& .p${u}{padding-${side}:${MOBILE_SPACE[n]}px}`);
  }
  return d.join("") + (m.length ? `@media (max-width:767px){${m.join("")}}` : "");
}

const minCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, "").replace(/\s*([{};,>])\s*/g, "$1").replace(/;}/g, "}").trim();

// Figma tokens as CSS custom properties on the element root; every colour in the block CSS is a var()
export const CSS_VARS = {
  "--hpb-font": TOKENS.font, "--hpb-text": "#181818", "--hpb-headline": "#000000", "--hpb-secondary": "#444444", "--hpb-disabled": "#757575",
  "--hpb-arrow": "#aeaeae", "--hpb-border": "#e5e5e5", "--hpb-surface": "#f3f3f3", "--hpb-white": "#ffffff", "--hpb-near-black": "#101010",
  "--hpb-beige": "#f3f1ea", "--hpb-card-bg": "#f8f6f4", "--hpb-block": "#dfdbd2", "--hpb-brand": "#daaa00", "--hpb-accent": "#fcaf17",
  "--hpb-brown": "#583d3e", "--hpb-green": "#279989", "--hpb-success": "#194e31", "--hpb-danger": "#8e030f", "--hpb-info": "#0f69ae", "--hpb-warning": "#8c4b02",
  "--hpb-shadow": TOKENS.shadow, "--hpb-gutter": "40px",
};
const HEX_TO_VAR = Object.fromEntries(Object.entries(CSS_VARS).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v)).map(([k, v]) => [v.toLowerCase(), k]));
const longHex = (h) => (h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h).toLowerCase();
function tokenVars(css) {
  const body = css.replace(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, (h) => (HEX_TO_VAR[longHex(h)] ? `var(${HEX_TO_VAR[longHex(h)]})` : h))
    .replace(/font-family:Gilroy,"Helvetica Neue",Arial,sans-serif/, "font-family:var(--hpb-font)");
  return `&{${Object.entries(CSS_VARS).map(([k, v]) => `${k}:${v}`).join(";")}}${body}`;
}

export const safeElementId = (id) => (slugify(id) || "elemento").slice(0, 40);

/**
 * renderElement(element, { products, preview, caps })
 *  products: { [blockId]: hydrated product cards } (from /api/page-builder/hydrate or resolve at export)
 *  preview:  true = placeholders for missing images/products (editor only; never exported)
 *  caps.js:  true only if the Page Designer capability test showed that <script> runs
 */
export function renderElement(el, { products = {}, preview = false, caps = { js: false } } = {}) {
  const market = MARKET_PATH[el.market] ? el.market : "pt";
  const eid = safeElementId(el.id || el.name);
  const root = `#hpb-${eid}`;
  const blocks = (el.blocks || []).filter((b) => BLOCKS[b.type]);
  const types = [...new Set(blocks.map((b) => b.type))];
  const needsCard = types.some((t) => PRODUCT_BLOCKS.includes(t));
  const mw = [...new Set(blocks.filter((b) => b.type === "text-block").map((b) => b.props.maxWidth))].map((w) => `& .mw${w}{max-width:${w}px}`).join("");
  const css = tokenVars(minCss([BASE_CSS, needsCard ? CARD_CSS : "", ...types.map((t) => BLOCK_CSS[t] || ""), mw, spacingCss(blocks), ...blocks.map(blockCss)].join("\n"))).replaceAll("&", root);
  const body = blocks.map((b, i) => {
    const inner = renderBlockInner(b, { market, preview, products, caps, index: i });
    const anchor = b.props.anchor ? ` id="${esc(b.props.anchor)}"` : "";
    return `<div class="${wrapClasses(b)}"${anchor} data-hpb-block="${esc(b.type)}" data-hpb-index="${i}"><div class="hpb-in">${inner}</div></div>`;
  }).join("");
  const script = caps?.js && blocks.some((b) => b.type === "product-carousel")
    ? `<script>(function(r){r.querySelectorAll('[data-hpb-dir]').forEach(function(a){a.addEventListener('click',function(){var c=a.parentNode.querySelector('.car');c.scrollBy({left:a.getAttribute('data-hpb-dir')*c.clientWidth*.8,behavior:'smooth'})})})})(document.getElementById('hpb-${eid}'))</script>`
    : "";
  const html = `<div class="hpb" id="hpb-${eid}" data-hpb-version="${VERSION}" data-hpb-element="${esc(eid)}"><style>${css}</style>${body}${script}</div>`;
  return { html, css, bytes: new TextEncoder().encode(html).length, elementId: eid };
}

// ---------------------------------------------------------------------------- export validation
const FIELD_PATH = (b, i, k) => `Bloco ${i + 1} (${BLOCKS[b.type]?.label || b.type})${k ? ` · ${k}` : ""}`;
/**
 * checkElement(element, products, html?) → { ok, errors[], warnings[] }
 * products = hydrated map { [blockId]: [...] } with missing / oos flags (manual lists keep them)
 */
export function checkElement(el, products = {}, html = "", caps = { js: false }) {
  const errors = [], warnings = [];
  const market = el.market;
  if (!el.blocks?.length) errors.push("O elemento não tem blocos.");
  const checkImg = (im, where, required = true) => {
    if (!im?.src) { if (required) errors.push(`${where}: falta a imagem`); return; }
    if (!isHttpsUrl(im.src)) errors.push(`${where}: a imagem tem de estar em https://`);
    if (!String(im.alt || "").trim()) errors.push(`${where}: falta o texto alternativo (alt)`);
  };
  const checkLink = (l, where, required = false) => {
    const has = typeof l === "string" ? l : l?.url;
    if (l && typeof l === "object" && "label" in l && !l.label && !has) return; // optional link left empty
    if (!has) { if (required || l?.label) errors.push(`${where}: link vazio`); return; }
    const n = normalizeUrl(has, market);
    if (n.error) errors.push(`${where}: ${n.error}`);
    else if (n.warn) warnings.push(`${where}: ${n.warn}`);
    if (l?.label === "" && has) warnings.push(`${where}: link sem texto`);
  };
  (el.blocks || []).forEach((b, i) => {
    const d = BLOCKS[b.type], P = b.props || {};
    if (!d) return errors.push(`Bloco ${i + 1}: tipo “${b.type}” desconhecido`);
    for (const [k, f] of Object.entries(d.props)) {
      const where = FIELD_PATH(b, i, f.label);
      if (f.kind === "text" && f.required && !String(P[k] || "").trim()) errors.push(`${where}: obrigatório`);
      if (f.kind === "image") checkImg(P[k], where, f.required);
      if (f.kind === "link") checkLink(P[k], where);
      if (f.kind === "rich") { const r = sanitizeRich(P[k], market); if (r.removed.length) warnings.push(`${where}: removido ${r.removed.join(", ")}`); }
    }
    if (P.background === "image") checkImg(P.backgroundImage, FIELD_PATH(b, i, "imagem de fundo"));
    if (d.items) {
      if ((b.items || []).length < (d.items.min || 0)) errors.push(`${FIELD_PATH(b, i)}: precisa de pelo menos ${d.items.min} ${d.items.label.toLowerCase()}(s)`);
      (b.items || []).forEach((it, j) => {
        for (const [k, f] of Object.entries(d.items.fields)) {
          const where = `${FIELD_PATH(b, i)} · ${d.items.label} ${j + 1} · ${f.label}`;
          if (f.kind === "image") checkImg(it[k], where, f.required !== false && !(b.type === "modular-cards" && it.variant === "solid"));
          if (f.kind === "link") checkLink(it[k], where, f.required);
        }
      });
    }
    if (PRODUCT_BLOCKS.includes(b.type)) {
      const list = products[b.id] || [];
      const miss = list.filter((p) => p.missing).map((p) => p.id), oos = list.filter((p) => p.oos).map((p) => p.id);
      if (miss.length) errors.push(`${FIELD_PATH(b, i)}: produtos fora do feed ${miss.join(", ")}`);
      if (oos.length) warnings.push(`${FIELD_PATH(b, i)}: sem stock (não aparecem) ${oos.join(", ")}`);
      const vis = visibleProducts(b, products).length;
      if (!vis) errors.push(`${FIELD_PATH(b, i)}: nenhum produto para mostrar`);
      else if (vis < (P.limit || 0) && P.productSource?.mode === "rule") warnings.push(`${FIELD_PATH(b, i)}: só ${vis} de ${P.limit} produtos correspondem à regra`);
    }
  });
  if (html) {
    if ((html.match(/<h1[\s>]/gi) || []).length) errors.push("O HTML tem um <h1> (a página já tem um).");
    if (!caps?.js && /<script/i.test(html)) errors.push("O HTML tem <script> (o teste de capacidades ainda não confirmou que corre).");
    const bytes = new TextEncoder().encode(html).length;
    if (bytes > 100 * 1024) warnings.push(`HTML com ${(bytes / 1024).toFixed(0)} KB (acima de 100 KB)`);
  }
  return { ok: !errors.length, errors, warnings };
}

// product ids + price/stock at generation (the "desatualizado" flag compares against this)
export function productSnapshot(products = {}) {
  const snap = {};
  for (const list of Object.values(products)) for (const p of list || []) if (p && !p.missing) snap[p.id] = { price: p.price, listPrice: p.listPrice ?? null, inStock: p.inStock !== false && !p.oos };
  return snap;
}

// ---------------------------------------------------------------------------- diff (refine → "3 alterações")
export function diffElements(a, b) {
  const changes = [];
  const label = (bl) => `${BLOCKS[bl.type]?.label || bl.type}`;
  const A = new Map((a?.blocks || []).map((x, i) => [x.id, { x, i }])), B = new Map((b?.blocks || []).map((x, i) => [x.id, { x, i }]));
  if ((a?.name || "") !== (b?.name || "")) changes.push(`Nome: “${a?.name || ""}” → “${b?.name || ""}”`);
  for (const [id, { x, i }] of A) if (!B.has(id)) changes.push(`Removido: ${label(x)} (posição ${i + 1})`);
  for (const [id, { x, i }] of B) {
    const old = A.get(id);
    if (!old) { changes.push(`Novo bloco: ${label(x)} (posição ${i + 1})`); continue; }
    if (old.x.type !== x.type) { changes.push(`Bloco ${i + 1}: ${label(old.x)} → ${label(x)}`); continue; }
    const fields = [];
    for (const k of new Set([...Object.keys(old.x.props || {}), ...Object.keys(x.props || {})])) if (JSON.stringify(old.x.props?.[k]) !== JSON.stringify(x.props?.[k])) fields.push((BLOCKS[x.type].props[k] || COMMON[k])?.label || k);
    if (JSON.stringify(old.x.items || []) !== JSON.stringify(x.items || [])) fields.push(`${BLOCKS[x.type].items?.label || "Itens"}: ${(old.x.items || []).length} → ${(x.items || []).length}`);
    if (fields.length) changes.push(`${label(x)} (posição ${i + 1}): ${fields.join(", ")}`);
  }
  const orderA = (a?.blocks || []).map((x) => x.id).filter((id) => B.has(id)), orderB = (b?.blocks || []).map((x) => x.id).filter((id) => A.has(id));
  if (orderA.join() !== orderB.join()) changes.push("Ordem dos blocos alterada");
  return changes;
}

// ---------------------------------------------------------------------------- LLM-facing library description
export function libraryForPrompt() {
  const fieldLine = (k, f) => {
    if (f.kind === "enum") return `${k} (${f.options.map(([v]) => JSON.stringify(v)).join("|")})`;
    if (f.kind === "int") return `${k} (${f.min}–${f.max})`;
    if (f.kind === "products") return `${k} (productSource)`;
    return `${k}${f.required ? "*" : ""} (${f.kind})`;
  };
  return BLOCK_TYPES.map((t) => {
    const d = BLOCKS[t];
    const props = Object.entries(d.props).map(([k, f]) => fieldLine(k, f)).join(", ") || "—";
    const items = d.items ? ` · items[${d.items.min}–${d.items.max}]: ${Object.entries(d.items.fields).map(([k, f]) => fieldLine(k, f)).join(", ")}` : "";
    return `- ${t} — ${d.llm} Props: ${props}${items}`;
  }).join("\n");
}

// ---------------------------------------------------------------------------- preview page (editor, gallery, export panel)
// Gilroy is loaded here ONLY for the preview — the storefront already loads it, the exported HTML never does.
const FONT_FILES = [["Light", 300], ["Regular", 400], ["Medium", 500], ["SemiBold", 600], ["Bold", 700]];
export const PREVIEW_FONTS = FONT_FILES.map(([n, w]) => `@font-face{font-family:Gilroy;font-weight:${w};font-display:swap;src:url("${HOST}/mobify/bundle/106/static/fonts/gilroy/Gilroy${n}.woff2") format("woff2")}`).join("");
export function previewDocument(html, { head = "", foot = "", title = "Pré-visualização" } = {}) {
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${PREVIEW_FONTS}html,body{margin:0;background:#fff}</style>${head}</head><body>${html}${foot}</body></html>`;
}

// sample feed products (real hôma products) for the block gallery and export-test
export const SAMPLE_PRODUCTS = [
  ["474166", "Quadro decorativo mulher MONA 58x78cm", "Quadro decorativo em madeira", 30, null, "dw9f3b5abf/images/large/474166_product_1.jpg", "quadro-decorativo-mulher-mona-58x78cm-474166", []],
  ["474171", "Vaso suspenso com planta artificial MONA 26cm", "Vaso suspenso com planta artificial", 15, null, "dw852e9fd4/images/large/474171_1.jpg", "vaso-suspenso-com-planta-artificial-mona-26cm-474171", [{ label: "Exclusivo online", tone: "brand" }]],
  ["473088", "Almofada SAVOY 35x50cm", "Almofada multicolor em algodão", 15, 20, "dwef6476c6/images/large/473088_ALMOFADA35X50CMMULTICOLORSAVOY1.jpg", "almofada-savoy-35x50cm-473088", [{ label: "Novo" }]],
  ["474179", "Centro de mesa MONA 23cm", "Centro de mesa decorativo", 8, null, "dw2ddc35ad/images/large/474179_Product_1.jpg", "centro-de-mesa-mona-23cm-474179", []],
  ["474182", "Cesto CYRIELLE 29x27cm", "Cesto em fibra natural", 12, null, "dw895e47b8/images/large/474183.jpg", "cesto-cyrielle-29x27cm-474182", [{ label: "Sustentável", tone: "success" }]],
  ["453245", "Tapete TOUL natural 120x160cm", "Tapete natural 120x160cm", 59, null, "dw7a2f659f/images/large/453245.JPG", "tapete-toul-natural-120x160cm-453245", []],
].map(([id, name, description, price, listPrice, img, slug, badges]) => ({
  id, name, description, price, listPrice, badges, inStock: true,
  image: `${HOST}/dw/image/v2/BFDH_PRD/on/demandware.static/-/Sites-homa-catalog/default/${img}?sw=570&q=80`,
  url: `${HOST}/pt/pt/${slug}.html`,
}));
