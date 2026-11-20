/* FeedForge · tracking dos blocos colados como Raw HTML no Page Designer (Shop the Look + Page Builder).
   O Raw HTML não corre JavaScript, por isso este código vive no GTM do site (tag "Custom HTML", disparo em All Pages)
   e lê os atributos que o FeedForge escreve no HTML:
     - lista:   data-ff-list-id, data-ff-list-name   (no contentor do módulo / bloco de produtos)
     - produto: data-item-id, data-item-name, data-item-price, data-item-index, data-item-cat ("Decoração > Almofadas")
     - pin:     data-ff-pin (Shop the Look)
   Eventos no dataLayer, no formato GA4 que o site já usa no view_item:
     view_item_list (quando a lista fica ≥ 50% visível, uma vez por lista e por página)
     select_item    (clique num produto)
     stl_pin_select (pin do Shop the Look aberto; evento próprio, sem ecommerce)
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

  // view_item_list: once per list element, when half of it is on screen
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting || e.target.__ffSeen) return;
      e.target.__ffSeen = true; io.unobserve(e.target);
      var items = itemsOf(e.target);
      if (items.length) ecommerce("view_item_list", e.target, items);
    });
  }, { threshold: 0.5 }) : null;
  function scan(root) {
    var lists = (root || document).querySelectorAll ? (root || document).querySelectorAll("[data-ff-list-id]") : [];
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i];
      if (l.__ffWatched) continue;
      l.__ffWatched = true;
      if (io) io.observe(l); else { l.__ffSeen = true; var it = itemsOf(l); if (it.length) ecommerce("view_item_list", l, it); }
    }
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
    if (!p || !list || p.__ffLast && Date.now() - p.__ffLast < 1000) return;
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
