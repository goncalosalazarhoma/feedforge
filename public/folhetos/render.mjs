// Folheto — static renderer (no JavaScript), shared by the editor (preview + export) and the tests.
// SFCC Page Designer "Raw HTML" does not run scripts: pages scroll sideways with CSS scroll-snap, hotspot cards open
// with :hover / :focus-within, positions are rules in the block's own <style> (no inline styles).
// Tracking: data-ff-list-* on the block and data-item-* on every product link (same contract as Shop the Look / Page Builder).

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const safeId = (s) => String(s || "folheto").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "folheto";
const T = {
  "pt-PT": { page: "Página", of: "de", oos: "Esgotado", hint: "Desliza para ver todas as páginas", list: "Folheto" },
  "es-ES": { page: "Página", of: "de", oos: "Agotado", hint: "Desliza para ver todas las páginas", list: "Folleto" },
};

export const listIdOf = (cfg) => `fol_${safeId(cfg.id)}`;
export const listNameOf = (cfg) => `Folheto - ${String(cfg.name || cfg.id || "").slice(0, 80)}`;

export function renderFolheto(cfg, { css = "", preview = false, imageFor = null } = {}) {
  const id = safeId(cfg.id), root = `#hfol-${id}`;
  const L = T[cfg.locale] || T["pt-PT"];
  const fmt = new Intl.NumberFormat(cfg.locale || "pt-PT", { style: "currency", currency: cfg.currency || "EUR" });
  const pages = cfg.pages || [];
  const products = cfg.products || {};
  const order = [];
  for (const h of cfg.hotspots || []) if (h.sku && products[h.sku] && !products[h.sku].missing && !order.includes(h.sku)) order.push(h.sku);
  const track = (p) => {
    const path = Array.isArray(p.path) ? p.path : [];
    return ` data-item-id="${esc(p.id)}" data-item-name="${esc(p.name)}" data-item-price="${num(p.price).toFixed(2)}" data-item-index="${order.indexOf(p.id) + 1}"${path.length ? ` data-item-cat="${esc(path.join(" > "))}"` : ""}`;
  };
  const price = (p) => `<span class="hfol__price"><b>${p.price === null || p.price === undefined ? "" : esc(fmt.format(num(p.price)))}</b>${p.listPrice && p.listPrice > p.price ? `<s>${esc(fmt.format(p.listPrice))}</s>` : ""}</span>`;
  const rules = [];

  const pageHtml = pages.map((pg, i) => {
    const n = i + 1;
    const src = imageFor ? imageFor(n) : pg.src;
    rules.push(`${root} .hfol__pg--${n}{aspect-ratio:${num(pg.ratio, 0.7071)}}`);
    const spots = (cfg.hotspots || []).map((h, k) => ({ h, k })).filter(({ h }) => h.page === n).map(({ h, k }) => {
      const p = h.sku ? products[h.sku] : null;
      const cls = `hfol__h--${k}`;
      if (!p || p.missing) {
        if (!preview) return ""; // never ship a hotspot without a product
        rules.push(`${root} .${cls}{left:${h.x}%;top:${h.y}%${h.type === "area" ? `;width:${h.w}%;height:${h.h}%` : ""}}`);
        return `<span class="${h.type === "area" ? "hfol__area" : "hfol__pw"} ${cls} hfol__miss" title="${esc(h.sku ? `${h.sku}: não encontrado` : "sem produto")}">${h.type === "area" ? "" : `<span class="hfol__pin"></span>`}</span>`;
      }
      const oos = p.inStock === false ? `<span class="hfol__oos">${esc(L.oos)}</span>` : "";
      if (h.type === "area") {
        rules.push(`${root} .${cls}{left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%}`);
        return `<a class="hfol__area ${cls}${p.inStock === false ? " is-oos" : ""}" href="${esc(p.url)}"${track(p)} aria-label="${esc(p.name)}"><span class="hfol__tip"><span class="hfol__tip-name">${esc(p.name)}</span>${price(p)}${oos}</span></a>`;
      }
      rules.push(`${root} .${cls}{left:${h.x}%;top:${h.y}%;--x:${h.x}}`);
      const side = [h.x > 50 ? "hfol__pw--l" : "", h.y > 70 ? "hfol__pw--b" : ""].filter(Boolean).join(" ");
      return `<span class="hfol__pw ${cls}${side ? ` ${side}` : ""}"><span class="hfol__pin" tabindex="0" role="button" aria-label="${esc(p.name)}" data-ff-pin="${esc(p.id)}"></span>`
        + `<span class="hfol__pop"><a class="hfol__card${p.inStock === false ? " is-oos" : ""}" href="${esc(p.url)}"${track(p)}><span class="hfol__card-img">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">` : ""}</span>`
        + `<span class="hfol__card-txt"><span class="hfol__card-name">${esc(p.name)}</span>${price(p)}${oos}</span></a></span></span>`;
    }).join("");
    return `<figure class="hfol__page hfol__pg--${n}" role="listitem" aria-label="${esc(`${L.page} ${n} ${L.of} ${pages.length}`)}">${src ? `<img class="hfol__img" src="${esc(src)}" alt="${esc(`${cfg.name} — ${L.page.toLowerCase()} ${n}`)}"${n > 2 ? ` loading="lazy"` : ""} decoding="async">` : `<span class="hfol__noimg">${esc(L.page)} ${n}</span>`}${spots}<figcaption class="hfol__num">${n} / ${pages.length}</figcaption></figure>`;
  }).join("");

  return `<div class="hfol" id="hfol-${id}" data-fol-id="${esc(cfg.id || id)}" data-ff-list-id="${esc(listIdOf(cfg))}" data-ff-list-name="${esc(listNameOf(cfg))}" aria-label="${esc(L.list)}">`
    + `<style>${css.trim()}${rules.length ? "\n" + rules.join("\n") : ""}</style>`
    + `${cfg.title ? `<h2 class="hfol__title">${esc(cfg.title)}</h2>` : ""}`
    + `<div class="hfol__track" role="list">${pageHtml}</div>`
    + `${pages.length > 1 ? `<p class="hfol__hint">${esc(L.hint)} →</p>` : ""}</div>`;
}
