/* FeedForge · tracking dos blocos colados como Raw HTML no Page Designer (Shop the Look, Page Builder e Folhetos).
   O Raw HTML não corre JavaScript, por isso este código vive no GTM do site (tag "Custom HTML", disparo em All Pages)
   e lê os atributos que o FeedForge escreve no HTML:
     - lista:   data-ff-list-id, data-ff-list-name   (no contentor do módulo / bloco de produtos)
     - produto: data-item-id, data-item-name, data-item-price, data-item-index, data-item-cat ("Decoração > Almofadas")
     - pin:     data-ff-pin (Shop the Look)
     - folheto: data-fol-id/-name/-pages (contentor), data-fol-page (cada página), data-fol-ev (controlos)
   Eventos no dataLayer, no formato GA4 que o site já usa no view_item:
     view_item_list (quando a lista fica ≥ 50% visível — ou ocupa ≥ 50% do ecrã, nos blocos altos —, uma vez por lista e por página)
     select_item    (clique num produto)
     stl_pin_select (pin do Shop the Look aberto; evento próprio, sem ecommerce)
     fol_view, fol_page_view, fol_pin_select, fol_page_products, fol_navigate, fol_index, fol_tab,
     fol_filter, fol_all_products (folhetos; eventos próprios com fol_id, fol_name, fol_pages, item_list_id)
   As listas com mais de 200 produtos são enviadas em vários view_item_list (limite do GA4 por evento).
   Seguro de carregar mais de uma vez; funciona com a navegação da PWA (blocos que aparecem depois). */
(function () {
  if (window.__ffTracking) return;
  window.__ffTracking = true;
  var dl = function (o) { (window.dataLayer = window.dataLayer || []).push(o); };
  var CURRENCY = "EUR";

  function item(el, list) {
    var cat = (el.getAttribute("data-item-cat") || "").split(/\s*>\s*/).filter(Boolean);
    var it = {
      item_id: el.getAttribute("data-item-id"),
      item_name: el.getAttribute("data-item-name") || undefined,
      price: parseFloat(el.getAttribute("data-item-price")) || 0,
      quantity: 1,
      index: parseInt(el.getAttribute("data-item-index"), 10) || undefined,
      item_list_id: list.getAttribute("data-ff-list-id"),
      item_list_name: list.getAttribute("data-ff-list-name"),
      item_category: "Produtos"
    };
    if (cat[0]) it.item_category2 = cat[0];
    if (cat[1]) it.item_category3 = cat[1];
    return it;
  }
  function itemsOf(list) {
    var seen = {}, out = [];
    var els = list.querySelectorAll("[data-item-id][data-item-name]");
    for (var i = 0; i < els.length; i++) {
      var id = els[i].getAttribute("data-item-id");
      if (!id || seen[id]) continue;          // the same product appears in the pin, the highlight and the card
      seen[id] = 1; out.push(item(els[i], list));
    }
    return out.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
  }
  function ecommerce(event, list, items) {
    dl({ ecommerce: null });
    dl({ event: event, ecommerce: { currency: CURRENCY, item_list_id: list.getAttribute("data-ff-list-id"), item_list_name: list.getAttribute("data-ff-list-name"), items: items } });
  }

  function viewList(list) {
    var items = itemsOf(list);
    for (var i = 0; i < items.length; i += 200) ecommerce("view_item_list", list, items.slice(i, i + 200));
  }

  // ---- folhetos: own events (no ecommerce), always with the flyer's id, name, page count and list id
  function fol(event, root, extra) {
    var o = { event: event, fol_id: root.getAttribute("data-fol-id"), fol_name: root.getAttribute("data-fol-name") || undefined,
      fol_pages: parseInt(root.getAttribute("data-fol-pages"), 10) || undefined, item_list_id: root.getAttribute("data-ff-list-id") || undefined };
    for (var k in extra) if (extra[k] !== undefined && extra[k] !== null && extra[k] !== "") o[k] = extra[k];
    dl(o);
  }
  function int(v) { var n = parseInt(v, 10); return isNaN(n) ? undefined : n; }
  // fol_page_view: once per page and flyer, when ≥ 60% of its width is on screen and ≥ 60% of its height (or of the
  // viewport, for pages taller than the screen). Works for both layouts: hidden spreads (desktop) don't intersect and
  // the swipe track (mobile) clips the pages beside the current one.
  var pio = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting || !e.boundingClientRect.width || !e.boundingClientRect.height) return;
      var vh = (e.rootBounds && e.rootBounds.height) || window.innerHeight || 0, r = e.intersectionRect, t = e.boundingClientRect;
      if (r.width / t.width < 0.6 || (r.height / t.height < 0.6 && !(vh && r.height >= vh * 0.6))) return;
      var root = e.target.closest("[data-fol-id]"), n = e.target.getAttribute("data-fol-page");
      if (!root) return;
      var seen = root.__folPages || (root.__folPages = {});
      if (seen[n]) return;
      seen[n] = 1; pio.unobserve(e.target);
      fol("fol_page_view", root, { page_number: int(n) });
    });
  }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] }) : null;
  // controls (labels / links with data-fol-ev); capture phase, so a checkbox still has its state before the click
  document.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("[data-fol-ev]") : null;
    var root = el && el.closest("[data-fol-id]");
    if (!el || !root) return;
    var type = el.getAttribute("data-fol-ev"), src = el.getAttribute("data-fol-src") || undefined;
    var ctl = el.htmlFor ? document.getElementById(el.htmlFor) : null;
    var pg = el.closest("[data-fol-page]");
    if (type === "pin") {
      var sku = ctl && ctl.getAttribute("data-ff-pin");
      if (!sku) return;
      var card = root.querySelector('[data-item-id="' + sku.replace(/"/g, "") + '"][data-item-name]');
      fol("fol_pin_select", root, { item_id: sku, item_name: card ? card.getAttribute("data-item-name") : undefined, page_number: pg ? int(pg.getAttribute("data-fol-page")) : undefined, fol_source: src });
    } else if (type === "sheet") fol("fol_page_products", root, { page_number: int(el.getAttribute("data-fol-to")), fol_source: src });
    else if (type === "nav") fol("fol_navigate", root, { page_number: int(el.getAttribute("data-fol-to")), fol_source: src });
    else if (type === "index") { if (ctl && !ctl.checked) fol("fol_index", root, {}); }
    else if (type === "tab") { if (ctl && !ctl.checked) fol("fol_tab", root, { fol_tab: el.getAttribute("data-fol-tab") }); }
    else if (type === "filter") { if (ctl && !ctl.checked) fol("fol_filter", root, { fol_filter: el.getAttribute("data-fol-filter") }); }
    else if (type === "all") fol("fol_all_products", root, {});
  }, true);

  // view_item_list: once per list element, when half of it is on screen — or, for blocks taller than the
  // screen (e.g. a 12-product grid), when it fills at least half of the viewport
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting || e.target.__ffSeen) return;
      var vh = (e.rootBounds && e.rootBounds.height) || window.innerHeight || 0;
      if (e.intersectionRatio < 0.5 && !(vh && e.intersectionRect.height >= vh * 0.5)) return;
      e.target.__ffSeen = true; io.unobserve(e.target);
      if (e.target.hasAttribute("data-fol-id")) fol("fol_view", e.target, {});
      viewList(e.target);
    });
  }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5] }) : null;
  function scan(root) {
    var lists = (root || document).querySelectorAll ? (root || document).querySelectorAll("[data-ff-list-id]") : [];
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i];
      if (l.__ffWatched) continue;
      l.__ffWatched = true;
      if (io) io.observe(l); else { l.__ffSeen = true; if (l.hasAttribute("data-fol-id")) fol("fol_view", l, {}); viewList(l); }
    }
    var pages = (root || document).querySelectorAll ? (root || document).querySelectorAll("[data-fol-page]") : [];
    for (var j = 0; j < pages.length; j++) if (!pages[j].__folWatched && pio) { pages[j].__folWatched = true; pio.observe(pages[j]); }
  }

  // select_item: click on any product link inside a FeedForge list
  document.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-item-id][data-item-name]") : null;
    var list = t && t.closest("[data-ff-list-id]");
    if (!t || !list || t.closest("[data-hstl-action]")) return;
    ecommerce("select_item", list, [item(t, list)]);
  }, true);

  // Shop the Look pins (opened with a tap / click or keyboard)
  function pin(ev) {
    var p = ev.target && ev.target.closest ? ev.target.closest("[data-ff-pin]") : null;
    var list = p && p.closest("[data-ff-list-id]");
    if (!p || !list || list.hasAttribute("data-fol-id") || p.__ffLast && Date.now() - p.__ffLast < 1000) return;
    p.__ffLast = Date.now();
    var card = list.querySelector('[data-item-id="' + p.getAttribute("data-ff-pin").replace(/"/g, "") + '"][data-item-name]');
    dl({ event: "stl_pin_select", stl_id: list.getAttribute("data-stl-id"), item_list_id: list.getAttribute("data-ff-list-id"), item_id: p.getAttribute("data-ff-pin"), item_name: card ? card.getAttribute("data-item-name") : undefined });
  }
  document.addEventListener("focusin", pin, true);

  scan(document);
  if ("MutationObserver" in window) new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) if (muts[i].addedNodes.length) { scan(document); return; }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
