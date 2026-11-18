// Shop the Look — visual editor schema (shared by the editor, the API and the tests).
// Each field is an override of a CSS custom property of the widget (--hstl-s-<key>); the widget CSS
// carries the Figma defaults as var() fallbacks, so a module only stores what was changed.
// The hydrated config gets `vars` ({ "--hstl-s-…": "…" }) that the widget applies to its <section>.

const C = (classic, moodboard = classic) => ({ classic, moodboard });
const BOTH = ["classic", "moodboard"], CL = ["classic"], MB = ["moodboard"];

export const GROUPS = [
  ["colors", "Cores"],
  ["type", "Tipografia"],
  ["spacing", "Espaçamentos"],
  ["cards", "Cartões de produto"],
  ["image", "Imagem principal"],
];

// type: color | px | int | pct | ratio · dev: d (desktop) / t (tablet) / m (mobile) — shown side by side when they share `pair`
// lh: line-height / font-size ratio per layout (font sizes also set their line-height)
export const FIELDS = [
  // colours
  { k: "bg", group: "colors", label: "Fundo da secção", type: "color", def: C("#ffffff"), layouts: BOTH },
  { k: "text", group: "colors", label: "Texto", type: "color", def: C("#181818"), layouts: BOTH },
  { k: "headline", group: "colors", label: "Título", type: "color", def: C("#000000", "#101010"), layouts: BOTH },
  { k: "eyebrow", group: "colors", label: "Eyebrow", type: "color", def: C("#181818", "#757575"), layouts: BOTH },
  { k: "card-bg", group: "colors", label: "Fundo das imagens dos cartões", type: "color", def: C("#f8f6f4"), layouts: BOTH },
  { k: "danger", group: "colors", label: "Preço em promoção", type: "color", def: C("#8e030f"), layouts: BOTH },
  { k: "pin", group: "colors", label: "Pin ativo", type: "color", def: C("#181818"), layouts: BOTH },
  { k: "list-bg", group: "colors", label: "Fundo do carrossel", type: "color", def: C("#f3f1ea"), layouts: CL },
  { k: "btn-bg", group: "colors", label: "Botão principal", type: "color", def: C("#181818"), layouts: MB },
  { k: "btn-fg", group: "colors", label: "Texto do botão principal", type: "color", def: C("#ffffff"), layouts: MB },

  // typography
  { k: "title-d", pair: "title", dev: "d", group: "type", label: "Título", type: "px", min: 16, max: 80, def: C(34, 46), lh: C(52 / 34, 68 / 46), layouts: BOTH },
  { k: "title-m", pair: "title", dev: "m", group: "type", label: "Título", type: "px", min: 14, max: 56, def: C(22, 28), lh: C(32 / 22, 42 / 28), layouts: BOTH },
  { k: "eyebrow-d", pair: "eyebrow", dev: "d", group: "type", label: "Eyebrow", type: "px", min: 10, max: 32, def: C(18, 14), lh: C(28 / 18, 24 / 14), layouts: BOTH },
  { k: "eyebrow-m", pair: "eyebrow", dev: "m", group: "type", label: "Eyebrow", type: "px", min: 10, max: 28, def: C(14, 12), lh: C(24 / 14, 20 / 12), layouts: BOTH },
  { k: "name-d", pair: "name", dev: "d", group: "type", label: "Nome do produto", type: "px", min: 11, max: 24, def: C(16), lh: C(28 / 16), layouts: BOTH },
  { k: "name-m", pair: "name", dev: "m", group: "type", label: "Nome do produto", type: "px", min: 11, max: 22, def: C(16, 14), lh: C(28 / 16, 20 / 14), layouts: BOTH },

  // spacing
  { k: "pad-top-d", pair: "pad-top", dev: "d", group: "spacing", label: "Margem em cima", type: "px", min: 0, max: 240, def: C(0, 80), layouts: BOTH },
  { k: "pad-top-m", pair: "pad-top", dev: "m", group: "spacing", label: "Margem em cima", type: "px", min: 0, max: 160, def: C(0, 40), layouts: BOTH },
  { k: "pad-bottom-d", pair: "pad-bottom", dev: "d", group: "spacing", label: "Margem em baixo", type: "px", min: 0, max: 240, def: C(0, 80), layouts: BOTH },
  { k: "pad-bottom-m", pair: "pad-bottom", dev: "m", group: "spacing", label: "Margem em baixo", type: "px", min: 0, max: 160, def: C(0, 40), layouts: BOTH },
  { k: "gutter-d", pair: "gutter", dev: "d", group: "spacing", label: "Margens laterais", type: "px", min: 0, max: 200, def: C(40), layouts: BOTH },
  { k: "gutter-m", pair: "gutter", dev: "m", group: "spacing", label: "Margens laterais", type: "px", min: 0, max: 48, def: C(16, 20), layouts: BOTH },
  { k: "head-gap-d", pair: "head-gap", dev: "d", group: "spacing", label: "Título → conteúdo", type: "px", min: 0, max: 120, def: C(32, 40), layouts: BOTH },
  { k: "head-gap-m", pair: "head-gap", dev: "m", group: "spacing", label: "Título → conteúdo", type: "px", min: 0, max: 80, def: C(32, 24), layouts: BOTH },
  { k: "body-gap-d", pair: "body-gap", dev: "d", group: "spacing", label: "Imagem ↔ produtos", type: "px", min: 0, max: 120, def: C(40), layouts: MB },
  { k: "body-gap-m", pair: "body-gap", dev: "m", group: "spacing", label: "Imagem ↔ produtos", type: "px", min: 0, max: 80, def: C(16), layouts: MB },
  { k: "list-pad-d", pair: "list-pad", dev: "d", group: "spacing", label: "Espaço à volta do carrossel", type: "px", min: 0, max: 200, def: C(118), layouts: CL },
  { k: "list-pad-m", pair: "list-pad", dev: "m", group: "spacing", label: "Espaço à volta do carrossel", type: "px", min: 0, max: 160, def: C(80), layouts: CL },
  { k: "grid-gap-x", pair: "grid-gap", dev: "d", group: "spacing", label: "Entre cartões na grelha (horizontal)", type: "px", min: 0, max: 120, def: C(48), layouts: MB },
  { k: "grid-gap-y", pair: "grid-gap", dev: "d", group: "spacing", label: "Entre cartões na grelha (vertical)", type: "px", min: 0, max: 120, def: C(32), layouts: MB },
  { k: "row-gap-d", pair: "row-gap", dev: "d", group: "spacing", label: { classic: "Entre cartões do carrossel", moodboard: "Entre cartões (tablet)" }, type: "px", min: 0, max: 64, def: C(12, 16), layouts: BOTH },
  { k: "row-gap-m", pair: "row-gap", dev: "m", group: "spacing", label: "Entre cartões", type: "px", min: 0, max: 48, def: C(12, 16), layouts: BOTH },

  // product cards
  { k: "card-ratio", group: "cards", label: "Proporção da imagem do cartão", type: "ratio", options: [["3/4", "3:4 (Figma 285×380)"], ["4/5", "4:5"], ["1/1", "1:1"], ["2/3", "2:3"]], def: C("3/4"), layouts: BOTH },
  { k: "card-w-d", pair: "card-w", dev: "d", group: "cards", label: "Largura do cartão", type: "px", min: 160, max: 480, def: C(285), layouts: CL },
  { k: "card-w-m", pair: "card-w", dev: "m", group: "cards", label: "Largura do cartão", type: "px", min: 120, max: 320, def: C(160), layouts: CL },
  { k: "grid-cols", group: "cards", label: "Colunas na grelha (desktop)", type: "int", min: 1, max: 4, def: C(2), layouts: MB },
  { k: "per-view-t", pair: "per-view", dev: "t", group: "cards", label: "Cartões por linha", type: "int", min: 2, max: 6, def: C(4), layouts: MB },
  { k: "per-view-m", pair: "per-view", dev: "m", group: "cards", label: "Cartões por linha", type: "int", min: 1, max: 3, def: C(2), layouts: MB },

  // main image
  { k: "stage-d", pair: "stage", dev: "d", group: "image", label: "Proporção da imagem", type: "ratio", options: [["1475/1080", "1475×1080 (Figma)"], ["16/9", "16:9"], ["3/2", "3:2"], ["4/3", "4:3"], ["1/1", "1:1"]], def: C("1475/1080"), layouts: CL },
  { k: "stage-m", pair: "stage", dev: "m", group: "image", label: "Proporção da imagem", type: "ratio", options: [["375/396", "375×396 (Figma)"], ["1/1", "1:1"], ["4/5", "4:5"], ["3/4", "3:4"], ["9/16", "9:16"]], def: C("375/396"), layouts: CL },
  { k: "block-w", group: "image", label: "Largura do Color Block", type: "pct", min: 15, max: 40, step: 0.5, def: C(23.18), layouts: CL },
  { k: "img-share", group: "image", label: "Largura da imagem no desktop (% da secção)", type: "pct", min: 30, max: 70, step: 1, def: C(50), layouts: MB },
  { k: "stage-t", group: "image", label: "Proporção da imagem (tablet e mobile)", type: "ratio", options: [["3/4", "3:4 (Figma)"], ["4/5", "4:5"], ["1/1", "1:1"], ["2/3", "2:3"], ["9/16", "9:16"]], def: C("3/4"), layouts: MB },
];

export const DEVICE_LABEL = { d: "Desktop", t: "Tablet", m: "Mobile" };
const BY_KEY = new Map(FIELDS.map((f) => [f.k, f]));
export const fieldsFor = (layout = "classic") => FIELDS.filter((f) => f.layouts.includes(layout));
export const labelOf = (f, layout) => (typeof f.label === "string" ? f.label : f.label[layout] || f.label.classic);
export const defaultOf = (f, layout) => f.def[layout] ?? f.def.classic;

function clean(f, v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (f.type === "color") return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v)) ? String(v).toLowerCase() : undefined;
  if (f.type === "ratio") return f.options.some(([o]) => o === v) ? v : undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const r = f.type === "pct" ? Math.round(n * 100) / 100 : Math.round(n);
  return Math.max(f.min, Math.min(f.max, r));
}

// keep only known, valid overrides that differ from the layout default
export function sanitizeStyle(style = {}, layout = "classic") {
  const out = {};
  if (!style || typeof style !== "object") return out;
  for (const [k, v] of Object.entries(style)) {
    const f = BY_KEY.get(k);
    if (!f) continue;
    const c = clean(f, v);
    if (c !== undefined && c !== defaultOf(f, layout)) out[k] = c;
  }
  return out;
}

// CSS custom properties for the widget (only overrides of fields used by the layout)
export function styleVars(style = {}, layout = "classic") {
  const vars = {};
  for (const [k, v] of Object.entries(sanitizeStyle(style, layout))) {
    const f = BY_KEY.get(k);
    if (!f.layouts.includes(layout)) continue;
    const name = `--hstl-s-${k}`;
    if (f.type === "px") {
      vars[name] = `${v}px`;
      if (f.lh) vars[`${name}-lh`] = `${Math.round(v * (f.lh[layout] ?? f.lh.classic))}px`;
    } else if (f.type === "pct" && k === "img-share") {
      vars["--hstl-s-img-fr"] = `${v}fr`; vars["--hstl-s-grid-fr"] = `${Math.round((100 - v) * 100) / 100}fr`;
    } else if (f.type === "pct") vars[name] = `${v}%`;
    else vars[name] = String(v);
  }
  return vars;
}
