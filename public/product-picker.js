/* FeedForge — shared ProductPicker (Shop the Look + Page Builder). Searches the optimized feed via /api/products. */
(() => {
  "use strict";
  const { $, $$, esc, guard, api } = window.FF;

  const MARKETS = { pt: "PT", es: "ES" };
  const FACET_LABEL = { color: "Cor", material: "Material", brand: "Marca", condition: "Estado", custom_label_0: "Label 0", custom_label_1: "Label 1", custom_label_2: "Label 2", custom_label_3: "Label 3", custom_label_4: "Label 4" };
  const fmt = (n, m) => (n == null ? "—" : new Intl.NumberFormat(m === "es" ? "es-ES" : "pt-PT", { style: "currency", currency: "EUR" }).format(n));

  const cache = { pt: {}, es: {} }; // id -> catalog item (null = not in the feed)
  const cats = {};                  // market -> category tree

  const newState = () => ({ q: "", category: "", subcategory: "", page: 1, filters: { inStock: true, sale: false, priceMin: "", priceMax: "", attrs: {} }, result: null });

  async function fetchIds(market, ids) {
    const need = [...new Set(ids)].filter((id) => !(id in cache[market]));
    for (let i = 0; i < need.length; i += 50) {
      const r = await api(`/products?market=${market}&ids=${encodeURIComponent(need.slice(i, i + 50).join(","))}`);
      for (const p of r.items) cache[market][p.id] = p.missing ? null : p;
    }
  }

  async function categories(market) {
    if (!cats[market]) cats[market] = await api(`/products/categories?market=${market}`);
    return cats[market];
  }

  const CSS = `
    .pp-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .pp-res{display:flex;gap:8px;border:1px solid var(--line);border-radius:8px;padding:6px;background:#fff}
    .pp-res img,.pp-sel img{width:56px;height:56px;object-fit:cover;border-radius:6px;background:var(--soft);flex:0 0 auto}
    .pp-res .t{font-size:12px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .pp-res.added{opacity:.6}
    .pp-cats a{display:flex;justify-content:space-between;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:13px}
    .pp-cats a:hover{background:var(--soft)}
    .pp-sel{display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:6px;background:#fff;margin-bottom:6px}
    .pp-sel.drag-over{border-color:var(--accent)}
    .pp-sel .handle{cursor:grab;color:var(--muted);user-select:none;padding:0 4px}`;
  function injectCss() {
    if (document.getElementById("pp-css")) return;
    const s = document.createElement("style"); s.id = "pp-css"; s.textContent = CSS; document.head.appendChild(s);
  }

  // drag-to-reorder on a list of rows with data-i; calls onMove(from, to)
  function enableReorder(box, rowSel, onMove) {
    let from = null;
    $$(rowSel, box).forEach((it) => {
      const h = it.querySelector(".handle");
      if (h) { h.addEventListener("pointerdown", () => { it.draggable = true; }); it.addEventListener("dragend", () => { it.draggable = false; }); }
      it.addEventListener("dragstart", (e) => { from = +it.dataset.i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(from)); });
      it.addEventListener("dragover", (e) => { e.preventDefault(); it.classList.add("drag-over"); });
      it.addEventListener("dragleave", () => it.classList.remove("drag-over"));
      it.addEventListener("drop", (e) => { e.preventDefault(); it.classList.remove("drag-over"); const to = +it.dataset.i; if (from != null && from !== to) onMove(from, to); from = null; });
    });
  }

  /**
   * mount(box, opts)
   *  opts.market          "pt" | "es"
   *  opts.state           object returned by ProductPicker.newState() (kept by the caller between redraws)
   *  opts.isSelected(id)  marks results already chosen
   *  opts.onAdd(product)  "add" button
   *  opts.addLabel / opts.selectedLabel
   *  opts.selected        optional { ids:() => string[], onChange(ids), title } → selected list with drag reorder + remove
   *  opts.reload          false = redraw from the last result without refetching
   */
  async function mount(box, opts) {
    if (!box) return;
    injectCss();
    const market = opts.market, P = opts.state, f = P.filters;
    const tree = await guard(() => categories(market));
    if (!tree) { box.innerHTML = `<div class="callout">Não foi possível ler o feed ${esc(MARKETS[market])}.</div>`; return; }
    if (opts.reload !== false || !P.result) {
      const qs = new URLSearchParams({ market, q: P.q, category: P.category, subcategory: P.subcategory, page: P.page, size: 24, inStock: f.inStock === false ? "0" : "1", onSale: f.sale ? "1" : "0", priceMin: f.priceMin ?? "", priceMax: f.priceMax ?? "", attrs: JSON.stringify(f.attrs || {}) });
      P.result = await guard(() => api(`/products?${qs}`));
      for (const p of P.result?.items || []) cache[market][p.id] = p;
    }
    const sel = opts.selected;
    if (sel) await guard(() => fetchIds(market, sel.ids()));
    const r = P.result || { items: [], total: 0, facets: {}, page: 1, size: 24 };
    const level = P.subcategory ? null : P.category ? tree.children.find((c) => c.name === P.category)?.children || [] : tree.children;
    const pages = Math.max(1, Math.ceil(r.total / r.size));
    const isSel = (id) => (opts.isSelected ? opts.isSelected(id) : sel ? sel.ids().includes(id) : false);
    const selIds = sel ? sel.ids() : [];
    box.innerHTML = `
      ${sel ? `<div class="small" style="font-weight:600;margin-bottom:6px">${esc(sel.title || "Selecionados")} · ${selIds.length} <span class="muted" style="font-weight:400">(arrasta para ordenar)</span></div>
        <div class="pp-selected">${selIds.map((id, i) => { const p = cache[market][id]; return `<div class="pp-sel" data-i="${i}"><span class="handle" title="Arrastar">⠿</span>${p?.image ? `<img src="${esc(p.image)}" alt=""/>` : `<img alt=""/>`}
          <div style="min-width:0;flex:1"><div class="small" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p?.title || id)}</div>
          <div class="small muted"><span class="mono">${esc(id)}</span> · ${p ? `${fmt(p.salePrice ?? p.price, market)}${p.salePrice ? ` <s>${fmt(p.price, market)}</s>` : ""}` : ""} ${p === null ? `<span class="badge ex">fora do feed</span>` : p && !p.inStock ? `<span class="badge flag">sem stock</span>` : ""}</div></div>
          <button class="btn sm ghost danger" data-pp-rm="${i}" title="Remover">✕</button></div>`; }).join("") || `<p class="muted small">Ainda sem produtos.</p>`}</div><hr style="border:0;border-top:1px solid var(--line);margin:10px 0"/>` : ""}
      <div class="row"><input data-pp="q" placeholder="ID, EAN ou nome…" value="${esc(P.q)}" style="flex:1"/><button class="btn sm" data-pp="go">Procurar</button></div>
      <div class="small" style="margin:8px 0"><a href="#" data-crumb="">Todas</a>${P.category ? ` › <a href="#" data-crumb="cat">${esc(P.category)}</a>` : ""}${P.subcategory ? ` › <b>${esc(P.subcategory)}</b>` : ""}</div>
      ${level && level.length ? `<div class="pp-cats" style="max-height:150px;overflow:auto;margin-bottom:8px">${level.slice(0, 60).map((c) => `<a data-cat="${esc(c.name)}"><span>${esc(c.name)}</span><span class="muted">${c.count}</span></a>`).join("")}</div>` : ""}
      <div class="chips" style="margin-bottom:6px">
        <span class="chip ${f.inStock !== false ? "on" : ""}" data-flt="inStock">Só em stock</span>
        <span class="chip ${f.sale ? "on" : ""}" data-flt="sale">Em promoção</span>
      </div>
      <div class="row small" style="margin-bottom:6px">Preço <input data-pp="pmin" type="number" min="0" placeholder="mín" value="${esc(f.priceMin)}" style="width:72px"/>–<input data-pp="pmax" type="number" min="0" placeholder="máx" value="${esc(f.priceMax)}" style="width:72px"/> €
        ${Object.entries(r.facets || {}).filter(([c]) => FACET_LABEL[c]).slice(0, 4).map(([c, vals]) => `<select data-facet="${esc(c)}" style="max-width:140px"><option value="">${esc(FACET_LABEL[c])}: todas</option>${vals.map((v) => `<option value="${esc(v.value)}" ${(f.attrs[c] || [])[0] === v.value ? "selected" : ""}>${esc(v.value)} (${v.count})</option>`).join("")}</select>`).join("")}
        ${Object.values(f.attrs).some((v) => v?.length) ? `<a href="#" data-pp="clear">limpar</a>` : ""}</div>
      <div class="small muted" style="margin-bottom:6px">${r.total} produto(s)</div>
      <div class="pp-results">${r.items.map((p) => `<div class="pp-res ${isSel(p.id) ? "added" : ""}"><img src="${esc(p.image)}" alt="" loading="lazy"/>
        <div style="min-width:0;flex:1"><div class="t">${esc(p.title)}</div><div class="small muted mono">${esc(p.id)}</div>
          <div class="small"><b>${fmt(p.salePrice ?? p.price, market)}</b>${p.salePrice ? ` <s class="muted">${fmt(p.price, market)}</s>` : ""}${p.inStock ? "" : ` <span class="badge flag">sem stock</span>`}</div>
          ${isSel(p.id) ? `<span class="badge new">${esc(opts.selectedLabel || "✓ adicionado")}</span>` : `<button class="btn sm" data-add="${esc(p.id)}">${esc(opts.addLabel || "Adicionar")}</button>`}</div></div>`).join("") || `<p class="muted small">Nada encontrado.</p>`}</div>
      ${pages > 1 ? `<div class="row small" style="margin-top:8px"><button class="btn sm" data-pp="prev" ${r.page <= 1 ? "disabled" : ""}>←</button><span>${r.page}/${pages}</span><button class="btn sm" data-pp="next" ${r.page >= pages ? "disabled" : ""}>→</button></div>` : ""}`;
    const redraw = (reload = true) => mount(box, { ...opts, reload });
    const go = () => { P.page = 1; redraw(); };
    const el = (k) => $(`[data-pp="${k}"]`, box);
    el("go").onclick = () => { P.q = el("q").value.trim(); go(); };
    el("q").onkeydown = (e) => { if (e.key === "Enter") { P.q = e.target.value.trim(); go(); } };
    $$("[data-crumb]", box).forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (!a.dataset.crumb) P.category = ""; P.subcategory = ""; go(); }));
    $$("[data-cat]", box).forEach((a) => (a.onclick = () => { if (!P.category) P.category = a.dataset.cat; else P.subcategory = a.dataset.cat; go(); }));
    $$("[data-flt]", box).forEach((c) => (c.onclick = () => { const k = c.dataset.flt; f[k] = k === "inStock" ? f.inStock === false : !f[k]; go(); }));
    el("pmin").onchange = (e) => { f.priceMin = e.target.value; go(); };
    el("pmax").onchange = (e) => { f.priceMax = e.target.value; go(); };
    $$("[data-facet]", box).forEach((s) => (s.onchange = () => { f.attrs[s.dataset.facet] = s.value ? [s.value] : []; go(); }));
    if (el("clear")) el("clear").onclick = (e) => { e.preventDefault(); f.attrs = {}; go(); };
    if (el("prev")) el("prev").onclick = () => { P.page--; redraw(); };
    if (el("next")) el("next").onclick = () => { P.page++; redraw(); };
    $$("[data-add]", box).forEach((b) => (b.onclick = () => {
      const p = cache[market][b.dataset.add];
      if (sel) sel.onChange([...sel.ids(), b.dataset.add]);
      opts.onAdd?.(p || { id: b.dataset.add });
      redraw(false);
    }));
    if (sel) {
      $$("[data-pp-rm]", box).forEach((b) => (b.onclick = () => { const ids = sel.ids().slice(); ids.splice(+b.dataset.ppRm, 1); sel.onChange(ids); redraw(false); }));
      enableReorder($(".pp-selected", box), ".pp-sel", (from, to) => { const ids = sel.ids().slice(); const [m] = ids.splice(from, 1); ids.splice(to, 0, m); sel.onChange(ids); redraw(false); });
    }
  }

  window.FF.ProductPicker = { mount, newState, fetchIds, categories, cache, fmt, enableReorder, MARKETS };
})();
