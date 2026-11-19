// Shop the Look — static renderer (no JavaScript). Used by the editor (preview + export) and the tests.
// SFCC Page Designer "Raw HTML" does not run scripts, so the module is shipped as plain HTML + CSS:
//  - pins / popover / active product / Color Block highlight work with :hover, :focus-within and :has()
//  - pin positions and visual-editor overrides are rules in the module's own <style> (no inline styles)
//  - tracking: data-ff-list-* on the module and data-item-* on every product link, read by the
//    FeedForge GTM tag (public/tracking/ff-tracking.js) → view_item_list / select_item in the site's GA4 format.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const safeId = (s) => String(s || "stl").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "stl";
const VAR_NAME = /^--hstl-s-[a-z0-9-]{1,40}$/, VAR_VALUE = /^(#[0-9a-f]{3,8}|\d+(\.\d+)?(px|%|fr)?|\d+\/\d+)$/i;
const HEX = /^#[0-9a-f]{3,8}$/i;

// outline icons in the design-system style (Icon/Navigation/Heart 16, Icon/Navigation/Bag-plus 24)
const HEART = `<svg class="hstl__ico-heart" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 13.6S1.8 10 1.8 5.7A3.2 3.2 0 0 1 8 4.4a3.2 3.2 0 0 1 6.2 1.3C14.2 10 8 13.6 8 13.6Z" fill="none" stroke="#181818" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
const BAG = `<svg class="hstl__ico-bag" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="#181818" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8h15l-1 12.5h-13z"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/><path d="M12 11.5v5M9.5 14h5"/></svg>`;
const LABELS = {
  "pt-PT": { wishlistAll: "Adicionar aos favoritos", cartAll: "Adicionar tudo ao carrinho", wishlist: "Adicionar aos favoritos", cart: "Adicionar ao carrinho", list: "Shop the Look" },
  "es-ES": { wishlistAll: "Añadir a favoritos", cartAll: "Añadir todo a la cesta", wishlist: "Añadir a favoritos", cart: "Añadir a la cesta", list: "Shop the Look" },
};

export const listIdOf = (cfg) => `stl_${safeId(cfg.id)}`;
export const listNameOf = (cfg) => `Shop the Look - ${String(cfg.name || cfg.title || cfg.id || "").slice(0, 80)}`;

// visible = in the feed and in stock (the others are hidden, same rule as before)
export const visibleProducts = (cfg) => (cfg.products || []).filter((p) => p && !p.missing && !p.oos);

export function renderStl(cfg, { css = "", preview = false } = {}) {
  const id = safeId(cfg.id), root = `#hstl-${id}`;
  const fmt = new Intl.NumberFormat(cfg.locale || "pt-PT", { style: "currency", currency: cfg.currency || "EUR" });
  const L = LABELS[cfg.locale] || LABELS["pt-PT"];
  const mood = cfg.layout === "moodboard";
  const all = cfg.products || [];
  const P = visibleProducts(cfg);
  const activeRef = all[Math.min(num(cfg.activeIndex), Math.max(0, all.length - 1))];
  const A = Math.max(0, P.indexOf(activeRef)); // default active product (index among visible ones)
  const img = cfg.image || {};
  const listId = listIdOf(cfg), listName = listNameOf(cfg);

  const price = (p) => {
    const sale = p.listPrice && p.listPrice > p.price;
    return `<span class="hstl__price"><b>${esc(fmt.format(num(p.price)))}</b>${sale ? `<s>${esc(fmt.format(p.listPrice))}</s><em>-${Math.round((1 - p.price / p.listPrice) * 100)}%</em>` : ""}</span>`;
  };
  const badges = (p) => ((p.badges || []).length ? `<span class="hstl__badges">${p.badges.map((b) => `<span class="hstl__badge${b.tone ? ` hstl__badge--${esc(b.tone)}` : ""}">${esc(b.label)}</span>`).join("")}</span>` : "");
  // tracking attributes (read by the GTM tag; same fields the site sends in view_item)
  const track = (p, i) => {
    const path = Array.isArray(p.path) ? p.path : String(p.category || "").split(/\s*>\s*/).filter(Boolean);
    return ` data-item-id="${esc(p.id)}" data-item-name="${esc(p.name)}" data-item-price="${num(p.price).toFixed(2)}" data-item-index="${i + 1}"${path.length ? ` data-item-cat="${esc(path.join(" > "))}"` : ""}`;
  };
  const href = (p) => esc(p.url || "#");

  // pins: wrapper positioned at x/y; popover beside it (flipped near the edges, decided here)
  const pins = P.map((p, i) => {
    if (!p.pin || p.pin.show === false) return "";
    const x = num(p.pin.x, 50), y = num(p.pin.y, 50);
    const cls = ["hstl__pw", `hstl__pw--${i}`, x > 60 ? "hstl__pw--l" : "", y < 25 ? "hstl__pw--t" : y > 75 ? "hstl__pw--b" : "", y < 50 ? "hstl__pw--mb" : ""].filter(Boolean).join(" ");
    return `<span class="${cls}"><span class="hstl__pin" tabindex="0" role="button" aria-label="${esc(p.name)}" data-ff-pin="${esc(p.id)}"></span>`
      + `<a class="hstl__pop" href="${href(p)}"${track(p, i)}><span class="hstl__pop-name">${esc(p.name)}</span><span class="hstl__pop-price">${price(p)}</span><span class="hstl__pop-cta">${esc(cfg.popoverCta || "Ver produto")}</span></a></span>`;
  }).join("");
  const cta = cfg.cta && cfg.cta.show && cfg.cta.text;
  const stage = `<div class="hstl__stage${mood ? " hstl__mstage" : ""}">${img.src ? `<img src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy" decoding="async">` : ""}${pins}${cta ? `<a class="hstl__cta" href="${esc(cfg.cta.url || "#")}">${esc(cfg.cta.text)}</a>` : ""}</div>`;
  const ctaBelow = cta ? `<a class="hstl__cta hstl__cta--below" href="${esc(cfg.cta.url || "#")}">${esc(cfg.cta.text)}</a>` : "";
  const head = `${cfg.eyebrow ? `<p class="hstl__eyebrow">${esc(cfg.eyebrow)}</p>` : ""}${cfg.title ? `<h2 class="hstl__title">${esc(cfg.title)}</h2>` : ""}`;

  let body;
  if (!mood) {
    const hl = P.map((p, i) => `<a class="hstl__hl hstl__hl--${i}${i === A ? " is-default" : ""}" href="${href(p)}"${track(p, i)}><span class="hstl__hl-img">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">` : ""}</span><span><span class="hstl__hl-name">${esc(p.name)}</span><span class="hstl__hl-desc">${esc(p.description || "")}</span>${price(p)}</span></a>`).join("");
    const cards = P.map((p, i) => `<a class="hstl__card hstl__c hstl__c--${i}" role="listitem" href="${href(p)}"${track(p, i)}><span class="hstl__card-img">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">` : ""}${badges(p)}</span><span><span class="hstl__card-name">${esc(p.name)}</span><span class="hstl__card-desc">${esc(p.description || "")}</span>${price(p)}</span></a>`).join("");
    body = `<header class="hstl__head">${head}</header><div class="hstl__products"><div class="hstl__inspo">${stage}<aside class="hstl__block">${hl}</aside></div><div class="hstl__list"><div class="hstl__track" role="list">${cards}</div>${ctaBelow}</div></div>`;
  } else {
    const act = { show: true, wishlistText: "", cartText: "", ...(cfg.actions || {}) };
    const cards = P.map((p, i) => `<div class="hstl__mcard hstl__c hstl__c--${i}" role="listitem"><div class="hstl__mcard-img"><a href="${href(p)}" tabindex="-1" aria-hidden="true"${track(p, i)}>${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">` : ""}</a>${badges(p)}`
      + (act.show ? `<button type="button" class="hstl__icon hstl__icon--wish" data-hstl-action="wishlist" data-item-id="${esc(p.id)}" aria-label="${esc(L.wishlist)}: ${esc(p.name)}">${HEART}</button><button type="button" class="hstl__icon hstl__icon--cart" data-hstl-action="cart" data-item-id="${esc(p.id)}" aria-label="${esc(L.cart)}: ${esc(p.name)}">${BAG}</button>` : "")
      + `</div><a class="hstl__mcard-txt" href="${href(p)}"${track(p, i)}><span class="hstl__card-name">${esc(p.name)}</span><span class="hstl__card-desc">${esc(p.description || "")}</span>${price(p)}</a></div>`).join("");
    const actions = act.show ? `<div class="hstl__mactions"><button type="button" class="hstl__btn hstl__btn--sec" data-hstl-action="wishlist" data-scope="all">${esc(act.wishlistText || L.wishlistAll)}</button><button type="button" class="hstl__btn hstl__btn--pri" data-hstl-action="cart" data-scope="all">${esc(act.cartText || L.cartAll)}</button></div>` : "";
    body = `<header class="hstl__mhead"><div class="hstl__mtitles">${head}</div>${actions}</header><div class="hstl__mbody">${stage}<div class="hstl__mgrid" role="list">${cards}</div>${ctaBelow}</div>`;
  }

  // ---- module CSS: overrides, positions, interaction states (all scoped to this module)
  const rules = [];
  const vars = Object.entries(cfg.vars || {}).filter(([n, v]) => VAR_NAME.test(n) && VAR_VALUE.test(String(v))).map(([n, v]) => `${n}:${v}`);
  if (!mood && HEX.test(cfg.blockColor || "")) vars.push(`--hstl-block:${cfg.blockColor}`);
  if (vars.length) rules.push(`${root}{${vars.join(";")}}`);
  P.forEach((p, i) => { if (p.pin && p.pin.show !== false) rules.push(`${root} .hstl__pw--${i}{left:${num(p.pin.x, 50)}%;top:${num(p.pin.y, 50)}%;--x:${num(p.pin.x, 50)}}`); });
  if (cta) rules.push(`${root} .hstl__stage>.hstl__cta{left:${num(cfg.cta.x, 50)}%;top:${num(cfg.cta.y, 92)}%}`);
  if (P.length) {
    const any = ".hstl__pw:hover,.hstl__pw:focus-within,.hstl__c:hover";
    const idle = `${root}:not(:has(${any}))`;
    const on = (i) => `${root}:has(.hstl__pw--${i}:hover,.hstl__pw--${i}:focus-within,.hstl__c--${i}:hover)`;
    const cardOn = (i) => `${root}:has(.hstl__c--${i}:hover)`;
    const list = (fn, tail) => P.map((_, i) => `${fn(i)} ${tail(i)}`).join(",");
    // pin pressed + popover open when its card is hovered (pin hover/focus is generic in widget.css), or by default
    rules.push(`${list(cardOn, (i) => `.hstl__pw--${i} .hstl__pin`)},${idle} .hstl__pw--${A} .hstl__pin{background:var(--hstl-pin);box-shadow:0 0 0 2px #fff,0 2px 10px rgba(0,0,0,.3)}`);
    rules.push(`${list(cardOn, (i) => `.hstl__pw--${i} .hstl__pin::after`)},${idle} .hstl__pw--${A} .hstl__pin::after{background:#fff}`);
    rules.push(`${list(cardOn, (i) => `.hstl__pw--${i} .hstl__pin::before`)},${idle} .hstl__pw--${A} .hstl__pin::before{animation:hstl-pulse 1.8s ease-out infinite}`);
    rules.push(`${list(cardOn, (i) => `.hstl__pw--${i} .hstl__pop`)},${idle} .hstl__pw--${A} .hstl__pop{opacity:1;transform:var(--hstl-pop-t,translateY(-50%));pointer-events:auto;visibility:visible}`);
    rules.push(`${list(cardOn, (i) => `.hstl__pw--${i}`)},${idle} .hstl__pw--${A}{z-index:4}`);
    // active card underline + Color Block highlight follow the pin / card being used
    rules.push(`${list(on, (i) => `.hstl__c--${i} .hstl__card-img::after`)},${list(on, (i) => `.hstl__c--${i} .hstl__mcard-img::after`)},${idle} .hstl__c--${A} .hstl__card-img::after,${idle} .hstl__c--${A} .hstl__mcard-img::after{transform:scaleX(1)}`);
    if (!mood) rules.push(`${list(on, (i) => `.hstl__hl--${i}`)},${idle} .hstl__hl--${A}{opacity:1;visibility:visible}`);
  }

  const classes = ["hstl", mood ? "hstl--mood" : "hstl--classic", mood && !preview ? "hstl--no-actions" : ""].filter(Boolean).join(" ");
  return `<div class="${classes}" id="hstl-${id}" data-stl-id="${esc(cfg.id || id)}" data-ff-list-id="${esc(listId)}" data-ff-list-name="${esc(listName)}" aria-label="${esc(L.list)}">`
    + `<style>${css.trim()}${rules.length ? "\n" + rules.join("\n") : ""}</style>${body}</div>`;
}
