/* hôma · Shop the Look widget — vanilla, no dependencies.
   API: window.HomaShopTheLook.mount(sectionEl, config) — safe to call again (re-renders).
   Layouts: config.layout "classic" (image + Color Block + carousel) or "moodboard" (image + product grid, Figma "Shop the Look" 9060:8542).
   Cart / wishlist (moodboard): the storefront registers what the buttons do, once per page:
     window.HomaShopTheLook.setHandlers({ cart: (items, ctx) => …, wishlist: (items, ctx) => … })
   items = [{ id, name, price, url }]; ctx = { stlId, scope: "all" | "item" }; return a Promise to show the "added" state.
   Without a handler (on the site, until the storefront calls setHandlers) the cart / wishlist buttons and icons stay hidden.
   Exported snippets: <section class="hstl" data-stl-id="ID"> + <script type="application/json" data-stl-config="ID"> are mounted automatically.
   Products flagged missing / oos (not in the feed / out of stock) are hidden. */
(function(){
  const CHEV = d => `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${d}" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // outline icons in the design-system style (Icon/Navigation/Heart 16, Icon/Navigation/Bag-plus 24 / 16)
  const HEART = `<svg class="hstl__ico-heart" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 13.6S1.8 10 1.8 5.7A3.2 3.2 0 0 1 8 4.4a3.2 3.2 0 0 1 6.2 1.3C14.2 10 8 13.6 8 13.6Z" fill="none" stroke="#181818" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  const BAG = `<svg class="hstl__ico-bag" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="#181818" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8h15l-1 12.5h-13z"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/><path d="M12 11.5v5M9.5 14h5"/></svg>`;
  const LABELS = {
    "pt-PT": { wishlistAll: "Adicionar aos favoritos", cartAll: "Adicionar tudo ao carrinho", wishlist: "Adicionar aos favoritos", cart: "Adicionar ao carrinho", added: "Adicionado" },
    "es-ES": { wishlistAll: "Añadir a favoritos", cartAll: "Añadir todo a la cesta", wishlist: "Añadir a favoritos", cart: "Añadir a la cesta", added: "Añadido" },
  };
  const H = (window.HomaShopTheLook && window.HomaShopTheLook.__handlers) || {};
  const mounted = new Set();

  function mount(root, cfg){
    if (cfg && cfg.layout === "moodboard") return mountMood(root, cfg);
    root.classList.remove("hstl--mood");
    const fmt = new Intl.NumberFormat(cfg.locale || "pt-PT", {style:"currency", currency:cfg.currency || "EUR"});
    if (root.__hstlRO) root.__hstlRO.disconnect(); // re-mount (editor live preview)
    const all = cfg.products || [];
    const P = all.filter(p => !p.missing && !p.oos);
    cfg = { ...cfg, image: cfg.image || { src: "", alt: "" } };
    if (cfg.blockColor) root.style.setProperty("--hstl-block", cfg.blockColor);

    const price = p => {
      const sale = p.listPrice && p.listPrice > p.price;
      return `<span class="hstl__price"><b>${fmt.format(p.price)}</b>${sale ? `<s>${fmt.format(p.listPrice)}</s><em>-${Math.round((1-p.price/p.listPrice)*100)}%</em>` : ""}</span>`;
    };
    const badges = p => (p.badges||[]).length ? `<span class="hstl__badges">${p.badges.map(b=>`<span class="hstl__badge${b.tone?` hstl__badge--${b.tone}`:""}">${esc(b.label)}</span>`).join("")}</span>` : "";

    root.innerHTML = `
      <header class="hstl__head">
        ${cfg.eyebrow ? `<p class="hstl__eyebrow">${esc(cfg.eyebrow)}</p>` : ""}
        ${cfg.title ? `<h2 class="hstl__title">${esc(cfg.title)}</h2>` : ""}
      </header>
      <div class="hstl__products">
      <div class="hstl__inspo">
        <div class="hstl__stage">
          <img src="${esc(cfg.image.src)}" alt="${esc(cfg.image.alt)}" loading="lazy">
          ${P.map((p,i)=> p.pin && p.pin.show!==false ? `<button class="hstl__pin" type="button" data-i="${i}" style="left:${p.pin.x}%;top:${p.pin.y}%" aria-pressed="false" aria-label="${esc(p.name)}"></button>` : "").join("")}
          <a class="hstl__pop" href="#" aria-live="polite"><span class="hstl__pop-name"></span><span class="hstl__pop-price"></span><span class="hstl__pop-cta">${esc(cfg.popoverCta || "Ver produto")}</span></a>
          ${cfg.cta && cfg.cta.show ? `<a class="hstl__cta" href="${esc(cfg.cta.url)}" style="left:${cfg.cta.x}%;top:${cfg.cta.y}%">${esc(cfg.cta.text)}</a>` : ""}
        </div>
        <aside class="hstl__block"><a class="hstl__hl" href="#"><span class="hstl__hl-img"><img alt=""></span>
          <span><span class="hstl__hl-name"></span><span class="hstl__hl-desc" style="display:block"></span><span class="hstl__hl-price"></span></span></a></aside>
      </div>
      <div class="hstl__list">
        <button class="hstl__arrow hstl__arrow--prev" type="button" aria-label="Anterior">${CHEV("M10 3 5 8l5 5")}</button>
        <div class="hstl__track" role="list">
          ${P.map((p,i)=>`<a class="hstl__card" role="listitem" href="${esc(p.url)}" data-i="${i}">
            <span class="hstl__card-img"><img src="${esc(p.image)}" alt="" loading="lazy">${badges(p)}</span>
            <span><span class="hstl__card-name">${esc(p.name)}</span><span class="hstl__card-desc" style="display:block">${esc(p.description||"")}</span>${price(p)}</span></a>`).join("")}
        </div>
        <button class="hstl__arrow hstl__arrow--next" type="button" aria-label="Seguinte">${CHEV("m6 3 5 5-5 5")}</button>
        ${cfg.cta && cfg.cta.show ? `<a class="hstl__cta hstl__cta--below" href="${esc(cfg.cta.url)}">${esc(cfg.cta.text)}</a>` : ""}
      </div>
      </div>`;

    const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    const stage = $(".hstl__stage"), pop = $(".hstl__pop"), track = $(".hstl__track");
    const track_ = (event, i) => { (window.dataLayer = window.dataLayer || []).push({event, stl_id: cfg.id, item_id: P[i]?.id, item_name: P[i]?.name, index: i}); };

    function activate(i, {scroll=true, source=null}={}){
      const p = P[i]; if (!p) return;
      $$(".hstl__pin").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));
      $$(".hstl__card").forEach(c => c.classList.toggle("is-active", +c.dataset.i === i));
      // highlight (Color Block)
      const hl = $(".hstl__hl"); hl.href = p.url;
      hl.querySelector("img").src = p.image; hl.querySelector("img").alt = p.name;
      hl.querySelector(".hstl__hl-name").textContent = p.name;
      hl.querySelector(".hstl__hl-desc").textContent = p.description || "";
      hl.querySelector(".hstl__hl-price").innerHTML = price(p);
      // popover next to the pin (flips when near the right / bottom edge)
      pop.href = p.url;
      pop.querySelector(".hstl__pop-name").textContent = p.name;
      pop.querySelector(".hstl__pop-price").innerHTML = price(p);
      if (p.pin && p.pin.show !== false){
        const W = stage.clientWidth, H = stage.clientHeight, px = p.pin.x/100*W, py = p.pin.y/100*H;
        const pw = pop.offsetWidth || 248, ph = pop.offsetHeight || 140;
        const M = 12; let left = px + 28, top = py - ph/2;
        if (left + pw > W - M) left = px - 28 - pw;              // flip to the left of the pin
        if (left < M){                                            // no room on either side (mobile): above / below the pin
          left = Math.max(M, Math.min(px - pw/2, W - pw - M));
          top = py - 28 - ph; if (top < M) top = py + 28;
        }
        top = Math.max(M, Math.min(top, H - ph - M));
        pop.style.left = left + "px"; pop.style.top = top + "px";
        pop.classList.add("is-open");
      } else pop.classList.remove("is-open");
      if (scroll){ const card = $(`.hstl__card[data-i="${i}"]`); track.scrollTo({left: card.offsetLeft - track.offsetLeft, behavior:"smooth"}); }
      if (source) track_("stl_pin_select", i);
    }

    $$(".hstl__pin").forEach(b => b.addEventListener("click", () => activate(+b.dataset.i, {source:"pin"})));
    $$(".hstl__card").forEach(c => {
      c.addEventListener("mouseenter", () => matchMedia("(hover:hover)").matches && activate(+c.dataset.i, {scroll:false}));
      c.addEventListener("click", () => track_("stl_product_click", +c.dataset.i));
    });
    pop.addEventListener("click", () => track_("stl_product_click", P.indexOf(P.find(p=>p.url===pop.getAttribute("href")))));
    $(".hstl__hl").addEventListener("click", () => track_("stl_product_click", P.indexOf(P.find(p=>p.url===$(".hstl__hl").getAttribute("href")))));

    // arrows
    const prev = $(".hstl__arrow--prev"), next = $(".hstl__arrow--next");
    const step = () => ($(".hstl__card")?.offsetWidth || 285) + 12;
    prev.onclick = () => track.scrollBy({left:-step()*2}); next.onclick = () => track.scrollBy({left:step()*2});
    const sync = () => { prev.disabled = track.scrollLeft < 4; next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4; };
    track.addEventListener("scroll", sync, {passive:true});
    let active = Math.max(0, P.indexOf(all[Math.min(cfg.activeIndex ?? 0, all.length-1)]));
    root.__hstlRO = new ResizeObserver(() => { sync(); const a = root.querySelector('.hstl__pin[aria-pressed="true"]'); activate(a ? +a.dataset.i : active, {scroll:false}); });
    root.__hstlRO.observe(stage);
    activate(active, {scroll:false}); sync();
  }


  // ---------------------------------------------------------------- moodboard layout
  function mountMood(root, cfg){
    const fmt = new Intl.NumberFormat(cfg.locale || "pt-PT", {style:"currency", currency:cfg.currency || "EUR"});
    const L = LABELS[cfg.locale] || LABELS["pt-PT"];
    if (root.__hstlRO) root.__hstlRO.disconnect();
    root.classList.add("hstl--mood");
    mounted.add(root);
    const all = cfg.products || [];
    const P = all.filter(p => !p.missing && !p.oos);
    const A = { show: true, wishlistText: "", cartText: "", ...(cfg.actions || {}) };
    const img = cfg.image || { src: "", alt: "" };
    root.__hstlCfg = cfg;

    const price = p => {
      const sale = p.listPrice && p.listPrice > p.price;
      return `<span class="hstl__price"><b>${fmt.format(p.price)}</b>${sale ? `<s>${fmt.format(p.listPrice)}</s><em>-${Math.round((1-p.price/p.listPrice)*100)}%</em>` : ""}</span>`;
    };
    const badges = p => (p.badges||[]).length ? `<span class="hstl__badges">${p.badges.map(b=>`<span class="hstl__badge${b.tone?` hstl__badge--${b.tone}`:""}">${esc(b.label)}</span>`).join("")}</span>` : "";

    root.innerHTML = `
      <header class="hstl__mhead">
        <div class="hstl__mtitles">
          ${cfg.eyebrow ? `<p class="hstl__eyebrow">${esc(cfg.eyebrow)}</p>` : ""}
          ${cfg.title ? `<h2 class="hstl__title">${esc(cfg.title)}</h2>` : ""}
        </div>
        ${A.show ? `<div class="hstl__mactions">
          <button type="button" class="hstl__btn hstl__btn--sec" data-act="wishlist">${esc(A.wishlistText || L.wishlistAll)}</button>
          <button type="button" class="hstl__btn hstl__btn--pri" data-act="cart">${esc(A.cartText || L.cartAll)}</button>
        </div>` : ""}
      </header>
      <div class="hstl__mbody">
        <div class="hstl__stage hstl__mstage">
          <img src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy">
          ${P.map((p,i)=> p.pin && p.pin.show!==false ? `<button class="hstl__pin" type="button" data-i="${i}" style="left:${p.pin.x}%;top:${p.pin.y}%" aria-pressed="false" aria-label="${esc(p.name)}"></button>` : "").join("")}
          <a class="hstl__pop" href="#" aria-live="polite"><span class="hstl__pop-name"></span><span class="hstl__pop-price"></span><span class="hstl__pop-cta">${esc(cfg.popoverCta || "Ver produto")}</span></a>
          ${cfg.cta && cfg.cta.show ? `<a class="hstl__cta" href="${esc(cfg.cta.url)}" style="left:${cfg.cta.x}%;top:${cfg.cta.y}%">${esc(cfg.cta.text)}</a>` : ""}
        </div>
        <div class="hstl__mgrid" role="list">
          ${P.map((p,i)=>`<div class="hstl__mcard" role="listitem" data-i="${i}">
            <div class="hstl__mcard-img">
              <a href="${esc(p.url)}" tabindex="-1" aria-hidden="true" data-go="${i}"><img src="${esc(p.image)}" alt="" loading="lazy"></a>
              ${badges(p)}
              ${A.show ? `<button type="button" class="hstl__icon hstl__icon--wish" data-item="wishlist" data-i="${i}" aria-pressed="false" aria-label="${esc(L.wishlist)}: ${esc(p.name)}">${HEART}</button>
              <button type="button" class="hstl__icon hstl__icon--cart" data-item="cart" data-i="${i}" aria-label="${esc(L.cart)}: ${esc(p.name)}">${BAG}</button>` : ""}
            </div>
            <a class="hstl__mcard-txt" href="${esc(p.url)}" data-go="${i}"><span class="hstl__card-name">${esc(p.name)}</span><span class="hstl__card-desc">${esc(p.description||"")}</span>${price(p)}</a>
          </div>`).join("")}
        </div>
        ${cfg.cta && cfg.cta.show ? `<a class="hstl__cta hstl__cta--below" href="${esc(cfg.cta.url)}">${esc(cfg.cta.text)}</a>` : ""}
      </div>`;

    const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
    const stage = $(".hstl__mstage"), pop = $(".hstl__pop"), grid = $(".hstl__mgrid");
    const dl = (event, extra) => { (window.dataLayer = window.dataLayer || []).push({event, stl_id: cfg.id, ...extra}); };
    const track_ = (event, i) => dl(event, {item_id: P[i]?.id, item_name: P[i]?.name, index: i});
    const item = p => ({ id: p.id, name: p.name, price: p.price, url: p.url });

    function activate(i, {scroll=true, source=null}={}){
      const p = P[i]; if (!p) return;
      $$(".hstl__pin").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));
      $$(".hstl__mcard").forEach(c => c.classList.toggle("is-active", +c.dataset.i === i));
      pop.href = p.url;
      pop.querySelector(".hstl__pop-name").textContent = p.name;
      pop.querySelector(".hstl__pop-price").innerHTML = price(p);
      if (p.pin && p.pin.show !== false){
        const W = stage.clientWidth, Hh = stage.clientHeight, px = p.pin.x/100*W, py = p.pin.y/100*Hh;
        const pw = pop.offsetWidth || 248, ph = pop.offsetHeight || 140, M = 12;
        let left = px + 28, top = py - ph/2;
        if (left + pw > W - M) left = px - 28 - pw;
        if (left < M){ left = Math.max(M, Math.min(px - pw/2, W - pw - M)); top = py - 28 - ph; if (top < M) top = py + 28; }
        top = Math.max(M, Math.min(top, Hh - ph - M));
        pop.style.left = left + "px"; pop.style.top = top + "px";
        pop.classList.add("is-open");
      } else pop.classList.remove("is-open");
      // tablet / mobile: the grid is a horizontal row → bring the card into view (desktop grid: no scroll)
      if (scroll && grid.scrollWidth > grid.clientWidth + 4){ const c = $(`.hstl__mcard[data-i="${i}"]`); grid.scrollTo({left: c.offsetLeft - grid.offsetLeft, behavior:"smooth"}); }
      if (source) track_("stl_pin_select", i);
    }

    // cart / wishlist: storefront handler if registered; a DOM listener may also take over (event.preventDefault())
    async function act(kind, idx, btn){
      const items = idx == null ? P.map(item) : [item(P[idx])];
      const scope = idx == null ? "all" : "item";
      dl(kind === "cart" ? "stl_add_to_cart" : "stl_add_to_wishlist", { scope, items: items.map(x => x.id), ...(idx == null ? {} : {item_id: P[idx].id, item_name: P[idx].name, index: idx}) });
      const ev = new CustomEvent(`hstl:${kind}`, { bubbles: true, cancelable: true, detail: { stlId: cfg.id, scope, items } });
      const handler = H[kind];
      if (!root.dispatchEvent(ev) && !handler) return;          // a listener took care of it
      if (!handler){ if (idx != null) location.href = P[idx].url; return; }
      btn.disabled = true;
      try {
        await handler(items, { stlId: cfg.id, scope });
        if (kind === "wishlist" && idx != null) btn.setAttribute("aria-pressed", "true");
        btn.classList.add("is-done");
        if (idx == null){ const t = btn.textContent; btn.textContent = L.added; setTimeout(() => { btn.textContent = t; btn.classList.remove("is-done"); }, 2200); }
      } catch (e) { console.error("[hstl]", kind, e); }
      finally { btn.disabled = false; }
    }
    $$("[data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.act, null, b)));
    $$("[data-item]").forEach(b => b.addEventListener("click", e => { e.preventDefault(); act(b.dataset.item, +b.dataset.i, b); }));

    $$(".hstl__pin").forEach(b => b.addEventListener("click", () => activate(+b.dataset.i, {source:"pin"})));
    $$(".hstl__mcard").forEach(c => c.addEventListener("mouseenter", () => matchMedia("(hover:hover)").matches && activate(+c.dataset.i, {scroll:false})));
    $$("[data-go]").forEach(a => a.addEventListener("click", () => track_("stl_product_click", +a.dataset.go)));
    pop.addEventListener("click", () => track_("stl_product_click", P.findIndex(p => p.url === pop.getAttribute("href"))));

    syncHandlers(root);
    let active = Math.max(0, P.indexOf(all[Math.min(cfg.activeIndex ?? 0, all.length-1)]));
    root.__hstlRO = new ResizeObserver(() => { const a = root.querySelector('.hstl__pin[aria-pressed="true"]'); activate(a ? +a.dataset.i : active, {scroll:false}); });
    root.__hstlRO.observe(stage);
    activate(active, {scroll:false});
  }

  // header buttons only make sense when the storefront wired them (preview: always shown)
  function syncHandlers(root){
    const cfg = root.__hstlCfg || {};
    root.classList.toggle("hstl--no-cart", !H.cart && !cfg.preview);
    root.classList.toggle("hstl--no-wishlist", !H.wishlist && !cfg.preview);
  }
  function setHandlers(h){
    Object.assign(H, h || {});
    mounted.forEach(r => r.isConnected ? syncHandlers(r) : mounted.delete(r));
  }

  function autoMount(){
    document.querySelectorAll("section.hstl[data-stl-id]").forEach(el => {
      if (el.__hstlMounted) return;
      const id = el.getAttribute("data-stl-id");
      const s = [...document.querySelectorAll('script[type="application/json"][data-stl-config]')].find(x => x.getAttribute("data-stl-config") === id);
      if (!s) return;
      try { mount(el, JSON.parse(s.textContent)); el.__hstlMounted = true; } catch (e) { console.error("[hstl]", id, e); }
    });
  }

  window.HomaShopTheLook = Object.assign(window.HomaShopTheLook || {}, { mount, autoMount, setHandlers, __handlers: H });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount); else autoMount();
})();
