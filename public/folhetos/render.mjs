// Folheto — static renderer (no JavaScript), shared by the editor (preview + export) and the tests.
// SFCC Page Designer "Raw HTML" does not run scripts, so the reader works with CSS only:
//   - hidden radio buttons hold the state (current spread, selected product, mobile product sheet, section filter)
//     and :has() rules in the block's own <style> show the matching parts;
//   - desktop: two pages side by side (cover alone), arrows + spread strip, side panel with the products of those
//     pages / the product picked on a "+"; mobile: one page per swipe (scroll-snap), "see the products of this page"
//     sheet, product sheet from a "+";
//   - below: every product of the flyer, filterable by section.
// No cart: every product leads to its PDP. Tracking: data-ff-list-* on the block, data-item-* only on the real
// product links (select_item), data-ff-pin on the product radios (opened from a "+").
// Layout follows the "Folheto Natal 2026" design (desktop Main, Mobile Leitor, Mobile Produtos), minus add to cart.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const safeId = (s) => String(s || "folheto").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "folheto";
const T = {
  "pt-PT": {
    page: "Página", pages: "páginas", products: "produtos", product: "produto", valid: (a, b) => `Válido de ${a} a ${b}`, validTo: (b) => `Válido até ${b}`,
    index: "Índice", seeAll: "Ver todos os produtos", inThese: "Nestas páginas", pickHint: "Clica num “+” no folheto ou escolhe aqui.", none: "Sem produtos nestas páginas.",
    onPage: "Na página", ref: "Ref.", inStock: "Em stock", low: "Últimas unidades", oos: "Esgotado", view: "Ver produto",
    allTitle: "Todos os produtos do folheto", all: "Todos", ofPage: (n) => `Produtos da página ${n}`, thisPage: "Esta página", whole: "Todo o folheto",
    next: "Página seguinte", viewPage: "Ver página", seeN: (n) => (n === 1 ? "Ver o produto desta página" : `Ver os ${n} produtos desta página`),
    swipe: "Desliza para mudar de página", prev: "Páginas anteriores", nextA: "Páginas seguintes", close: "Fechar", pagesOf: (a, n) => `Páginas ${a} de ${n}`, pageOf: (a, n) => `Página ${a} de ${n}`,
    open: (name) => `Ver ${name}`, list: "Folheto",
  },
  "es-ES": {
    page: "Página", pages: "páginas", products: "productos", product: "producto", valid: (a, b) => `Válido del ${a} al ${b}`, validTo: (b) => `Válido hasta el ${b}`,
    index: "Índice", seeAll: "Ver todos los productos", inThese: "En estas páginas", pickHint: "Haz clic en un “+” del folleto o elige aquí.", none: "Sin productos en estas páginas.",
    onPage: "En la página", ref: "Ref.", inStock: "En stock", low: "Últimas unidades", oos: "Agotado", view: "Ver producto",
    allTitle: "Todos los productos del folleto", all: "Todos", ofPage: (n) => `Productos de la página ${n}`, thisPage: "Esta página", whole: "Todo el folleto",
    next: "Página siguiente", viewPage: "Ver página", seeN: (n) => (n === 1 ? "Ver el producto de esta página" : `Ver los ${n} productos de esta página`),
    swipe: "Desliza para cambiar de página", prev: "Páginas anteriores", nextA: "Páginas siguientes", close: "Cerrar", pagesOf: (a, n) => `Páginas ${a} de ${n}`, pageOf: (a, n) => `Página ${a} de ${n}`,
    open: (name) => `Ver ${name}`, list: "Folleto",
  },
};
const dmy = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s.split("-").reverse().join("/") : "");

export const listIdOf = (cfg) => `fol_${safeId(cfg.id)}`;
export const listNameOf = (cfg) => `Folheto - ${String(cfg.name || cfg.id || "").slice(0, 80)}`;

// cover alone, then pairs: [1] [2,3] [4,5] …
export function spreadsOf(count) {
  const out = count ? [[1]] : [];
  for (let n = 2; n <= count; n += 2) out.push(n + 1 <= count ? [n, n + 1] : [n]);
  return out;
}

export function renderFolheto(cfg, { css = "", preview = false, imageFor = null } = {}) {
  const id = safeId(cfg.id), P = `hfol-${id}`, R = `#${P}`;
  const L = T[cfg.locale] || T["pt-PT"];
  const fmt = new Intl.NumberFormat(cfg.locale || "pt-PT", { style: "currency", currency: cfg.currency || "EUR" });
  const pages = cfg.pages || [];
  const N = pages.length;
  const products = cfg.products || {};
  const hotspots = cfg.hotspots || [];
  const ok = (sku) => sku && products[sku] && !products[sku].missing;

  // products in hotspot order (GA4 index), pages of each product, products of each page
  const order = [];
  const pagesOfSku = {};
  const onPage = Array.from({ length: N + 1 }, () => []);
  for (const h of hotspots) {
    if (!ok(h.sku) || h.page < 1 || h.page > N) continue;
    if (!order.includes(h.sku)) order.push(h.sku);
    (pagesOfSku[h.sku] ||= []).includes(h.page) || pagesOfSku[h.sku].push(h.page);
    onPage[h.page].includes(h.sku) || onPage[h.page].push(h.sku);
  }
  // uploaded list: products without a pin are listed too (below and in the mobile "whole flyer" sheet) when found and in stock
  const extra = (cfg.list || []).filter((sku, i, a) => a.indexOf(sku) === i && ok(sku) && !order.includes(sku) && products[sku].inStock !== false);
  const all = [...order, ...extra];
  const ix = (sku) => all.indexOf(sku) + 1;
  const pr = (sku) => `${P}-p${ix(sku)}`; // product radio id
  const spreads = spreadsOf(N);
  const spreadOfPage = {};
  spreads.forEach((sp, k) => sp.forEach((n) => (spreadOfPage[n] = k)));
  const label = (sp) => sp.join("–");

  // sections for the filter: the page's section (set in the editor) or the product category
  const secOf = (sku) => {
    const pg = pagesOfSku[sku]?.[0];
    const s = (pg && pages[pg - 1]?.section) || (products[sku].path || [])[1] || (products[sku].path || [])[0] || "";
    return String(s).trim();
  };
  const sections = [...new Set(all.map(secOf).filter(Boolean))];
  const secIx = (sku) => sections.indexOf(secOf(sku)) + 1;

  const track = (p) => {
    const path = Array.isArray(p.path) ? p.path : [];
    return ` data-item-id="${esc(p.id)}" data-item-name="${esc(p.name)}" data-item-price="${num(p.price).toFixed(2)}" data-item-index="${ix(p.id)}"${path.length ? ` data-item-cat="${esc(path.join(" > "))}"` : ""}`;
  };
  const price = (p, cls = "") => `<span class="hfol__price${cls}"><b>${p.price === null || p.price === undefined ? "" : esc(fmt.format(num(p.price)))}</b>${p.listPrice && p.listPrice > p.price ? `<s>${esc(fmt.format(p.listPrice))}</s>` : ""}</span>`;
  const stock = (p) => (p.inStock === false ? ["oos", L.oos] : p.low ? ["low", L.low] : ["ok", L.inStock]);
  const stockHtml = (p) => { const [k, t] = stock(p); return `<span class="hfol__stock hfol__stock--${k}">${esc(t)}</span>`; };
  const img = (src, alt = "", lazy = true) => (src ? `<img src="${esc(src)}" alt="${esc(alt)}"${lazy ? ` loading="lazy"` : ""} decoding="async">` : "");

  const rules = [];   // always
  const desk = [];    // @media (min-width:768px)
  const mob = [];     // @media (max-width:767px)

  // ------------------------------------------------------------------ state (hidden radios)
  const radios = [
    ...spreads.map((_, k) => `<input class="hfol__r" type="radio" name="${P}-s" id="${P}-s${k}"${k === 0 ? " checked" : ""} aria-hidden="true" tabindex="-1">`),
    `<input class="hfol__r" type="radio" name="${P}-p" id="${P}-pn" checked aria-hidden="true" tabindex="-1">`,
    ...order.map((sku) => `<input class="hfol__r hfol__rp" type="radio" name="${P}-p" id="${pr(sku)}" data-ff-pin="${esc(sku)}" aria-label="${esc(products[sku].name)}">`),
    `<input class="hfol__r" type="radio" name="${P}-m" id="${P}-mn" checked aria-hidden="true" tabindex="-1">`,
    ...pages.map((_, i) => (onPage[i + 1].length ? `<input class="hfol__r hfol__rm" type="radio" name="${P}-m" id="${P}-m${i + 1}" aria-hidden="true" tabindex="-1">` : "")),
    `<input class="hfol__r" type="radio" name="${P}-t" id="${P}-tp" checked aria-hidden="true" tabindex="-1"><input class="hfol__r hfol__rta" type="radio" name="${P}-t" id="${P}-ta" aria-hidden="true" tabindex="-1">`,
    `<input class="hfol__r hfol__rix" type="checkbox" id="${P}-ix" aria-hidden="true" tabindex="-1">`,
    ...(sections.length > 1 ? [`<input class="hfol__r" type="radio" name="${P}-f" id="${P}-f0" checked aria-hidden="true" tabindex="-1">`, ...sections.map((_, k) => `<input class="hfol__r" type="radio" name="${P}-f" id="${P}-f${k + 1}" aria-hidden="true" tabindex="-1">`)] : []),
  ].join("");

  // ------------------------------------------------------------------ pages (hotspots)
  const pageHtml = (n) => {
    const pg = pages[n - 1];
    const src = imageFor ? imageFor(n) : pg.src;
    rules.push(`${R} .hfol__pg--${n}{aspect-ratio:${num(pg.ratio, 0.7071)}}`);
    const spots = hotspots.map((h, k) => ({ h, k })).filter(({ h }) => h.page === n).map(({ h, k }) => {
      const cls = `hfol__h--${k}`;
      const area = h.type === "area";
      rules.push(`${R} .${cls}{left:${h.x}%;top:${h.y}%${area ? `;width:${h.w}%;height:${h.h}%` : ""}}`);
      if (!ok(h.sku)) {
        if (!preview) return ""; // never ship a hotspot without a product
        return `<span class="hfol__hs ${area ? "hfol__hs--area" : ""} ${cls} hfol__miss" title="${esc(h.sku ? `${h.sku}: não encontrado` : "sem produto")}"></span>`;
      }
      const p = products[h.sku];
      return `<label class="hfol__hs ${area ? "hfol__hs--area" : ""} ${cls} hfol__hs--${ix(h.sku)}" for="${pr(h.sku)}" title="${esc(p.name)}"><span class="hfol__sr">${esc(L.open(p.name))}</span></label>`;
    }).join("");
    const cnt = onPage[n].length;
    return `<div class="hfol__slide"><figure class="hfol__page hfol__pg--${n}" aria-label="${esc(L.pageOf(n, N))}">`
      + (src ? `<img class="hfol__img" src="${esc(src)}" alt="${esc(`${cfg.title || cfg.name || ""} — ${L.page.toLowerCase()} ${n}`)}"${n > 3 ? ` loading="lazy"` : ""} decoding="async">` : `<span class="hfol__noimg">${esc(L.page)} ${n}</span>`)
      + `${spots}<figcaption class="hfol__num">${n} / ${N}</figcaption></figure>`
      + (cnt ? `<label class="hfol__cta" for="${P}-m${n}">${esc(L.seeN(cnt))}</label>` : "")
      + `</div>`;
  };

  // ------------------------------------------------------------------ desktop viewer (spreads)
  const spreadHtml = spreads.map((sp, k) => {
    desk.push(`${R}:has(#${P}-s${k}:checked) .hfol__sp--${k}{display:grid}`);
    desk.push(`${R}:has(#${P}-s${k}:checked) .hfol__nav--${k},${R}:has(#${P}-s${k}:checked) .hfol__cnt--${k}{display:flex}`);
    desk.push(`${R}:has(#${P}-s${k}:checked) .hfol__th--${k}{border-color:var(--hfol-text);box-shadow:inset 0 0 0 1px var(--hfol-text);color:var(--hfol-text)}`);
    return `<div class="hfol__spread hfol__sp--${k}${sp.length === 1 ? " hfol__spread--one" : ""}">${sp.map(pageHtml).join("")}</div>`;
  }).join("");
  const navHtml = spreads.map((_, k) => `<span class="hfol__nav hfol__nav--${k}">`
    + `<label class="hfol__arrow hfol__arrow--prev${k === 0 ? " is-off" : ""}"${k > 0 ? ` for="${P}-s${k - 1}"` : ""} aria-label="${esc(L.prev)}"></label>`
    + `<label class="hfol__arrow hfol__arrow--next${k === spreads.length - 1 ? " is-off" : ""}"${k < spreads.length - 1 ? ` for="${P}-s${k + 1}"` : ""} aria-label="${esc(L.nextA)}"></label></span>`).join("");
  const thumbsHtml = spreads.map((sp, k) => `<label class="hfol__th hfol__th--${k}" for="${P}-s${k}" aria-label="${esc(L.pagesOf(label(sp), N))}">${sp.map((n) => `<span>${n}</span>`).join("")}</label>`).join("");
  const countHtml = spreads.map((sp, k) => `<span class="hfol__cnt hfol__cnt--${k}">${esc(sp.length === 1 ? L.pageOf(sp[0], N) : L.pagesOf(label(sp), N))}</span>`).join("");

  // ------------------------------------------------------------------ side panel: products of the spread / picked product
  const row = (sku) => { const p = products[sku]; return `<label class="hfol__row" for="${pr(sku)}"><span class="hfol__thumb">${img(p.image)}</span><span class="hfol__row-txt"><span class="hfol__name">${esc(p.name)}</span><span class="hfol__ref">${esc(L.ref)} ${esc(sku)}</span></span>${price(p)}</label>`; };
  const listsHtml = spreads.map((sp, k) => {
    const skus = [...new Set(sp.flatMap((n) => onPage[n]))];
    const picked = skus.map((s) => `#${pr(s)}:checked`).join(",");
    desk.push(`${R}:has(#${P}-s${k}:checked)${picked ? `:not(:has(${picked}))` : ""} .hfol__list--${k}{display:block}`);
    for (const s of skus) desk.push(`${R}:has(#${P}-s${k}:checked):has(#${pr(s)}:checked) .hfol__det--${ix(s)}{display:block}`);
    return `<div class="hfol__list hfol__list--${k}"><h3 class="hfol__h3">${esc(L.inThese)}</h3>${skus.length ? `<p class="hfol__muted">${esc(L.pickHint)}</p>${skus.map(row).join("")}` : `<p class="hfol__muted">${esc(L.none)}</p>`}</div>`;
  }).join("");
  const detailsHtml = order.map((sku) => {
    const p = products[sku], i = ix(sku);
    mob.push(`${R}:has(#${pr(sku)}:checked) .hfol__det--${i}{display:block}`);
    rules.push(`${R}:has(#${pr(sku)}:checked) .hfol__hs--${i}{background:var(--hfol-text);color:#fff;box-shadow:0 0 0 2px #fff,0 0 0 5px var(--hfol-text)}`);
    rules.push(`${R}:has(#${pr(sku)}:checked) .hfol__hs--area.hfol__hs--${i}{background:rgba(255,255,255,.2);box-shadow:0 0 0 2px #fff,0 0 0 4px var(--hfol-text)}`);
    const pgs = pagesOfSku[sku] || [];
    return `<div class="hfol__det hfol__det--${i}"><div class="hfol__det-top"><span class="hfol__muted">${esc(L.onPage)} ${pgs.join(", ")}</span><label class="hfol__x" for="${P}-pn" aria-label="${esc(L.close)}"></label></div>`
      + `<a class="hfol__det-img" href="${esc(p.url)}"${track(p)}>${img(p.image, p.name)}</a>`
      + `<h3 class="hfol__det-name">${esc(p.name)}</h3><p class="hfol__ref">${esc(L.ref)} ${esc(sku)}</p>`
      + `${price(p, " hfol__price--big")}<p class="hfol__det-stock">${stockHtml(p)}</p>`
      + `<a class="hfol__go" href="${esc(p.url)}"${track(p)}>${esc(L.view)}</a></div>`;
  }).join("");

  // ------------------------------------------------------------------ mobile sheet: products of a page / of the flyer
  const srow = (sku) => { const p = products[sku]; return `<a class="hfol__srow" href="${esc(p.url)}"${track(p)}><span class="hfol__thumb hfol__thumb--big">${img(p.image)}</span><span class="hfol__row-txt"><span class="hfol__name">${esc(p.name)}</span><span class="hfol__ref">${esc(L.ref)} ${esc(sku)} · ${stockHtml(p)}</span>${price(p)}</span></a>`; };
  const pagesWith = pages.map((_, i) => i + 1).filter((n) => onPage[n].length);
  const sheetLists = pagesWith.map((n) => {
    mob.push(`${R}:has(#${P}-m${n}:checked):not(:has(#${P}-ta:checked)) .hfol__sl--${n}{display:block}`);
    mob.push(`${R}:has(#${P}-m${n}:checked) .hfol__st--${n}{display:block}`);
    const nx = pagesWith.find((m) => m > n);
    const sec = nx && pages[nx - 1].section;
    return `<div class="hfol__sl hfol__sl--${n}">${onPage[n].map(srow).join("")}`
      + (nx ? `<div class="hfol__nextpg"><span class="hfol__h4">${esc(L.next)}</span><label class="hfol__nextpg-box" for="${P}-m${nx}"><span class="hfol__nextpg-img">${img(imageFor ? imageFor(nx) : pages[nx - 1].src)}</span><span class="hfol__row-txt"><span>${esc(L.page)} ${nx}${sec ? ` · ${esc(sec)}` : ""}</span><span class="hfol__muted">${onPage[nx].length} ${esc(onPage[nx].length === 1 ? L.product : L.products)}</span><u>${esc(L.viewPage)}</u></span></label></div>` : "")
      + `</div>`;
  }).join("");
  const sheetHtml = pagesWith.length ? `<div class="hfol__sheet" role="dialog" aria-label="${esc(L.allTitle)}"><div class="hfol__sheet-head"><label class="hfol__x" for="${P}-mn" aria-label="${esc(L.close)}"></label><div>${pagesWith.map((n) => `<span class="hfol__st hfol__st--${n}">${esc(L.ofPage(n))}</span>`).join("")}<span class="hfol__muted">${esc(cfg.title || cfg.name || "")}</span></div></div>`
    + `<div class="hfol__tabs"><label class="hfol__tab hfol__tab--p" for="${P}-tp">${esc(L.thisPage)}</label><label class="hfol__tab hfol__tab--a" for="${P}-ta">${esc(L.whole)}</label></div>`
    + `<div class="hfol__sheet-body">${sheetLists}<div class="hfol__sall">${all.map(srow).join("")}</div></div></div>` : "";

  // ------------------------------------------------------------------ all products (grid + section filter)
  const chips = sections.length > 1 ? `<div class="hfol__chips"><label class="hfol__chip hfol__chip--0" for="${P}-f0">${esc(L.all)}</label>${sections.map((s, k) => `<label class="hfol__chip hfol__chip--${k + 1}" for="${P}-f${k + 1}">${esc(s)}</label>`).join("")}</div>` : "";
  if (sections.length > 1) {
    rules.push(`${R}:has(#${P}-f0:checked) .hfol__chip--0{background:var(--hfol-text);border-color:var(--hfol-text);color:#fff}`);
    sections.forEach((_, k) => {
      rules.push(`${R}:has(#${P}-f${k + 1}:checked) .hfol__chip--${k + 1}{background:var(--hfol-text);border-color:var(--hfol-text);color:#fff}`);
      rules.push(`${R}:has(#${P}-f${k + 1}:checked) .hfol__card:not(.hfol__sec--${k + 1}){display:none}`);
    });
  }
  const cards = all.map((sku) => {
    const p = products[sku];
    return `<a class="hfol__card hfol__sec--${secIx(sku)}${p.inStock === false ? " is-oos" : ""}" href="${esc(p.url)}"${track(p)}><span class="hfol__card-img">${img(p.image)}</span>`
      + `${pagesOfSku[sku] ? `<span class="hfol__muted">${esc(L.page)} ${pagesOfSku[sku].join(", ")}</span>` : ""}<span class="hfol__card-name">${esc(p.name)}</span>${price(p)}${p.inStock === false || p.low ? stockHtml(p) : ""}</a>`;
  }).join("");

  // ------------------------------------------------------------------ header
  const from = dmy(cfg.validFrom), to = dmy(cfg.validTo);
  const sub = [from && to ? L.valid(from, to) : to ? L.validTo(to) : "", `${N} ${L.pages}`, `${all.length} ${all.length === 1 ? L.product : L.products}`].filter(Boolean).join(" · ");

  const media = (q, list) => (list.length ? `\n@media ${q}{\n${list.join("\n")}\n}` : "");
  return `<div class="hfol" id="${P}" data-fol-id="${esc(cfg.id || id)}" data-ff-list-id="${esc(listIdOf(cfg))}" data-ff-list-name="${esc(listNameOf(cfg))}" aria-label="${esc(L.list)}">`
    + `<style>${css.trim()}${rules.length ? "\n" + rules.join("\n") : ""}${media("(min-width:768px)", desk)}${media("(max-width:767px)", mob)}</style>`
    + radios
    + `<div class="hfol__head"><div>${cfg.title ? `<h2 class="hfol__title">${esc(cfg.title)}</h2>` : ""}<p class="hfol__sub">${esc(sub)}</p></div>`
    + `<div class="hfol__actions">${spreads.length > 1 ? `<label class="hfol__btn hfol__btn--ix" for="${P}-ix">${esc(L.index)}</label>` : ""}${all.length ? `<a class="hfol__btn" href="#${P}-todos">${esc(L.seeAll)}</a>` : ""}</div></div>`
    + `<div class="hfol__main"><section class="hfol__viewer" aria-label="${esc(L.list)}"><div class="hfol__stage">${spreads.length > 1 ? navHtml : ""}<div class="hfol__track">${spreadHtml}</div></div>`
    + `${N > 1 ? `<p class="hfol__hint">${esc(L.swipe)} →</p>` : ""}`
    + `${spreads.length > 1 ? `<div class="hfol__bar"><div class="hfol__thumbs">${thumbsHtml}</div>${countHtml}</div>` : ""}</section>`
    + (order.length ? `<label class="hfol__backdrop" for="${P}-pn" aria-hidden="true"></label>` : "")
    + `<aside class="hfol__aside" aria-label="${esc(L.inThese)}">${listsHtml}${detailsHtml}</aside></div>`
    + sheetHtml
    + (all.length ? `<section class="hfol__all" id="${P}-todos" aria-label="${esc(L.allTitle)}"><h2 class="hfol__h2">${esc(L.allTitle)}</h2>${chips}<div class="hfol__grid">${cards}</div></section>` : "")
    + `</div>`;
}
