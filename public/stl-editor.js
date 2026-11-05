/* FeedForge — Shop the Look editor (modules for the SFCC storefront, products from the FeedForge feed). */
(() => {
  "use strict";
  const { $, $$, esc, toast, guard, ask, api, VIEWS, ProductPicker: PP } = window.FF;

  const MARKETS = { pt: "PT", es: "ES" };
  const PAGES = { homepage: "Homepage", plp: "PLP", pdp: "PDP" };
  const TONES = { "": "Branco (Novo)", brand: "Amarelo (marca)", success: "Verde (sustentável)" };
  const FONTS = ["Regular:400", "Medium:500", "SemiBold:600"].map((f) => { const [n, w] = f.split(":"); return `@font-face{font-family:Gilroy;font-weight:${w};src:url("https://www.homastores.com/mobify/bundle/106/static/fonts/gilroy/Gilroy${n}.woff2") format("woff2")}`; }).join("");

  const ST = {
    mod: null, saved: "", tab: "modulo", device: "desktop", moving: false,
    pcache: PP.cache,                      // shared ProductPicker cache: id -> product (null = not in the feed)
    picker: PP.newState(),
    assets: null, frame: null, exported: "",
  };

  const blank = () => ({ name: "Novo Shop the Look", market: "pt", page: "homepage", status: "draft", eyebrow: "Shop the look", title: "", image: { src: "", alt: "" }, blockColor: "#dfdbd2", cta: { show: true, text: "Ver todos os produtos", url: "", x: 50, y: 92 }, popoverCta: "Ver produto", activeIndex: 0, products: [] });
  const dirty = () => ST.mod && JSON.stringify(ST.mod) !== ST.saved;
  const fmt = PP.fmt;
  const get = (o, path) => path.split(".").reduce((a, k) => a?.[k], o);
  const set = (o, path, v) => { const ks = path.split("."); const last = ks.pop(); ks.reduce((a, k) => (a[k] ||= {}), o)[last] = v; };

  async function assets() {
    if (!ST.assets) {
      const [css, js] = await Promise.all(["/stl/widget.css", "/stl/widget.js"].map((u) => fetch(u, { cache: "no-cache" }).then((r) => r.text())));
      ST.assets = { css, js };
    }
    return ST.assets;
  }

  // ------------------------------------------------------------------ feed data
  const fetchIds = PP.fetchIds; // /api/products?ids= (shared with Page Builder)

  // same shape as /api/stl/render (server) — used for the live preview
  function hydrateLocal() {
    const m = ST.mod, cache = ST.pcache[m.market];
    return {
      id: m.id || "stl-preview", locale: m.market === "es" ? "es-ES" : "pt-PT", currency: "EUR",
      eyebrow: m.eyebrow, title: m.title, image: m.image, blockColor: m.blockColor, cta: m.cta, popoverCta: m.popoverCta, activeIndex: m.activeIndex,
      products: m.products.map((ref) => {
        const p = cache[ref.id];
        if (!p) return { id: ref.id, name: ref.id, description: "", price: 0, listPrice: null, image: "", url: "#", badges: ref.badges, pin: ref.pin, missing: true, ...(p === undefined ? { loading: true } : {}) };
        return { id: p.id, name: p.title, description: p.description, price: p.salePrice ?? p.price ?? 0, listPrice: p.salePrice ? p.price : null, image: p.image, url: p.link, badges: ref.badges, pin: ref.pin, ...(p.inStock ? {} : { oos: true }) };
      }),
    };
  }

  // ------------------------------------------------------------------ list of modules
  VIEWS.stl = async (main) => {
    if (ST.mod) return drawEditor(main);
    const list = (await guard(() => api("/stl/modules"))) || [];
    main.innerHTML = `
      <div class="head"><div><h1>Shop the Look</h1><div class="muted">Módulos para o site novo (homastores.com, PT e ES) com produtos do feed do FeedForge. Exporta o código para um bloco HTML do Page Designer.</div></div>
        <div class="row"><button class="btn primary" id="stl-new">＋ Novo Shop the Look</button></div></div>
      <div class="card">${list.length ? `<table><tr><th>Módulo</th><th>Mercado</th><th>Página</th><th>Estado</th><th>Produtos</th><th>Atualizado</th><th></th></tr>
        ${list.map((m) => `<tr class="click" data-open="${esc(m.id)}"><td><b>${esc(m.name)}</b><div class="small muted mono">${esc(m.id)}</div></td><td>${esc(MARKETS[m.market] || m.market)}</td><td>${esc(PAGES[m.page] || m.page)}</td>
          <td><span class="badge ${m.status === "live" ? "new" : "edit"}">${m.status === "live" ? "live" : "rascunho"}</span></td><td>${m.products}</td><td class="small">${esc((m.updatedAt || "").slice(0, 16).replace("T", " "))}</td>
          <td style="white-space:nowrap"><button class="btn sm" data-dup="${esc(m.id)}">Duplicar</button> <button class="btn sm ghost danger" data-del="${esc(m.id)}">✕</button></td></tr>`).join("")}</table>`
        : `<div class="empty">Ainda não há módulos. Cria o primeiro com “Novo Shop the Look”.</div>`}</div>`;
    $("#stl-new").onclick = () => openModule(null, main);
    $$("tr[data-open]", main).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest("button")) return; openModule(tr.dataset.open, main); }));
    $$("[data-dup]", main).forEach((b) => (b.onclick = () => guard(async () => { await api(`/stl/modules/${b.dataset.dup}/duplicate`, { method: "POST" }); toast("Módulo duplicado"); VIEWS.stl(main); }, b)));
    $$("[data-del]", main).forEach((b) => (b.onclick = async () => { if (await ask("Apagar este módulo? O código já colado no site não é afetado.", { ok: "Apagar", danger: true })) guard(async () => { await api(`/stl/modules/${b.dataset.del}`, { method: "DELETE" }); VIEWS.stl(main); }); }));
  };

  async function openModule(id, main) {
    await guard(async () => {
      const m = id ? await api(`/stl/modules/${id}`) : blank();
      ST.mod = m; ST.saved = id ? JSON.stringify(m) : ""; ST.tab = "modulo"; ST.moving = false; ST.exported = "";
      ST.picker = { ...ST.picker, q: "", category: "", subcategory: "", page: 1, result: null };
      await fetchIds(m.market, m.products.map((p) => p.id)).catch((e) => toast(e.message, true));
      drawEditor(main);
    });
  }

  // ------------------------------------------------------------------ editor
  function drawEditor(main) {
    const m = ST.mod;
    main.innerHTML = `
      <style>
        .stl-layout{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:16px;align-items:start}
        .stl-preview{position:sticky;top:12px}
        .stl-frame-wrap{background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;justify-content:center}
        .stl-frame-wrap.mobile{background:var(--soft);padding:12px 0}
        .stl-frame-wrap iframe{border:0;width:100%;display:block;background:#fff}
        .stl-frame-wrap.mobile iframe{width:375px;box-shadow:0 0 0 1px var(--line)}
        .stl-panel{max-height:calc(100vh - 120px);overflow:auto}
        .stl-item img{width:56px;height:56px;object-fit:cover;border-radius:6px;background:var(--soft);flex:0 0 auto}
        .stl-item{border:1px solid var(--line);border-radius:8px;padding:8px;background:#fff;margin-bottom:8px}
        .stl-item.drag-over{border-color:var(--accent)}
        .stl-item .handle{cursor:grab;color:var(--muted);user-select:none;padding:0 4px}
        .stl-item input[type=range]{flex:1}
      </style>
      <div class="head"><div><a href="#" id="stl-back" class="small">← Shop the Look</a><h1 style="margin:4px 0 0">${esc(m.name)}</h1>
        <div class="small muted">${m.id ? `<span class="mono">${esc(m.id)}</span> · ` : ""}${esc(MARKETS[m.market])} · ${esc(PAGES[m.page])} · ${m.status === "live" ? "live" : "rascunho"}<span id="stl-dirty"></span></div></div>
        <div class="row">${m.id ? `<button class="btn" id="stl-dup">Duplicar</button><button class="btn ghost danger" id="stl-del">Apagar</button>` : ""}<button class="btn primary" id="stl-save">Guardar</button></div></div>
      <div class="stl-layout">
        <div class="stl-preview">
          <div class="row" style="margin-bottom:8px">
            <div class="chips"><span class="chip ${ST.device === "desktop" ? "on" : ""}" data-dev="desktop">Desktop</span><span class="chip ${ST.device === "mobile" ? "on" : ""}" data-dev="mobile">Mobile 375px</span></div>
            <span class="grow"></span>
            <label class="chk small"><input type="checkbox" id="stl-move" ${ST.moving ? "checked" : ""}/> Mover pins (arrasta os pins na imagem)</label>
          </div>
          <div class="stl-frame-wrap ${ST.device}"><iframe id="stl-frame" title="Pré-visualização Shop the Look" scrolling="no"></iframe></div>
          <p class="small muted" id="stl-warn" style="margin-top:6px"></p>
        </div>
        <div class="card stl-panel">
          <div class="chips" style="margin-bottom:12px">${[["modulo", "Módulo"], ["produtos", `Produtos · ${m.products.length}`], ["exportar", "Exportar"]].map(([k, l]) => `<span class="chip ${ST.tab === k ? "on" : ""}" data-tab="${k}">${l}</span>`).join("")}</div>
          <div id="stl-tab"></div>
        </div>
      </div>`;
    $("#stl-back").onclick = async (e) => { e.preventDefault(); if (dirty() && !(await ask("Há alterações por guardar. Sair mesmo assim?", { ok: "Sair" }))) return; ST.mod = null; VIEWS.stl(main); };
    $("#stl-save").onclick = (e) => guard(() => save(main), e.target);
    if ($("#stl-dup")) $("#stl-dup").onclick = (e) => guard(async () => { if (dirty()) await save(main, true); const c = await api(`/stl/modules/${m.id}/duplicate`, { method: "POST" }); toast("Duplicado — a editar a cópia"); openModule(c.id, main); }, e.target);
    if ($("#stl-del")) $("#stl-del").onclick = async () => { if (await ask("Apagar este módulo?", { ok: "Apagar", danger: true })) guard(async () => { await api(`/stl/modules/${m.id}`, { method: "DELETE" }); ST.mod = null; VIEWS.stl(main); }); };
    $$("[data-dev]", main).forEach((c) => (c.onclick = () => { ST.device = c.dataset.dev; drawEditor(main); }));
    $("#stl-move").onchange = (e) => { ST.moving = e.target.checked; preview(); };
    $$("[data-tab]", main).forEach((c) => (c.onclick = () => { ST.tab = c.dataset.tab; drawEditor(main); }));
    buildFrame();
    drawTab(main);
    markDirty();
  }

  function markDirty() { const el = $("#stl-dirty"); if (el) el.innerHTML = dirty() ? ` · <b style="color:var(--warn)">alterações por guardar</b>` : ""; }

  async function save(main, quiet = false) {
    const m = ST.mod;
    const res = m.id ? await api(`/stl/modules/${m.id}`, { method: "PUT", body: m }) : await api("/stl/modules", { method: "POST", body: m });
    ST.mod = res; ST.saved = JSON.stringify(res);
    if (!quiet) { toast("Guardado"); drawEditor(main); }
  }

  // ------------------------------------------------------------------ preview (iframe = real widget, so the 767px media query works at 375px)
  async function buildFrame() {
    const { css, js } = await assets();
    const f = $("#stl-frame");
    if (!f) return;
    f.srcdoc = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${FONTS}body{margin:0;background:#fff}${css}
      body.moving .hstl__pin{cursor:move;touch-action:none} body.moving .hstl__pop{pointer-events:none!important}</style></head>
      <body><section class="hstl" id="stl-p" aria-label="Shop the Look"></section><script>${js.replace(/<\/script/gi, "<\\/script")}<\/script></body></html>`;
    f.onload = () => { ST.frame = f; preview(); const ro = new f.contentWindow.ResizeObserver(() => { f.style.height = f.contentDocument.body.scrollHeight + "px"; }); ro.observe(f.contentDocument.body); };
  }

  let pv = 0;
  function preview() {
    clearTimeout(pv);
    pv = setTimeout(() => {
      const f = ST.frame;
      if (!f || !f.contentWindow?.HomaShopTheLook || !ST.mod) return;
      const cfg = hydrateLocal();
      const sec = f.contentDocument.getElementById("stl-p");
      f.contentWindow.HomaShopTheLook.mount(sec, cfg);
      f.contentDocument.body.classList.toggle("moving", ST.moving);
      if (ST.moving) enablePinDrag(f, sec, cfg);
      const miss = cfg.products.filter((p) => p.missing && !p.loading).map((p) => p.id), oos = cfg.products.filter((p) => p.oos).map((p) => p.id);
      const w = $("#stl-warn");
      if (w) w.innerHTML = [miss.length ? `⚠ Fora do feed (escondidos): ${miss.map(esc).join(", ")}` : "", oos.length ? `⚠ Sem stock (escondidos): ${oos.map(esc).join(", ")}` : ""].filter(Boolean).join(" · ");
    }, 120);
  }

  // drag pins on the image; positions stored in % (responsive)
  function enablePinDrag(f, sec, cfg) {
    const visible = cfg.products.map((p, i) => (!p.missing && !p.oos ? i : -1)).filter((i) => i >= 0); // widget index -> module index
    const stage = sec.querySelector(".hstl__stage");
    sec.querySelectorAll(".hstl__pin").forEach((pin) => {
      pin.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        const mi = visible[+pin.dataset.i];
        pin.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const r = stage.getBoundingClientRect();
          const x = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)), y = Math.max(0, Math.min(100, ((ev.clientY - r.top) / r.height) * 100));
          pin.style.left = x + "%"; pin.style.top = y + "%";
          ST.mod.products[mi].pin.x = Math.round(x * 10) / 10; ST.mod.products[mi].pin.y = Math.round(y * 10) / 10;
        };
        const up = () => { pin.removeEventListener("pointermove", move); pin.removeEventListener("pointerup", up); markDirty(); preview(); if (ST.tab === "produtos") drawLook(); };
        pin.addEventListener("pointermove", move); pin.addEventListener("pointerup", up);
      }, { capture: true });
      pin.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }, { capture: true });
    });
  }

  const changed = () => { markDirty(); preview(); };

  // ------------------------------------------------------------------ tabs
  function drawTab(main) {
    const box = $("#stl-tab");
    if (ST.tab === "modulo") return drawModulo(box, main);
    if (ST.tab === "produtos") return drawProdutos(box);
    return drawExport(box);
  }

  function drawModulo(box, main) {
    const m = ST.mod;
    const inp = (k, label, extra = "") => `<label class="f">${label}<input data-k="${k}" value="${esc(get(m, k) ?? "")}" ${extra}/></label>`;
    box.innerHTML = `<div class="form">
      ${inp("name", "Nome do módulo")}
      <div class="grid two">
        <label class="f">Mercado<select data-k="market">${Object.entries(MARKETS).map(([k, l]) => `<option value="${k}" ${m.market === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="f">Página<select data-k="page">${Object.entries(PAGES).map(([k, l]) => `<option value="${k}" ${m.page === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <label class="f">Estado<select data-k="status"><option value="draft" ${m.status !== "live" ? "selected" : ""}>Rascunho</option><option value="live" ${m.status === "live" ? "selected" : ""}>Live (já no site)</option></select></label>
      ${inp("image.src", "Imagem principal (URL)", 'placeholder="https://www.homastores.com/dw/image/…"')}
      <div class="small muted" id="stl-img-info">Recomendado 1475×1080 (≈ 1,37:1).</div>
      ${inp("image.alt", "Texto alternativo da imagem")}
      <div class="grid two">${inp("eyebrow", "Eyebrow")}${inp("title", "Título")}</div>
      <label class="f">Color Block<span class="row"><input type="color" data-k="blockColor" value="${esc(m.blockColor)}" style="width:48px;padding:2px"/><input data-k="blockColor" value="${esc(m.blockColor)}" style="flex:1"/></span></label>
      <div class="card" style="padding:10px 12px">
        <label class="chk"><input type="checkbox" data-k="cta.show" ${m.cta.show ? "checked" : ""}/> CTA na imagem</label>
        <div class="grid two" style="margin-top:8px">${inp("cta.text", "Texto")}${inp("cta.url", "Link")}</div>
        <div class="grid two">${inp("cta.x", "Posição X (%)", 'type="number" min="0" max="100" step="0.5"')}${inp("cta.y", "Posição Y (%)", 'type="number" min="0" max="100" step="0.5"')}</div>
      </div>
      ${inp("popoverCta", "Texto do link no popover")}
      <label class="f">Produto ativo ao abrir<select data-k="activeIndex" data-num="1">${m.products.length ? m.products.map((p, i) => `<option value="${i}" ${m.activeIndex === i ? "selected" : ""}>${i + 1}. ${esc(ST.pcache[m.market][p.id]?.title || p.id)}</option>`).join("") : `<option value="0">— adiciona produtos —</option>`}</select></label>
    </div>`;
    const imgInfo = () => {
      const src = m.image.src, el = $("#stl-img-info");
      if (!src) { el.innerHTML = "Recomendado 1475×1080 (≈ 1,37:1)."; return; }
      const im = new Image();
      im.onload = () => { const r = im.naturalWidth / im.naturalHeight; el.innerHTML = `<img src="${esc(src)}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-bottom:4px"/><br>${im.naturalWidth}×${im.naturalHeight} (${r.toFixed(2).replace(".", ",")}:1) ${Math.abs(r - 1475 / 1080) > 0.08 ? `<span style="color:var(--warn)">— diferente de 1,37:1, a imagem vai ser recortada</span>` : "✓"}`; };
      im.onerror = () => { el.innerHTML = `<span style="color:var(--bad)">Não foi possível carregar a imagem.</span>`; };
      im.src = src;
    };
    imgInfo();
    $$("[data-k]", box).forEach((el) => {
      const ev = el.type === "checkbox" || el.tagName === "SELECT" || el.type === "color" ? "change" : "input";
      el.addEventListener(ev, async () => {
        const k = el.dataset.k;
        let v = el.type === "checkbox" ? el.checked : el.value;
        if (["cta.x", "cta.y"].includes(k) || el.dataset.num) v = Number(v);
        const prevMarket = m.market;
        set(m, k, v);
        if (k === "blockColor") $$('[data-k="blockColor"]', box).forEach((o) => { if (o !== el) o.value = v; });
        if (k === "image.src") imgInfo();
        if (k === "name") $("h1", main).textContent = v || "—";
        if (k === "market" && v !== prevMarket) { ST.picker = { ...ST.picker, category: "", subcategory: "", page: 1, result: null }; await guard(() => fetchIds(v, m.products.map((p) => p.id))); }
        changed();
      });
    });
  }

  // ---------- products tab: picker + look
  function drawProdutos(box) {
    box.innerHTML = `<h3 style="margin:0 0 8px">Produtos do look <span class="muted small">(arrasta para ordenar o carrossel)</span></h3><div id="stl-look"></div>
      <h3 style="margin:16px 0 8px">Adicionar produtos <span class="muted small">feed ${esc(MARKETS[ST.mod.market])}</span></h3><div id="stl-picker"></div>`;
    drawLook();
    drawPicker();
  }

  function drawLook() {
    const box = $("#stl-look");
    if (!box) return;
    const m = ST.mod, cache = ST.pcache[m.market];
    if (!m.products.length) { box.innerHTML = `<p class="muted small">Ainda sem produtos. Procura em baixo e carrega em “Adicionar ao look”.</p>`; return; }
    box.innerHTML = m.products.map((ref, i) => {
      const p = cache[ref.id];
      const warn = p === null ? `<span class="badge ex">fora do feed</span>` : p && !p.inStock ? `<span class="badge flag">sem stock</span>` : "";
      return `<div class="stl-item" data-i="${i}">
        <div class="row" style="flex-wrap:nowrap"><span class="handle" title="Arrastar">⠿</span>${p?.image ? `<img src="${esc(p.image)}" alt=""/>` : `<img alt=""/>`}
          <div style="min-width:0;flex:1"><div class="small" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p?.title || ref.id)}</div>
            <div class="small muted"><span class="mono">${esc(ref.id)}</span> · ${p ? `${fmt(p.salePrice ?? p.price, m.market)}${p.salePrice ? ` <s>${fmt(p.price, m.market)}</s>` : ""}` : ""} ${warn}</div></div>
          <button class="btn sm ghost danger" data-rm="${i}" title="Remover">✕</button></div>
        <div class="row small" style="margin-top:6px"><label class="chk"><input type="checkbox" data-pin="${i}" ${ref.pin.show !== false ? "checked" : ""}/> Pin</label>
          <span>X</span><input type="range" min="0" max="100" step="0.5" value="${ref.pin.x}" data-px="${i}"/><input type="number" min="0" max="100" step="0.5" value="${ref.pin.x}" data-pxn="${i}" style="width:64px"/>
        </div>
        <div class="row small"><span style="width:38px"></span><span>Y</span><input type="range" min="0" max="100" step="0.5" value="${ref.pin.y}" data-py="${i}"/><input type="number" min="0" max="100" step="0.5" value="${ref.pin.y}" data-pyn="${i}" style="width:64px"/></div>
        <div class="small" style="margin-top:4px">${(ref.badges || []).map((b, j) => `<div class="row" style="margin-top:4px"><input value="${esc(b.label)}" data-bl="${i}:${j}" placeholder="Etiqueta" style="flex:1"/><select data-bt="${i}:${j}">${Object.entries(TONES).map(([t, l]) => `<option value="${t}" ${(b.tone || "") === t ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn sm ghost" data-brm="${i}:${j}">✕</button></div>`).join("")}
          ${(ref.badges || []).length < 3 ? `<button class="btn sm ghost" data-badd="${i}" style="margin-top:4px">＋ Badge</button>` : ""}</div>
      </div>`;
    }).join("");
    const upd = () => { changed(); };
    $$("[data-rm]", box).forEach((b) => (b.onclick = () => { m.products.splice(+b.dataset.rm, 1); m.activeIndex = Math.min(m.activeIndex, Math.max(0, m.products.length - 1)); drawLook(); drawPicker(false); upd(); refreshTabLabel(); }));
    $$("[data-pin]", box).forEach((c) => (c.onchange = () => { m.products[+c.dataset.pin].pin.show = c.checked; upd(); }));
    const pinNum = (axis, i, v) => { v = Math.max(0, Math.min(100, Number(v) || 0)); m.products[i].pin[axis] = v; $(`[data-p${axis}="${i}"]`, box).value = v; $(`[data-p${axis}n="${i}"]`, box).value = v; upd(); };
    for (const axis of ["x", "y"]) {
      $$(`[data-p${axis}]`, box).forEach((r) => (r.oninput = () => pinNum(axis, +r.getAttribute(`data-p${axis}`), r.value)));
      $$(`[data-p${axis}n]`, box).forEach((r) => (r.oninput = () => pinNum(axis, +r.getAttribute(`data-p${axis}n`), r.value)));
    }
    $$("[data-bl]", box).forEach((el) => (el.oninput = () => { const [i, j] = el.dataset.bl.split(":").map(Number); m.products[i].badges[j].label = el.value; upd(); }));
    $$("[data-bt]", box).forEach((el) => (el.onchange = () => { const [i, j] = el.dataset.bt.split(":").map(Number); if (el.value) m.products[i].badges[j].tone = el.value; else delete m.products[i].badges[j].tone; upd(); }));
    $$("[data-brm]", box).forEach((el) => (el.onclick = () => { const [i, j] = el.dataset.brm.split(":").map(Number); m.products[i].badges.splice(j, 1); drawLook(); upd(); }));
    $$("[data-badd]", box).forEach((el) => (el.onclick = () => { const i = +el.dataset.badd; (m.products[i].badges ||= []).push({ label: "Novo" }); drawLook(); upd(); }));
    // drag to reorder (carousel order) — only the ⠿ handle starts a drag, so the sliders keep working
    PP.enableReorder(box, ".stl-item", (from, to) => {
      const activeId = m.products[m.activeIndex]?.id;
      const [moved] = m.products.splice(from, 1);
      m.products.splice(to, 0, moved);
      m.activeIndex = Math.max(0, m.products.findIndex((p) => p.id === activeId));
      drawLook(); upd();
    });
  }

  function refreshTabLabel() { const c = $('[data-tab="produtos"]'); if (c) c.textContent = `Produtos · ${ST.mod.products.length}`; }

  // shared ProductPicker (public/product-picker.js) — the look list above keeps pins/badges
  function drawPicker(reload = true) {
    const m = ST.mod;
    return PP.mount($("#stl-picker"), {
      market: m.market, state: ST.picker, reload,
      isSelected: (id) => m.products.some((p) => p.id === id),
      addLabel: "Adicionar ao look", selectedLabel: "✓ no look",
      onAdd: (p) => {
        const n = m.products.length;
        m.products.push({ id: p.id, pin: { x: 20 + ((n * 13) % 60), y: 30 + ((n * 17) % 50), show: true }, badges: [] });
        drawLook(); changed(); refreshTabLabel();
      },
    });
  }

  // ---------- export
  function drawExport(box) {
    box.innerHTML = `<p class="small muted">O site não consegue chamar o FeedForge, por isso o código leva os produtos já resolvidos com os preços, imagens e links do feed de agora. Volta a gerar quando os preços mudarem.</p>
      <div class="row"><button class="btn primary" id="stl-gen">Gerar código</button><button class="btn" id="stl-json">Copiar JSON</button><label class="chk small"><input type="checkbox" id="stl-assets" checked/> Incluir CSS + JS (1.º Shop the Look da página)</label></div>
      <div id="stl-val" style="margin-top:10px"></div>
      <textarea id="stl-code" rows="14" readonly style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:11px;margin-top:8px;${ST.exported ? "" : "display:none"}">${esc(ST.exported)}</textarea>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="stl-copy" ${ST.exported ? "" : "hidden"}>Copiar código</button></div>
      <p class="small muted" style="margin-top:10px">No Page Designer: adiciona um bloco HTML/Custom na página e cola o código. Eventos GA4 no dataLayer: <code>stl_pin_select</code>, <code>stl_product_click</code>.</p>`;
    const resolve = async () => {
      const cfg = await api("/stl/render", { method: "POST", body: ST.mod });
      for (const p of cfg.products) if (p.missing) ST.pcache[ST.mod.market][p.id] = null;
      const v = window.hstlValidate(ST.mod, cfg);
      $("#stl-val").innerHTML = (v.errors.length ? `<div class="callout" style="border-color:#e8b4b4;background:#fbeeee">${v.errors.map((e) => `✕ ${esc(e)}`).join("<br>")}</div>` : `<div class="callout info">✓ Pronto para exportar</div>`) + (v.warnings.length ? `<div class="small" style="color:var(--warn);margin-top:6px">${v.warnings.map((w) => `⚠ ${esc(w)}`).join("<br>")}</div>` : "");
      return { cfg, v };
    };
    $("#stl-gen").onclick = (e) => guard(async () => {
      const { cfg, v } = await resolve();
      if (!v.ok) return toast("Corrige os erros antes de exportar", true);
      const { css, js } = await assets();
      ST.exported = window.hstlSnippet({ css, js, config: cfg, name: ST.mod.name, includeAssets: $("#stl-assets").checked });
      const ta = $("#stl-code"); ta.value = ST.exported; ta.style.display = ""; $("#stl-copy").hidden = false;
      toast(dirty() ? "Código gerado (lembra-te de guardar o módulo)" : "Código gerado");
    }, e.target);
    $("#stl-json").onclick = (e) => guard(async () => { const { cfg } = await resolve(); await navigator.clipboard.writeText(JSON.stringify(cfg, null, 2)); toast("JSON copiado"); }, e.target);
    $("#stl-copy").onclick = async () => { await navigator.clipboard.writeText($("#stl-code").value); toast("Código copiado"); };
  }
})();
