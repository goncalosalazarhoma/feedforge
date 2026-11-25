/* FeedForge — Folhetos editor: the promotional flyer (PDF) as a shoppable block for SFCC Page Designer (Raw HTML).
   PDF → page images (pdf.js, in the browser) → hotspots (dot + card, or clickable area) linked to SKUs → static HTML + CSS
   (public/folhetos/render.mjs, same renderer for preview and export). Product data: live SFCC every 2 h (netlify/lib/live.mjs),
   feed as fallback. The block cannot refresh itself on the site, so the editor flags when the exported code is out of date. */
(() => {
  "use strict";
  const { $, $$, esc, toast, guard, ask, api, VIEWS, ProductPicker: PP } = window.FF;

  const MARKETS = { pt: "PT", es: "ES" };
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  const IMG_W = 1400; // page image width (px) for the site (2 pages side by side on desktop ≈ 700 px each, sharp on retina)
  const OK_HOSTS = [/(^|\.)homastores\.com$/, /\.demandware\.net$/, /\.commercecloud\.salesforce\.com$/, /(^|\.)amazonaws\.com$/, /(^|\.)homa\.pt$/]; // = folhetos.mjs ALLOWED_IMG (site CSP)
  const FONTS = ["Regular:400", "Medium:500"].map((f) => { const [n, w] = f.split(":"); return `@font-face{font-family:Gilroy;font-weight:${w};src:url("https://www.homastores.com/mobify/bundle/106/static/fonts/gilroy/Gilroy${n}.woff2") format("woff2")}`; }).join("");
  const ALERT = { price: "preço ≠ impresso", oos: "esgotado", missing: "inativo / não encontrado" };

  const ST = {
    f: null, saved: "", status: null, render: null, tab: "folheto", page: 1, sel: -1, mode: "dot", device: "desktop",
    imgs: {}, pdfInfo: "", picker: PP.newState(), assets: null, exported: "",
  };
  const blank = () => ({ name: "Novo folheto", market: "pt", validFrom: "", validTo: "", pdfUrl: "", imagePattern: "", title: "", pageCount: 0, pages: [], hotspots: [] });
  const dirty = () => ST.f && JSON.stringify(ST.f) !== ST.saved;
  const hid = () => `h${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
  const r2 = (v) => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n) => PP.fmt(n, ST.f?.market);
  const hostOk = (p) => { try { const u = new URL(p.replace("{n}", "1")); return u.protocol === "https:" && OK_HOSTS.some((re) => re.test(u.hostname)); } catch { return false; } };
  const imgFor = (n) => ST.imgs[n] || (ST.f.imagePattern ? ST.f.imagePattern.replaceAll("{n}", String(n)) : "");
  const fmtDate = (s) => (s ? new Date(s).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—");

  function loadScript(src) {
    return new Promise((ok, ko) => {
      if ($(`script[src="${src}"]`)) return ok();
      const s = document.createElement("script"); s.src = src; s.onload = () => ok(); s.onerror = () => ko(new Error(`Não foi possível carregar ${src}`));
      document.head.appendChild(s);
    });
  }
  async function assets() {
    if (!ST.assets) {
      const [css, R] = await Promise.all([fetch("/folhetos/folheto.css", { cache: "no-cache" }).then((r) => r.text()), import("/folhetos/render.mjs")]);
      ST.assets = { css, render: R.renderFolheto };
    }
    return ST.assets;
  }

  // ------------------------------------------------------------------ products (server render = live SFCC > feed; new SKUs from the feed cache)
  function prod(sku) {
    if (!sku) return null;
    const s = ST.render?.products?.[sku];
    if (s) return s;
    const c = PP.cache[ST.f.market][sku];
    if (c === undefined) return { id: sku, loading: true, missing: true };
    if (c === null) return { id: sku, missing: true };
    return { id: c.id, name: c.title, price: c.salePrice ?? c.price, listPrice: c.salePrice ? c.price : null, image: c.image, url: c.link, inStock: c.inStock, path: c.path || [], source: "feed" };
  }
  async function loadSkus() {
    const need = [...new Set(ST.f.hotspots.map((h) => h.sku).filter((s) => s && !ST.render?.products?.[s]))];
    if (need.length) await PP.fetchIds(ST.f.market, need).catch((e) => toast(e.message, true));
  }
  const alertsFor = (sku) => (ST.status?.alerts || []).filter((a) => a.sku === sku);

  function localCfg() {
    const f = ST.f, products = {};
    for (const h of f.hotspots) if (h.sku && !products[h.sku]) products[h.sku] = prod(h.sku);
    return {
      id: f.id || "folheto-preview", name: f.name, title: f.title, market: f.market, locale: f.market === "es" ? "es-ES" : "pt-PT", currency: "EUR",
      pages: f.pages.map((p, i) => ({ n: i + 1, ratio: p.ratio, src: imgFor(i + 1) })), hotspots: f.hotspots, products,
    };
  }

  // ------------------------------------------------------------------ PDF → page images (pdf.js)
  async function pdfLib() {
    await loadScript(PDFJS + "pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
    return window.pdfjsLib;
  }
  async function fetchPdf(url) {
    try { // the PDF host may allow cross-origin reads…
      const r = await fetch(url, { mode: "cors" });
      if (r.ok) return await r.arrayBuffer();
    } catch {}
    const r = await api(`/folhetos/pdf?url=${encodeURIComponent(url)}`, { raw: true }); // …otherwise through the FeedForge proxy
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Erro ${r.status} ao ler o PDF`); }
    return r.arrayBuffer();
  }
  async function loadPdf(main, { keepPages = false } = {}) {
    const f = ST.f;
    if (!f.pdfUrl) return toast("Indica o URL do PDF", true);
    ST.pdfInfo = "A ler o PDF…"; info();
    const lib = await pdfLib();
    const doc = await lib.getDocument({ data: new Uint8Array(await fetchPdf(f.pdfUrl)) }).promise;
    const n = Math.min(doc.numPages, 80);
    const pages = [];
    ST.imgs = {};
    for (let i = 1; i <= n; i++) {
      ST.pdfInfo = `A gerar as imagens das páginas… ${i}/${n}`; info();
      const page = await doc.getPage(i);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: IMG_W / v1.width });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      // intent "print": pdf.js does not wait for requestAnimationFrame, so it keeps rendering when the tab is in the background
      await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
      ST.imgs[i] = c.toDataURL("image/jpeg", 0.8);
      pages.push({ ratio: Math.round((v1.width / v1.height) * 10000) / 10000 });
    }
    if (!keepPages || f.pageCount !== n) {
      f.pageCount = n; f.pages = pages;
      const out = f.hotspots.filter((h) => h.page > n).length;
      if (out) { f.hotspots = f.hotspots.filter((h) => h.page <= n); toast(`${out} hotspot(s) removidos (páginas que já não existem)`, true); }
    } else f.pages = pages;
    ST.page = clamp(ST.page, 1, Math.max(1, n));
    ST.pdfInfo = `PDF: ${n} página(s)${doc.numPages > 80 ? ` (máx. 80 de ${doc.numPages})` : ""} · imagens geradas neste browser`;
    drawEditor(main);
  }
  function info() { const el = $("#fol-pdfinfo"); if (el) el.textContent = ST.pdfInfo; }

  async function downloadZip(btn) {
    const n = ST.f.pageCount;
    if (!n || !ST.imgs[1]) return toast("Carrega primeiro o PDF (as imagens são geradas a partir dele)", true);
    btn.disabled = true;
    try {
      await loadScript(JSZIP);
      const zip = new window.JSZip();
      for (let i = 1; i <= n; i++) zip.file(`${i}.jpg`, ST.imgs[i].split(",")[1], { base64: true });
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${ST.f.id || "folheto"}-paginas.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------------ list
  VIEWS.folhetos = async (main) => {
    if (ST.f) return drawEditor(main);
    const [list, sfcc] = await Promise.all([guard(() => api("/folhetos")), api("/sfcc/status").catch(() => null)]);
    main.innerHTML = `
      <div class="head"><div><h1>Folhetos</h1><div class="muted">O folheto em PDF como bloco do site (Page Designer, Raw HTML): páginas lado a lado com produtos clicáveis. Preço e stock do SFCC a cada 2 h enquanto o folheto está em vigor.</div></div>
        <div class="row"><button class="btn primary" id="fol-new">＋ Novo folheto</button></div></div>
      ${sfcc && sfcc.missing?.length ? `<div class="callout" style="margin-bottom:12px">Falta configurar a ligação ao SFCC (${esc(sfcc.missing.join(", "))}) — sem ela os folhetos usam só os dados do feed.</div>` : ""}
      <div class="card">${(list || []).length ? `<table><tr><th>Folheto</th><th>Mercado</th><th>Validade</th><th>Páginas</th><th>Produtos</th><th>Dados SFCC</th><th>Alertas</th><th>Exportado</th><th></th></tr>
        ${list.map((s) => `<tr class="click" data-open="${esc(s.id)}"><td><b>${esc(s.name)}</b><div class="small muted mono">${esc(s.id)}</div></td><td>${esc(MARKETS[s.market] || s.market)}</td>
          <td class="small">${esc(s.validFrom || "…")} → ${esc(s.validTo || "…")}<br><span class="badge ${s.active ? "new" : ""}">${s.active ? "em vigor" : "fora de validade"}</span></td>
          <td>${s.pages}</td><td>${s.products}</td><td class="small">${fmtDate(s.liveAt)}</td><td>${s.alerts ? `<span class="badge flag">${s.alerts}</span>` : "—"}</td><td class="small">${fmtDate(s.exportedAt)}</td>
          <td><button class="btn sm ghost danger" data-del="${esc(s.id)}">✕</button></td></tr>`).join("")}</table>`
        : `<div class="empty">Ainda não há folhetos. Cria o primeiro com “Novo folheto”.</div>`}</div>`;
    $("#fol-new").onclick = () => openFolheto(null, main);
    $$("tr[data-open]", main).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest("button")) return; openFolheto(tr.dataset.open, main); }));
    $$("[data-del]", main).forEach((b) => (b.onclick = async () => { if (await ask("Apagar este folheto? O código já colado no site não é afetado, mas deixa de haver atualização de preços e alertas.", { ok: "Apagar", danger: true })) guard(async () => { await api(`/folhetos/${b.dataset.del}`, { method: "DELETE" }); VIEWS.folhetos(main); }); }));
  };

  async function openFolheto(id, main) {
    await guard(async () => {
      if (id) { const r = await api(`/folhetos/${id}`); apply(r); } else { ST.f = blank(); ST.saved = ""; ST.status = null; ST.render = null; }
      ST.imgs = {}; ST.page = 1; ST.sel = -1; ST.tab = "folheto"; ST.exported = ""; ST.pdfInfo = "";
      ST.picker = { ...ST.picker, q: "", category: "", subcategory: "", page: 1, result: null };
      await loadSkus();
      drawEditor(main);
      if (ST.f.pdfUrl) guard(() => loadPdf(main, { keepPages: true }));
    });
  }
  function apply(r) { ST.f = r.folheto; ST.saved = JSON.stringify(r.folheto); ST.status = r.status; ST.render = r.render; }

  async function save(main) {
    const f = ST.f;
    const r = f.id ? await api(`/folhetos/${f.id}`, { method: "PUT", body: f }) : await api("/folhetos", { method: "POST", body: f });
    apply(r);
    await loadSkus();
    toast(r.status.alerts.length ? `Guardado · ${r.status.alerts.length} alerta(s) nos dados do SFCC` : "Guardado · dados do SFCC atualizados");
    drawEditor(main);
  }

  // ------------------------------------------------------------------ editor
  function drawEditor(main) {
    const f = ST.f, st = ST.status;
    main.innerHTML = `
      <style>
        .fol-layout{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:16px;align-items:start}
        .fol-panel{max-height:calc(100vh - 110px);overflow:auto;min-width:0;position:sticky;top:12px}
        .fol-panel input,.fol-panel select{width:100%;box-sizing:border-box}
        .fol-panel label{display:block;font-size:12px;font-weight:600;margin:10px 0 4px}
        .fol-strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:10px}
        .fol-th{flex:0 0 74px;border:2px solid transparent;border-radius:6px;background:var(--soft);cursor:pointer;position:relative;padding:0;overflow:hidden}
        .fol-th.on{border-color:var(--accent)}
        .fol-th img{width:100%;display:block}
        .fol-th span{position:absolute;left:2px;bottom:2px;font-size:10px;background:#fff;border-radius:4px;padding:0 4px}
        .fol-stagewrap{display:flex;justify-content:center;background:var(--soft);border:1px solid var(--line);border-radius:var(--radius);padding:12px}
        .fol-stage{position:relative;width:min(100%, calc((100vh - 260px) * var(--r)));aspect-ratio:var(--r);background:#fff;user-select:none;touch-action:none;cursor:crosshair}
        .fol-stage>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}
        .fol-dot{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#fff;border:2px solid #181818;display:grid;place-items:center;font:600 11px/1 system-ui;cursor:grab;box-shadow:0 0 6px rgba(0,0,0,.35)}
        .fol-area{position:absolute;border:2px solid #181818;background:rgba(255,255,255,.18);cursor:grab;box-shadow:0 0 0 1px rgba(255,255,255,.7)}
        .fol-area b{position:absolute;left:2px;top:2px;background:#181818;color:#fff;font:600 10px/14px system-ui;padding:0 4px;border-radius:3px}
        .fol-area i{position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;background:#181818;border:2px solid #fff;cursor:nwse-resize}
        .fol-dot.bad,.fol-area.bad{border-color:#c62828}.fol-area.bad b{background:#c62828}
        .fol-dot.warn,.fol-area.warn{border-color:#d08700}.fol-area.warn b{background:#d08700}
        .fol-dot.on{background:#181818;color:#fff;outline:3px solid rgba(24,24,24,.25)}
        .fol-area.on{outline:3px solid rgba(24,24,24,.35);background:rgba(255,255,255,.3)}
        .fol-hs{display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:6px;background:#fff;margin-bottom:6px;cursor:pointer}
        .fol-hs.on{border-color:var(--accent)}
        .fol-hs img{width:40px;height:40px;object-fit:cover;border-radius:6px;background:var(--soft);flex:0 0 auto}
        .fol-frame{background:var(--soft);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;position:relative;height:420px}
        .fol-frame iframe{border:0;display:block;background:#fff;position:absolute;top:0;left:0;transform-origin:0 0;height:420px}
      </style>
      <div class="head"><div><a href="#" id="fol-back" class="small">← Folhetos</a><h1 style="margin:4px 0 0">${esc(f.name)}</h1>
        <div class="small muted">${f.id ? `<span class="mono">${esc(f.id)}</span> · ` : ""}${esc(MARKETS[f.market])} · ${esc(f.validFrom || "…")} → ${esc(f.validTo || "…")} · ${f.pageCount} página(s) · ${f.hotspots.length} hotspot(s)
          ${st ? ` · <span class="badge ${st.active ? "new" : ""}">${st.active ? "em vigor" : "fora de validade"}</span>` : ""}<span id="fol-dirty"></span></div></div>
        <div class="row">${f.id ? `<button class="btn ghost danger" id="fol-del">Apagar</button>` : ""}<button class="btn primary" id="fol-save">Guardar</button></div></div>
      ${st?.outdated ? `<div class="callout" style="margin-bottom:12px;border-color:#e0c48f;background:#fffaf0">⚠ Os dados mudaram desde a última exportação (${fmtDate(st.exportedAt)}): preço, stock ou produtos. <b>Gera o código e cola-o de novo no Page Designer</b> (separador Exportar).</div>` : ""}
      <div class="fol-layout">
        <div style="min-width:0">
          <div class="row" style="margin-bottom:8px">
            <div class="chips"><span class="chip ${ST.mode === "dot" ? "on" : ""}" data-mode="dot">● Ponto + cartão</span><span class="chip ${ST.mode === "area" ? "on" : ""}" data-mode="area">▭ Área clicável</span></div>
            <span class="grow"></span><span class="small muted">${ST.mode === "dot" ? "Clica na página para pôr um ponto; arrasta para mover." : "Arrasta na página para desenhar a área; o canto ajusta o tamanho."}</span>
          </div>
          ${f.pageCount ? `<div class="fol-strip">${f.pages.map((p, i) => { const n = i + 1, c = f.hotspots.filter((h) => h.page === n).length; return `<button class="fol-th ${ST.page === n ? "on" : ""}" data-pg="${n}" style="aspect-ratio:${p.ratio}">${imgFor(n) ? `<img src="${esc(imgFor(n))}" alt="" loading="lazy">` : ""}<span>${n}${c ? ` · ${c}` : ""}</span></button>`; }).join("")}</div>
            <div class="fol-stagewrap"><div class="fol-stage" id="fol-stage" style="--r:${f.pages[ST.page - 1]?.ratio || 0.7071}">${imgFor(ST.page) ? `<img src="${esc(imgFor(ST.page))}" alt="">` : ""}</div></div>`
          : `<div class="card empty">Indica o URL do PDF no separador Folheto e carrega-o: as páginas aparecem aqui para marcares os produtos.</div>`}
          <div class="row" style="margin:16px 0 8px"><b>Pré-visualização</b><span class="grow"></span>
            <div class="chips"><span class="chip ${ST.device === "desktop" ? "on" : ""}" data-dev="desktop">Desktop</span><span class="chip ${ST.device === "mobile" ? "on" : ""}" data-dev="mobile">Mobile 375</span></div></div>
          <div class="fol-frame ${ST.device}"><iframe id="fol-frame" title="Pré-visualização do folheto"></iframe></div>
          <p class="small muted" style="margin-top:6px">Igual ao que vai para o site (passa o rato nos pontos). Hotspots a vermelho não têm produto válido e não são exportados.</p>
        </div>
        <div class="card fol-panel">
          <div class="chips" style="margin-bottom:8px">${[["folheto", "Folheto"], ["hotspots", `Produtos · ${f.hotspots.length}`], ["dados", `Dados SFCC${st?.alerts?.length ? ` · ⚠ ${st.alerts.length}` : ""}`], ["exportar", "Exportar"]].map(([k, l]) => `<span class="chip ${ST.tab === k ? "on" : ""}" data-tab="${k}">${l}</span>`).join("")}</div>
          <div id="fol-tab"></div>
        </div>
      </div>`;
    $("#fol-back").onclick = async (e) => { e.preventDefault(); if (dirty() && !(await ask("Há alterações por guardar. Sair mesmo assim?", { ok: "Sair" }))) return; ST.f = null; VIEWS.folhetos(main); };
    $("#fol-save").onclick = (e) => guard(() => save(main), e.target);
    if ($("#fol-del")) $("#fol-del").onclick = async () => { if (await ask("Apagar este folheto?", { ok: "Apagar", danger: true })) guard(async () => { await api(`/folhetos/${f.id}`, { method: "DELETE" }); ST.f = null; VIEWS.folhetos(main); }); };
    $$("[data-mode]", main).forEach((c) => (c.onclick = () => { ST.mode = c.dataset.mode; drawEditor(main); }));
    $$("[data-pg]", main).forEach((b) => (b.onclick = () => { ST.page = +b.dataset.pg; ST.sel = -1; drawEditor(main); }));
    $$("[data-dev]", main).forEach((c) => (c.onclick = () => { ST.device = c.dataset.dev; $(".fol-frame").className = `fol-frame ${ST.device}`; $$("[data-dev]", main).forEach((o) => o.classList.toggle("on", o === c)); fitFrame(); }));
    $$("[data-tab]", main).forEach((c) => (c.onclick = () => { ST.tab = c.dataset.tab; drawEditor(main); }));
    drawStage(main);
    buildFrame();
    drawTab(main);
    markDirty();
  }

  function markDirty() { const el = $("#fol-dirty"); if (el) el.innerHTML = dirty() ? ` · <b style="color:var(--warn)">alterações por guardar</b>` : ""; }
  function changed(main, { stage = true, tab = false } = {}) {
    markDirty();
    if (stage) drawStage(main);
    if (tab) drawTab(main);
    preview();
  }

  // ------------------------------------------------------------------ hotspot stage (editor only; positions in % of the page)
  function spotClass(h, i) {
    const p = prod(h.sku);
    const bad = !h.sku || (p && p.missing && !p.loading);
    const warn = !bad && alertsFor(h.sku).length;
    return `${bad ? " bad" : warn ? " warn" : ""}${ST.sel === i ? " on" : ""}`;
  }
  function drawStage(main) {
    const stage = $("#fol-stage");
    if (!stage) return;
    $$(".fol-dot,.fol-area", stage).forEach((el) => el.remove());
    ST.f.hotspots.forEach((h, i) => {
      if (h.page !== ST.page) return;
      const el = document.createElement("div");
      el.dataset.i = i;
      const p = prod(h.sku);
      el.title = h.sku ? `${h.sku}${p?.name ? ` · ${p.name}` : ""}` : "sem produto";
      if (h.type === "area") { el.className = "fol-area" + spotClass(h, i); el.style.cssText = `left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%`; el.innerHTML = `<b>${i + 1}</b><i data-rs></i>`; }
      else { el.className = "fol-dot" + spotClass(h, i); el.style.cssText = `left:${h.x}%;top:${h.y}%`; el.textContent = i + 1; }
      stage.appendChild(el);
    });
    stage.onpointerdown = (e) => onPointer(e, stage, main);
  }

  function onPointer(e, stage, main) {
    if (e.button !== 0) return;
    const f = ST.f, box = stage.getBoundingClientRect();
    const at = (ev) => ({ x: clamp(((ev.clientX - box.left) / box.width) * 100, 0, 100), y: clamp(((ev.clientY - box.top) / box.height) * 100, 0, 100) });
    const start = at(e);
    const el = e.target.closest(".fol-dot,.fol-area");
    let h, mode, moved = false;
    if (el) {
      ST.sel = +el.dataset.i; h = f.hotspots[ST.sel];
      mode = e.target.matches("[data-rs]") ? "resize" : "move";
    } else if (ST.mode === "dot") {
      h = { id: hid(), page: ST.page, type: "dot", x: r2(start.x), y: r2(start.y), sku: "", printedPrice: null };
      f.hotspots.push(h); ST.sel = f.hotspots.length - 1; mode = "move"; moved = true;
    } else {
      h = { id: hid(), page: ST.page, type: "area", x: r2(start.x), y: r2(start.y), w: 0, h: 0, sku: "", printedPrice: null };
      f.hotspots.push(h); ST.sel = f.hotspots.length - 1; mode = "draw";
    }
    const orig = { ...h };
    stage.setPointerCapture(e.pointerId);
    drawStage(main);
    const move = (ev) => {
      const p = at(ev), dx = p.x - start.x, dy = p.y - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.3) moved = true;
      if (mode === "move") {
        const w = h.type === "area" ? h.w : 0, hh = h.type === "area" ? h.h : 0;
        h.x = r2(clamp(orig.x + dx, 0, 100 - w)); h.y = r2(clamp(orig.y + dy, 0, 100 - hh));
      } else if (mode === "resize") {
        h.w = r2(clamp(orig.w + dx, 1, 100 - h.x)); h.h = r2(clamp(orig.h + dy, 1, 100 - h.y));
      } else {
        h.x = r2(Math.min(start.x, p.x)); h.y = r2(Math.min(start.y, p.y)); h.w = r2(Math.abs(dx)); h.h = r2(Math.abs(dy));
      }
      const node = $(`[data-i="${ST.sel}"]`, stage);
      if (node) node.style.cssText = h.type === "area" ? `left:${h.x}%;top:${h.y}%;width:${h.w}%;height:${h.h}%` : `left:${h.x}%;top:${h.y}%`;
    };
    const up = () => {
      stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerup", up); stage.removeEventListener("pointercancel", up);
      if (mode === "draw" && (h.w < 1.5 || h.h < 1.5)) { f.hotspots.splice(ST.sel, 1); ST.sel = -1; toast("Arrasta para desenhar a área"); drawStage(main); return; }
      ST.tab = "hotspots";
      if (moved || mode === "draw") changed(main, { tab: true }); else { drawStage(main); drawTab(main); }
      $$("[data-tab]", main).forEach((c) => c.classList.toggle("on", c.dataset.tab === "hotspots"));
    };
    stage.addEventListener("pointermove", move); stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  }

  // ------------------------------------------------------------------ preview (same renderer as the export)
  function buildFrame() {
    const fr = $("#fol-frame"); if (!fr) return;
    fr.srcdoc = `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${FONTS}body{margin:0;padding:16px 0;background:#fff}</style></head><body><div id="root"></div></body></html>`;
    fr.onload = () => preview();
  }
  let pvT = null;
  function preview() {
    clearTimeout(pvT);
    pvT = setTimeout(async () => {
      const fr = $("#fol-frame"); const root = fr?.contentDocument?.getElementById("root");
      if (!root) return;
      const { css, render } = await assets();
      root.innerHTML = ST.f.pageCount ? render(localCfg(), { css, preview: true }) : `<p style="font:14px system-ui;color:#757575;text-align:center">Sem páginas ainda.</p>`;
      fitFrame();
    }, 120);
  }
  // the iframe gets the real device width (so the site's media queries apply) and is scaled down to fit the column
  const DEV_W = { desktop: 1280, mobile: 375 };
  function fitFrame() {
    const fr = $("#fol-frame"), wrap = $(".fol-frame"); const d = fr?.contentDocument;
    if (!d?.body || !wrap) return;
    const w = DEV_W[ST.device], avail = wrap.clientWidth, scale = Math.min(1, avail / w);
    fr.style.width = w + "px";
    fr.style.left = Math.max(0, (avail - w * scale) / 2) + "px";
    fr.style.transform = `scale(${scale})`;
    setTimeout(() => { const h = Math.max(200, d.documentElement.scrollHeight); fr.style.height = h + "px"; wrap.style.height = Math.ceil(h * scale) + "px"; }, 80);
  }

  // ------------------------------------------------------------------ right panel
  function drawTab(main) {
    const box = $("#fol-tab"); if (!box) return;
    ({ folheto: tabFolheto, hotspots: tabHotspots, dados: tabDados, exportar: tabExport })[ST.tab](box, main);
  }

  function tabFolheto(box, main) {
    const f = ST.f;
    const warnHost = f.imagePattern && !hostOk(f.imagePattern);
    box.innerHTML = `
      <label>Nome (interno; aparece no GA4 como “Folheto - nome”)</label><input data-k="name" value="${esc(f.name)}">
      <div class="grid two" style="gap:8px">
        <div><label>Mercado</label><select data-k="market">${Object.entries(MARKETS).map(([k, l]) => `<option value="${k}" ${f.market === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>Título no site (opcional)</label><input data-k="title" value="${esc(f.title)}"></div>
        <div><label>Válido de</label><input type="date" data-k="validFrom" value="${esc(f.validFrom)}"></div>
        <div><label>Até</label><input type="date" data-k="validTo" value="${esc(f.validTo)}"></div>
      </div>
      <p class="small muted" style="margin:4px 0 0">Os preços e o stock do SFCC são atualizados a cada 2 horas só dentro destas datas.</p>
      <label>URL do PDF</label>
      <div class="row"><input data-k="pdfUrl" value="${esc(f.pdfUrl)}" placeholder="https://…/folheto.pdf" style="flex:1"><button class="btn sm" id="fol-loadpdf">${ST.imgs[1] ? "Recarregar" : "Carregar"}</button></div>
      <p class="small muted" id="fol-pdfinfo" style="margin:4px 0 0">${esc(ST.pdfInfo)}</p>
      <label>Imagens das páginas no site (URL com {n} = nº da página)</label>
      <input data-k="imagePattern" value="${esc(f.imagePattern)}" placeholder="https://www.homastores.com/on/demandware.static/-/Library-Sites-…/folhetos/natal/{n}.jpg">
      ${warnHost ? `<div class="callout" style="margin-top:6px">⚠ O site só aceita imagens de homastores.com, demandware.net, commercecloud.salesforce.com ou amazonaws.com (política de segurança). Carrega as imagens na biblioteca do SFCC.</div>` : ""}
      ${f.imagePattern && !f.imagePattern.includes("{n}") ? `<div class="callout" style="margin-top:6px">⚠ Falta <code>{n}</code> no URL (é substituído por 1, 2, 3…).</div>` : ""}
      <p class="small muted" style="margin:6px 0 0">1. Carrega o PDF · 2. <a href="#" id="fol-zip">Descarrega as imagens (.zip)</a> e põe-nas numa pasta da biblioteca do SFCC (1.jpg, 2.jpg…) · 3. Cola aqui o URL de uma delas, trocando o número por <code>{n}</code>.</p>
      ${!ST.imgs[1] ? `<label>Nº de páginas (sem PDF carregado)</label><input type="number" min="0" max="80" data-k="pageCount" value="${f.pageCount}">` : ""}`;
    $$("[data-k]", box).forEach((el) => (el.onchange = () => {
      const k = el.dataset.k;
      if (k === "pageCount") {
        const n = clamp(Math.round(Number(el.value) || 0), 0, 80);
        f.pageCount = n; f.pages = Array.from({ length: n }, (_, i) => f.pages[i] || { ratio: 0.7071 });
        f.hotspots = f.hotspots.filter((h) => h.page <= n); ST.page = clamp(ST.page, 1, Math.max(1, n));
        return drawEditor(main);
      }
      f[k] = el.value.trim();
      if (k === "market") { PP.fetchIds(f.market, f.hotspots.map((h) => h.sku).filter(Boolean)).finally(() => drawEditor(main)); return; }
      if (k === "imagePattern" || k === "name") return drawEditor(main);
      changed(main, { stage: false });
    }));
    $("#fol-loadpdf").onclick = (e) => { f.pdfUrl = $('[data-k="pdfUrl"]', box).value.trim(); guard(() => loadPdf(main, { keepPages: !!f.pageCount }), e.target); };
    $("#fol-zip").onclick = (e) => { e.preventDefault(); downloadZip(e.target); };
  }

  function productLine(p, h) {
    if (!h.sku) return `<span class="badge ex">sem produto</span>`;
    if (!p || p.loading) return `<span class="muted">a carregar…</span>`;
    if (p.missing) return `<span class="badge ex">não encontrado</span>`;
    const al = alertsFor(h.sku);
    return `<b>${fmt(p.price)}</b>${p.listPrice ? ` <s class="muted">${fmt(p.listPrice)}</s>` : ""}${h.printedPrice != null ? ` · impresso ${fmt(h.printedPrice)}` : ""}
      <span class="badge ${p.source === "sfcc" ? "new" : ""}">${p.source === "sfcc" ? "SFCC" : "feed"}</span>${p.inStock === false ? `<span class="badge flag">esgotado</span>` : ""}${al.map((a) => `<span class="badge flag" title="${esc(a.msg || "")}">${esc(ALERT[a.type] || a.type)}</span>`).join("")}`;
  }

  function tabHotspots(box, main) {
    const f = ST.f, h = f.hotspots[ST.sel];
    const p = h ? prod(h.sku) : null;
    box.innerHTML = `
      ${h ? `<div class="card" style="padding:10px;margin-bottom:10px;background:var(--soft)">
        <div class="row"><b>Hotspot ${ST.sel + 1}</b><span class="small muted">página ${h.page}</span><span class="grow"></span><button class="btn sm ghost danger" id="hs-del">Apagar</button></div>
        <div class="row" style="margin-top:8px">${p && !p.missing && p.image ? `<img src="${esc(p.image)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px">` : ""}
          <div style="min-width:0;flex:1"><div class="small" style="font-weight:600">${esc(p?.name || h.sku || "Escolhe o produto abaixo ou escreve o SKU")}</div><div class="small">${productLine(p, h)}</div></div></div>
        <div class="grid two" style="gap:8px">
          <div><label>Tipo</label><select id="hs-type"><option value="dot" ${h.type === "dot" ? "selected" : ""}>Ponto + cartão</option><option value="area" ${h.type === "area" ? "selected" : ""}>Área clicável</option></select></div>
          <div><label>SKU</label><input id="hs-sku" value="${esc(h.sku)}" placeholder="ex. 473088"></div>
          <div><label>Preço impresso (€)</label><input id="hs-price" type="number" min="0" step="0.01" value="${h.printedPrice ?? ""}" placeholder="para validar"></div>
        </div>
        <p class="small muted" style="margin:6px 0 0">O preço impresso serve para o alerta “preço no site ≠ impresso”.</p></div>`
      : `<p class="small muted">Clica num hotspot na página para o editar, ou cria um novo (modo ${ST.mode === "dot" ? "ponto" : "área"}).</p>`}
      <div class="small" style="font-weight:600;margin:8px 0 6px">Página ${ST.page}</div>
      ${f.hotspots.map((x, i) => ({ x, i })).filter(({ x }) => x.page === ST.page).map(({ x, i }) => { const q = prod(x.sku); return `<div class="fol-hs ${ST.sel === i ? "on" : ""}" data-hs="${i}">${q && !q.missing && q.image ? `<img src="${esc(q.image)}" alt="">` : `<img alt="">`}
        <div style="min-width:0;flex:1"><div class="small" style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i + 1}. ${esc(q?.name || x.sku || "sem produto")} <span class="muted mono">${esc(x.sku)}</span></div><div class="small">${productLine(q, x)}</div></div></div>`; }).join("") || `<p class="small muted">Sem hotspots nesta página.</p>`}
      <hr style="border:0;border-top:1px solid var(--line);margin:12px 0"/>
      <div class="small" style="font-weight:600;margin-bottom:6px">${h ? `Produto do hotspot ${ST.sel + 1}` : "Produtos (cria um ponto no centro da página)"}</div>
      <div id="fol-picker"></div>`;
    $$("[data-hs]", box).forEach((el) => (el.onclick = () => { ST.sel = +el.dataset.hs; drawStage(main); drawTab(main); }));
    if (h) {
      $("#hs-del").onclick = () => { f.hotspots.splice(ST.sel, 1); ST.sel = -1; changed(main, { tab: true }); };
      $("#hs-type").onchange = (e) => {
        h.type = e.target.value;
        if (h.type === "area") { h.w = h.w || 12; h.h = h.h || 10; h.x = r2(clamp(h.x - h.w / 2, 0, 100 - h.w)); h.y = r2(clamp(h.y - h.h / 2, 0, 100 - h.h)); }
        else { h.x = r2(h.x + (h.w || 0) / 2); h.y = r2(h.y + (h.h || 0) / 2); delete h.w; delete h.h; }
        changed(main, { tab: true });
      };
      $("#hs-sku").onchange = (e) => setSku(h, e.target.value.trim(), main);
      $("#hs-price").onchange = (e) => { const v = e.target.value; h.printedPrice = v === "" ? null : Math.round(Number(v) * 100) / 100; changed(main, { stage: false }); };
    }
    PP.mount($("#fol-picker"), {
      market: f.market, state: ST.picker,
      isSelected: (id) => !!h && h.sku === id,
      addLabel: h ? "Usar neste hotspot" : "Adicionar ponto", selectedLabel: "✓ neste hotspot",
      onAdd: (prodRow) => {
        let t = f.hotspots[ST.sel];
        if (!t) { if (!f.pageCount) return toast("Carrega primeiro o PDF", true); t = { id: hid(), page: ST.page, type: "dot", x: 50, y: 50, sku: "", printedPrice: null }; f.hotspots.push(t); ST.sel = f.hotspots.length - 1; }
        t.sku = prodRow.id;
        changed(main, { tab: true });
      },
    });
  }

  async function setSku(h, sku, main) {
    h.sku = sku.slice(0, 40);
    if (sku) await PP.fetchIds(ST.f.market, [sku]).catch(() => {});
    changed(main, { tab: true });
  }

  function tabDados(box, main) {
    const st = ST.status, f = ST.f;
    if (!f.id) { box.innerHTML = `<p class="small muted">Guarda o folheto para ligar os produtos ao SFCC: a lista de SKUs é criada a partir dos hotspots e os dados são lidos logo.</p>`; return; }
    const skus = [...new Set(f.hotspots.map((h) => h.sku).filter(Boolean))];
    const srcs = skus.map(prod).filter(Boolean);
    box.innerHTML = `
      <div class="grid two" style="gap:8px">
        <div><div class="small muted">Última leitura deste folheto</div><b>${fmtDate(st.liveAt)}</b></div>
        <div><div class="small muted">Próxima atualização</div><b>${st.active ? fmtDate(st.nextRun) : "— (fora de validade)"}</b></div>
      </div>
      ${st.runError ? `<div class="callout" style="margin-top:8px">Última execução com erro: ${esc(st.runError)}</div>` : ""}
      <div class="row" style="margin-top:10px"><button class="btn primary" id="fol-refresh" ${dirty() ? "disabled title='Guarda primeiro'" : ""}>Atualizar agora</button>
        <span class="small muted">${skus.length} SKU(s) · ${srcs.filter((p) => p.source === "sfcc").length} com dados do SFCC · ${srcs.filter((p) => p.source === "feed").length} só feed</span></div>
      ${dirty() ? `<p class="small" style="color:var(--warn)">Há alterações por guardar — ao guardar a lista de SKUs é sincronizada e os dados lidos de novo.</p>` : ""}
      <div class="small" style="font-weight:600;margin:14px 0 6px">Alertas ${st.alerts.length ? `· ${st.alerts.length}` : ""}</div>
      ${st.alerts.length ? `<table><tr><th>SKU</th><th>Problema</th></tr>${st.alerts.map((a) => `<tr><td class="mono small">${esc(a.sku)}</td><td class="small"><span class="badge flag">${esc(ALERT[a.type] || a.type)}</span> ${esc(a.msg || "")}</td></tr>`).join("")}</table>
        <p class="small muted">Os alertas novos entram no relatório do Filo.</p>` : `<p class="small muted">${st.liveAt ? "✓ Sem alertas: preços iguais ao impresso, tudo com stock e ativo." : "Ainda sem leitura do SFCC."}</p>`}
      <p class="small muted" style="margin-top:10px">Prioridade dos dados: SFCC (preço, promoção, stock) → feed diário (link da PDP e o resto). Também na pesquisa de produtos e nos outros blocos.</p>`;
    $("#fol-refresh").onclick = (e) => guard(async () => {
      const r = await api(`/folhetos/${f.id}/refresh`, { method: "POST" });
      const keepF = ST.f; apply(r); ST.f = keepF; ST.saved = JSON.stringify(r.folheto);
      toast(r.run?.error ? `Erro: ${r.run.error}` : `Atualizado · ${r.status.alerts.length} alerta(s)`, !!r.run?.error);
      drawEditor(main);
    }, e.target);
  }

  function tabExport(box, main) {
    const f = ST.f, st = ST.status;
    const issues = [], warns = [];
    if (!f.id) issues.push("Guarda o folheto primeiro.");
    else if (dirty()) issues.push("Há alterações por guardar.");
    if (!f.pageCount) issues.push("O folheto não tem páginas.");
    if (!f.imagePattern) issues.push("Falta o URL das imagens das páginas (separador Folheto).");
    else if (!hostOk(f.imagePattern)) issues.push("As imagens têm de estar num domínio aceite pelo site (biblioteca do SFCC).");
    const noSku = f.hotspots.filter((h) => !h.sku).length;
    if (noSku) warns.push(`${noSku} hotspot(s) sem produto — não são exportados.`);
    const miss = [...new Set(f.hotspots.map((h) => h.sku).filter((s) => s && prod(s)?.missing))];
    if (miss.length) warns.push(`Não encontrados (não são exportados): ${miss.join(", ")}.`);
    const oos = [...new Set(f.hotspots.map((h) => h.sku).filter((s) => s && prod(s)?.inStock === false))];
    if (oos.length) warns.push(`Esgotados (aparecem com “Esgotado”): ${oos.join(", ")}.`);
    if (!f.hotspots.length) warns.push("Ainda não há produtos no folheto.");
    box.innerHTML = `
      <p class="small muted">O bloco do site não consegue ir buscar dados, por isso o código leva os preços e o stock de agora. <b>Quando os dados mudarem, este editor avisa</b> e é preciso gerar e colar de novo.</p>
      <div class="small">Última exportação: <b>${fmtDate(st?.exportedAt)}</b> ${st?.exportedAt ? (st.outdated ? `<span class="badge flag">desatualizada</span>` : `<span class="badge new">em dia</span>`) : ""}</div>
      ${issues.length ? `<div class="callout" style="margin-top:8px;border-color:#e8b4b4;background:#fbeeee">${issues.map((e) => `✕ ${esc(e)}`).join("<br>")}</div>` : ""}
      ${warns.length ? `<div class="small" style="color:var(--warn);margin-top:8px">${warns.map((w) => `⚠ ${esc(w)}`).join("<br>")}</div>` : ""}
      <div class="row" style="margin-top:10px"><button class="btn primary" id="fol-gen" ${issues.length ? "disabled" : ""}>Gerar código</button><button class="btn" id="fol-zip2">Imagens das páginas (.zip)</button></div>
      <textarea id="fol-code" rows="12" readonly style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:11px;margin-top:8px;${ST.exported ? "" : "display:none"}">${esc(ST.exported)}</textarea>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="fol-copy" ${ST.exported ? "" : "hidden"}>Copiar código</button></div>
      <p class="small muted" style="margin-top:10px">No Page Designer: componente <b>Raw HTML</b>, cola o código. Só HTML + CSS: as páginas deslizam na horizontal, os cartões abrem ao passar o rato ou tocar no ponto.</p>
      <p class="small muted"><b>Tracking:</b> com a tag do FeedForge no GTM, envia <code>view_item_list</code> / <code>select_item</code> com <code>item_list_name</code> “Folheto - ${esc(f.name)}”.</p>`;
    $("#fol-zip2").onclick = (e) => downloadZip(e.target);
    $("#fol-gen").onclick = (e) => guard(async () => {
      const r = await api(`/folhetos/${f.id}`);
      apply(r);
      const { css, render } = await assets();
      const html = render(r.render, { css });
      const head = `<!-- hôma · Folheto · ${String(f.name).replace(/--/g, "-")} · gerado pelo FeedForge em ${new Date().toISOString().slice(0, 16).replace("T", " ")} · dados de ${fmtDate(r.status.liveAt || r.render.feedAt)} · HTML + CSS, sem JavaScript -->`;
      ST.exported = `${head}\n${html.replace(/<script[\s\S]*?<\/script>/gi, "")}\n`;
      const done = await api(`/folhetos/${f.id}/exported`, { method: "POST", body: { fingerprint: r.status.fingerprint } });
      apply(done);
      toast("Código gerado — cola-o no Page Designer");
      drawEditor(main);
    }, e.target);
    $("#fol-copy").onclick = async () => { await navigator.clipboard.writeText($("#fol-code").value); toast("Código copiado"); };
  }
})();
