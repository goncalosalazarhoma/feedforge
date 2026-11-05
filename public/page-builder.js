/* FeedForge — Page Builder: describe → generate (library blocks) → edit → fill products from the feed → Gerar HTML
   for a Raw HTML component in SFCC Page Designer. The engine (blocks, schema, renderer) is /page-builder/engine.mjs. */
(() => {
  "use strict";
  const { $, $$, esc, toast, guard, ask, api, modal, closeModal, VIEWS, ProductPicker: PP } = window.FF;

  const MARKETS = { pt: "PT", es: "ES" };
  const PAGES = { homepage: "Homepage", plp: "PLP", pdp: "PDP", landing: "Landing" };
  const EXAMPLES = [
    ["Hero de campanha com CTA", "Hero de campanha de Natal com título, subtítulo e botão para a coleção de Natal"],
    ["Grelha de 4 categorias com imagem", "Grelha de 4 categorias com imagem e link: Decoração, Cozinha, Têxtil e Arrumação"],
    ["Título + texto + 8 produtos em promoção", "Um título com texto de introdução e, a seguir, uma grelha de 8 produtos de decoração em promoção"],
    ["Zig-zag de 3 linhas (sustentabilidade)", "Zig-zag de 3 linhas para uma landing de sustentabilidade: materiais naturais, algodão responsável e produtos duráveis, com link em cada linha"],
    ["Grelha de imagens + texto + produtos", "grelha de 4 imagens com link e CTA, depois um título + texto, e no fim um título e uma grelha de 8 produtos"],
  ];
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  let E = null; // engine module
  const PB = {
    screen: "list", el: null, rec: null, saved: "", sel: null, tab: "estrutura", device: "desktop",
    hyd: { products: {}, counts: {} }, hydKey: "", pickers: {}, notes: [], pending: null, showPending: true,
    exportRes: null, settings: null, gen: null,
  };
  const author = () => lsGet("ff-author") || "";
  const dirty = () => PB.el && JSON.stringify(PB.el) !== PB.saved;
  const blk = (id = PB.sel) => PB.el?.blocks.find((b) => b.id === id);
  const fmtDate = (s) => (s ? new Date(s).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—");

  async function engine() {
    if (!E) E = await import("/page-builder/engine.mjs");
    return E;
  }

  VIEWS.pagebuilder = async (main) => {
    await engine();
    if (!PB.settings) PB.settings = await guard(() => api("/page-builder/settings")) || { caps: { js: false } };
    if (PB.screen === "new") return drawNew(main);
    if (PB.screen === "edit" && PB.el) return drawWorkspace(main);
    if (PB.screen === "export" && PB.el) return drawExport(main);
    return drawList(main);
  };

  // ------------------------------------------------------------------ list
  async function drawList(main) {
    PB.screen = "list";
    const list = (await guard(() => api("/page-builder/elements"))) || [];
    const cap = PB.settings.capabilityTest;
    main.innerHTML = `
      <div class="head"><div><h1>Page Builder</h1><div class="muted">Descreve o elemento, a IA monta-o com os blocos aprovados do design system hôma, editas e preenches com produtos do feed, e copias o HTML para um componente <b>Raw HTML</b> do Page Designer.</div></div>
        <div class="row"><label class="f" style="width:170px">O teu nome<input id="pb-author" value="${esc(author())}" placeholder="para o histórico"/></label><button class="btn primary" id="pb-new">＋ Novo elemento</button></div></div>
      <div class="callout ${cap ? "info" : ""}" style="margin-bottom:12px">${cap
        ? `Teste de capacidades registado a ${esc(fmtDate(cap.at))}: &lt;style&gt; ${cap.style ? "✓" : "✕"} · media queries ${cap.media ? "✓" : "✕"} · scroll ${cap.scroll ? "✓" : "✕"} · data-* ${cap.dataAttrs ? "✓" : "✕"} · JavaScript ${cap.js ? "✓ (setas nos carrosséis)" : "✕ (carrosséis só com swipe/scroll)"}`
        : `<b>Falta o teste de capacidades do Page Designer.</b> Até lá o HTML é gerado sem JavaScript (carrosséis só com swipe/scroll).`}
        <a href="/page-builder/capability-test" target="_blank">Abrir o teste</a> · <a href="#" id="pb-cap">Registar resultado</a> · <a href="/page-builder/blocks" target="_blank">Galeria de blocos</a></div>
      <div class="card">${list.length ? `<table><tr><th>Elemento</th><th>Mercado</th><th>Página</th><th>Blocos</th><th>Última geração do HTML</th><th>Autor</th><th></th></tr>
        ${list.map((x) => `<tr class="click" data-open="${esc(x.id)}"><td><b>${esc(x.name)}</b> ${x.stale ? `<span class="badge flag" title="${esc((x.staleProducts || []).map((p) => `${p.id}: ${p.reason}`).join("\n"))}">desatualizado</span>` : ""}<div class="small muted mono">${esc(x.id)}</div></td>
          <td>${esc(MARKETS[x.market] || x.market)}</td><td>${esc(PAGES[x.page] || x.page)}</td><td>${x.blocks}</td>
          <td class="small">${x.generatedAt ? `${esc(fmtDate(x.generatedAt))}${x.bytes ? ` · ${(x.bytes / 1024).toFixed(0)} KB` : ""}` : `<span class="muted">nunca</span>`}</td>
          <td class="small">${esc(x.updatedBy || x.author || "—")}</td>
          <td style="white-space:nowrap"><button class="btn sm" data-dup="${esc(x.id)}">Duplicar</button> <button class="btn sm ghost danger" data-del="${esc(x.id)}">✕</button></td></tr>`).join("")}</table>
        <p class="small muted" style="margin:10px 0 0">“desatualizado” = algum produto do último HTML gerado mudou de preço ou de stock no feed. Volta a gerar o HTML e substitui-o no Page Designer.</p>`
        : `<div class="empty">Ainda não há elementos. Cria o primeiro com “Novo elemento”.</div>`}</div>`;
    $("#pb-author").onchange = (e) => lsSet("ff-author", e.target.value.trim());
    $("#pb-new").onclick = () => { PB.screen = "new"; drawNew(main); };
    $("#pb-cap").onclick = (e) => { e.preventDefault(); capabilityModal(main); };
    $$("tr[data-open]", main).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest("button")) return; openElement(tr.dataset.open, main); }));
    $$("[data-dup]", main).forEach((b) => (b.onclick = () => guard(async () => { await api(`/page-builder/elements/${b.dataset.dup}/duplicate`, { method: "POST", body: { author: author() } }); toast("Elemento duplicado"); drawList(main); }, b)));
    $$("[data-del]", main).forEach((b) => (b.onclick = async () => { if (await ask("Apagar este elemento e as versões? O HTML já colado no site não é afetado.", { ok: "Apagar", danger: true })) guard(async () => { await api(`/page-builder/elements/${b.dataset.del}`, { method: "DELETE" }); drawList(main); }); }));
  }

  function capabilityModal(main) {
    const c = PB.settings.capabilityTest || {};
    const items = [["style", "1. Texto verde em Gilroy (&lt;style&gt; funciona)"], ["inline", "2. Texto vermelho (style inline funciona)"], ["media", "3. Grelha com 1 coluna no mobile (media queries)"], ["scroll", "4. Fila com scroll horizontal"], ["js", "5. “JavaScript correu.”"], ["relLink", "6. Link relativo funciona"], ["img", "7. Imagem aparece"], ["dataAttrs", "No DOM: id e data-* mantêm-se"]];
    modal(`<h2>Resultado do teste de capacidades</h2><p class="small muted">Cola o snippet de <a href="/page-builder/capability-test" target="_blank">/page-builder/capability-test</a> num componente Raw HTML em development.homastores.com e marca o que funcionou.</p>
      <div class="form">${items.map(([k, l]) => `<label class="chk"><input type="checkbox" data-cap="${k}" ${c[k] ? "checked" : ""}/> ${l}</label>`).join("")}
      <label class="f">Notas<textarea id="cap-notes" rows="2">${esc(c.notes || "")}</textarea></label></div>
      <div class="row" style="margin-top:14px"><span class="grow"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="cap-save">Guardar</button></div>`);
    $("#cap-save").onclick = () => guard(async () => {
      const r = Object.fromEntries(items.map(([k]) => [k, $(`[data-cap="${k}"]`).checked]));
      r.notes = $("#cap-notes").value;
      PB.settings = await api("/page-builder/settings", { method: "PUT", body: { caps: { js: r.js && r.dataAttrs }, capabilityTest: r } });
      closeModal(); toast(PB.settings.caps.js ? "Guardado — os carrosséis passam a ter setas" : "Guardado"); drawList(main);
    });
  }

  async function openElement(id, main) {
    await guard(async () => {
      const r = await api(`/page-builder/elements/${id}`);
      loadElement(r.element, r);
      PB.screen = "edit"; drawWorkspace(main);
    });
  }
  function loadElement(el, rec = null, { keepSaved = false } = {}) {
    PB.el = E.normalizeElement(el); delete PB.el.notes;
    PB.rec = rec; if (!keepSaved) PB.saved = rec ? JSON.stringify(PB.el) : "";
    PB.sel = PB.el.blocks[0]?.id || null; PB.pending = null; PB.exportRes = null; PB.hydKey = ""; PB.pickers = {};
  }

  // ------------------------------------------------------------------ new element (prompt)
  function drawNew(main) {
    const g = PB.gen || { prompt: "", market: "pt", page: "homepage" };
    PB.gen = g;
    main.innerHTML = `
      <div class="head"><div><a href="#" id="pb-back" class="small">← Page Builder</a><h1 style="margin:4px 0 0">Novo elemento</h1><div class="muted">Descreve em português o que precisas. A IA escolhe e preenche blocos da biblioteca aprovada (nunca escreve HTML).</div></div></div>
      <div class="card" style="max-width:900px">
        <label class="f">O que precisas?<textarea id="pb-prompt" rows="6" placeholder="Ex.: grelha de 4 imagens com link e CTA, depois um título + texto, e no fim um título e uma grelha de 8 produtos">${esc(g.prompt)}</textarea></label>
        <div class="chips" style="margin:10px 0">${EXAMPLES.map(([l], i) => `<span class="chip" data-ex="${i}">${esc(l)}</span>`).join("")}</div>
        <div class="row">
          <label class="f">Mercado<select id="pb-market">${Object.entries(MARKETS).map(([k, l]) => `<option value="${k}" ${g.market === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="f">Página<select id="pb-page">${Object.entries(PAGES).map(([k, l]) => `<option value="${k}" ${g.page === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <span class="grow"></span><button class="btn" id="pb-blank">Começar em branco</button><button class="btn primary" id="pb-go">Gerar</button>
        </div>
        <div id="pb-status" class="small muted" style="margin-top:10px"></div>
      </div>`;
    $("#pb-back").onclick = (e) => { e.preventDefault(); PB.screen = "list"; drawList(main); };
    $$("[data-ex]", main).forEach((c) => (c.onclick = () => { $("#pb-prompt").value = EXAMPLES[+c.dataset.ex][1]; }));
    const read = () => { g.prompt = $("#pb-prompt").value.trim(); g.market = $("#pb-market").value; g.page = $("#pb-page").value; };
    $("#pb-blank").onclick = () => { read(); loadElement({ name: "Novo elemento", market: g.market, page: g.page, blocks: [] }); PB.notes = []; PB.screen = "edit"; drawWorkspace(main); };
    $("#pb-go").onclick = (e) => guard(async () => {
      read();
      if (!g.prompt) return toast("Descreve o elemento primeiro", true);
      const res = await runGeneration({ prompt: g.prompt, market: g.market, page: g.page, author: author() }, $("#pb-status"));
      loadElement({ ...res.element, market: g.market, page: g.page });
      PB.notes = res.notes || [];
      PB.screen = "edit"; drawWorkspace(main);
      toast(`Gerado em ${(res.ms / 1000).toFixed(0)} s (${res.model})`);
    }, e.target);
  }

  // background job + polling (generation can take ~20–60 s)
  async function runGeneration(body, statusEl) {
    const { jobId } = await api("/page-builder/generate", { method: "POST", body });
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const j = await api(`/page-builder/jobs/${jobId}`);
      if (statusEl) statusEl.textContent = `A gerar com Claude… ${Math.round((Date.now() - t0) / 1000)} s (normalmente 20–60 s)`;
      if (j.status === "done") { if (statusEl) statusEl.textContent = ""; return j.result; }
      if (j.status === "error") { if (statusEl) statusEl.textContent = ""; throw new Error(j.error || "A geração falhou"); }
    }
  }

  // ------------------------------------------------------------------ workspace
  function drawWorkspace(main) {
    PB.screen = "edit";
    const el = PB.el;
    main.innerHTML = `
      <style>
        .pb-layout{display:grid;grid-template-columns:minmax(0,1fr) 460px;gap:16px;align-items:start}
        .pb-preview{position:sticky;top:12px}
        .pb-frame-wrap{background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;position:relative}
        .pb-frame-wrap.mobile{background:var(--soft);padding:12px 0;display:flex;justify-content:center}
        .pb-frame-wrap iframe{border:0;display:block;background:#fff;transform-origin:0 0}
        .pb-frame-wrap.mobile iframe{width:375px;box-shadow:0 0 0 1px var(--line)}
        .pb-panel{max-height:calc(100vh - 120px);overflow:auto}
        .pb-blk{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:#fff;margin-bottom:6px;cursor:pointer}
        .pb-blk.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
        .pb-blk.drag-over{border-color:var(--info)}
        .pb-blk .handle{cursor:grab;color:var(--muted);user-select:none}
        .pb-blk .t{flex:1;min-width:0;font-size:12px}
        .pb-blk .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pb-item{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-bottom:8px;background:#fcfbf9}
        .pb-sw{display:inline-flex;gap:6px;flex-wrap:wrap}
        .pb-sw label{display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;border:1px solid var(--line);border-radius:999px;padding:3px 8px 3px 4px;background:#fff}
        .pb-sw label.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
        .pb-sw i{width:16px;height:16px;border-radius:50%;border:1px solid #ccc;display:inline-block}
        .pb-help{font-size:11px;color:var(--muted)}
        .pb-err{font-size:11px;color:var(--bad)}
        .pb-thumb{max-width:100%;max-height:90px;border-radius:6px;margin-top:4px;display:block}
        details.pb-adv summary{cursor:pointer;font-size:12px;color:var(--muted);margin:10px 0 6px}
        .pb-tb{display:flex;gap:4px;margin-bottom:4px}
      </style>
      <div class="head"><div><a href="#" id="pb-back" class="small">← Page Builder</a>
          <div class="row" style="margin-top:4px"><input id="pb-name" value="${esc(el.name)}" style="font-size:18px;font-weight:650;min-width:320px"/>
            <select id="pb-market">${Object.entries(MARKETS).map(([k, l]) => `<option value="${k}" ${el.market === k ? "selected" : ""}>${l}</option>`).join("")}</select>
            <select id="pb-page">${Object.entries(PAGES).map(([k, l]) => `<option value="${k}" ${el.page === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div class="small muted" style="margin-top:4px">${el.id ? `<span class="mono">${esc(el.id)}</span>` : "por guardar"}${PB.rec?.lastExport ? ` · HTML gerado ${esc(fmtDate(PB.rec.lastExport.generatedAt))}` : ""}<span id="pb-dirty"></span></div></div>
        <div class="row">${el.id ? `<button class="btn" id="pb-versions">Versões</button><button class="btn" id="pb-dup">Duplicar</button><button class="btn ghost danger" id="pb-del">Apagar</button>` : ""}<button class="btn" id="pb-save">Guardar</button><button class="btn primary" id="pb-export">Gerar HTML</button></div></div>
      ${PB.notes.length ? `<div class="callout" style="margin-bottom:12px"><b>Notas da IA</b><br>${PB.notes.map((n) => `• ${esc(n)}`).join("<br>")} <a href="#" id="pb-notes-x" class="small">fechar</a></div>` : ""}
      <div class="pb-layout">
        <div class="pb-preview">
          <div class="row" style="margin-bottom:8px">
            <div class="chips"><span class="chip ${PB.device === "desktop" ? "on" : ""}" data-dev="desktop">Desktop 1440</span><span class="chip ${PB.device === "mobile" ? "on" : ""}" data-dev="mobile">Mobile 375</span></div>
            <span class="grow"></span><span class="small muted" id="pb-size"></span>
          </div>
          <div id="pb-pending-bar"></div>
          <div class="pb-frame-wrap ${PB.device}" id="pb-wrap"><iframe id="pb-frame" title="Pré-visualização" scrolling="no"></iframe></div>
          <p class="small muted" style="margin-top:6px">Clica num bloco da pré-visualização para o editar. As imagens em falta aparecem a cinzento com a descrição da fotografia.</p>
        </div>
        <div class="card pb-panel">
          <div class="chips" style="margin-bottom:12px">${[["estrutura", `Estrutura · ${el.blocks.length}`], ["bloco", "Bloco"], ["ia", "IA"]].map(([k, l]) => `<span class="chip ${PB.tab === k ? "on" : ""}" data-tab="${k}">${l}</span>`).join("")}</div>
          <div id="pb-tab"></div>
        </div>
      </div>`;
    $("#pb-back").onclick = async (e) => { e.preventDefault(); if (dirty() && !(await ask("Há alterações por guardar. Sair mesmo assim?", { ok: "Sair" }))) return; PB.el = null; PB.screen = "list"; drawList(main); };
    $("#pb-name").oninput = (e) => { el.name = e.target.value; markDirty(); };
    $("#pb-market").onchange = (e) => { el.market = e.target.value; PB.pickers = {}; changed(); drawTab(); };
    $("#pb-page").onchange = (e) => { el.page = e.target.value; markDirty(); };
    $("#pb-save").onclick = (e) => guard(() => save(main), e.target);
    $("#pb-export").onclick = () => { PB.screen = "export"; PB.exportRes = null; drawExport(main); };
    if ($("#pb-notes-x")) $("#pb-notes-x").onclick = (e) => { e.preventDefault(); PB.notes = []; drawWorkspace(main); };
    if ($("#pb-dup")) $("#pb-dup").onclick = (e) => guard(async () => { if (dirty()) await save(main, true); const c = await api(`/page-builder/elements/${el.id}/duplicate`, { method: "POST", body: { author: author() } }); toast("Duplicado — a editar a cópia"); loadElement(c.element, c); drawWorkspace(main); }, e.target);
    if ($("#pb-del")) $("#pb-del").onclick = async () => { if (await ask("Apagar este elemento e as versões?", { ok: "Apagar", danger: true })) guard(async () => { await api(`/page-builder/elements/${el.id}`, { method: "DELETE" }); PB.el = null; drawList(main); }); };
    if ($("#pb-versions")) $("#pb-versions").onclick = () => versionsModal(main);
    $$("[data-dev]", main).forEach((c) => (c.onclick = () => { PB.device = c.dataset.dev; drawWorkspace(main); }));
    $$("[data-tab]", main).forEach((c) => (c.onclick = () => { PB.tab = c.dataset.tab; $$("[data-tab]", main).forEach((x) => x.classList.toggle("on", x === c)); drawTab(); }));
    PB.main = main;
    buildFrame();
    drawTab();
    markDirty();
  }

  function markDirty() { const d = $("#pb-dirty"); if (d) d.innerHTML = dirty() ? ` · <b style="color:var(--warn)">alterações por guardar</b>` : ""; }

  async function save(main, quiet = false) {
    const body = { element: PB.el, author: author() };
    const r = PB.el.id ? await api(`/page-builder/elements/${PB.el.id}`, { method: "PUT", body }) : await api("/page-builder/elements", { method: "POST", body });
    const sel = PB.sel;
    PB.el = E.normalizeElement(r.element); delete PB.el.notes;
    PB.rec = r; PB.saved = JSON.stringify(PB.el); PB.sel = sel;
    if (!quiet) { toast("Guardado"); drawWorkspace(main); }
  }

  async function versionsModal(main) {
    const v = (await guard(() => api(`/page-builder/elements/${PB.el.id}/versions`))) || [];
    modal(`<h2>Versões (últimas ${v.length})</h2><table>${v.map((x, i) => `<tr><td class="small">${esc(fmtDate(x.at))}${i === 0 ? ` <span class="badge new">atual</span>` : ""}</td><td class="small">${esc(x.author || "—")}</td><td class="small">${x.element.blocks.length} blocos</td><td>${i ? `<button class="btn sm" data-v="${i}">Restaurar</button>` : ""}</td></tr>`).join("")}</table>
      <p class="small muted">Restaurar carrega a versão no editor; só fica gravada quando carregas em Guardar.</p><div class="row"><span class="grow"></span><button class="btn" data-close>Fechar</button></div>`);
    $$("[data-v]").forEach((b) => (b.onclick = () => { loadElement({ ...v[+b.dataset.v].element, id: PB.el.id }, PB.rec, { keepSaved: true }); closeModal(); drawWorkspace(main); toast("Versão carregada — guarda para a manter"); }));
  }

  // ------------------------------------------------------------------ preview (iframe; desktop rendered at 1440 and scaled)
  const SEL_CSS = (i) => `[data-hpb-index]{cursor:pointer}[data-hpb-index]:hover{outline:1px dashed #0f69ae;outline-offset:-1px}${i >= 0 ? `[data-hpb-index="${i}"]{outline:2px solid #0f69ae!important;outline-offset:-2px}` : ""}`;
  function buildFrame() {
    const f = $("#pb-frame");
    if (!f) return;
    f.srcdoc = E.previewDocument(`<div id="pb-root"></div>`, { head: `<style id="pb-sel"></style>` });
    f.onload = () => {
      const d = f.contentDocument;
      d.addEventListener("click", (e) => {
        e.preventDefault();
        const b = e.target.closest("[data-hpb-index]");
        if (!b) return;
        const bl = currentForPreview().blocks[+b.dataset.hpbIndex];
        if (bl && PB.el.blocks.some((x) => x.id === bl.id)) { PB.sel = bl.id; PB.tab = "bloco"; $$("[data-tab]").forEach((x) => x.classList.toggle("on", x.dataset.tab === "bloco")); drawTab(); preview(true); }
      });
      new f.contentWindow.ResizeObserver(fit).observe(d.body);
      preview(true);
    };
  }
  function fit() {
    const f = $("#pb-frame"), w = $("#pb-wrap");
    if (!f?.contentDocument?.body || !w) return;
    const h = f.contentDocument.documentElement.scrollHeight;
    if (PB.device === "desktop") {
      const scale = Math.min(1, w.clientWidth / 1440);
      f.style.width = "1440px"; f.style.height = h + "px"; f.style.transform = `scale(${scale})`;
      w.style.height = Math.ceil(h * scale) + "px";
    } else { f.style.width = "375px"; f.style.height = h + "px"; f.style.transform = ""; w.style.height = ""; }
  }
  const currentForPreview = () => (PB.pending && PB.showPending ? PB.pending.element : PB.el);

  let pv = 0;
  function preview(now = false) {
    clearTimeout(pv);
    pv = setTimeout(async () => {
      const f = $("#pb-frame");
      if (!f?.contentDocument?.getElementById("pb-root") || !PB.el) return;
      const el = currentForPreview();
      await hydrate(el);
      const { html, bytes } = E.renderElement(el, { products: PB.hyd.products, preview: true, caps: PB.settings.caps });
      f.contentDocument.getElementById("pb-root").innerHTML = html;
      const i = el.blocks.findIndex((b) => b.id === PB.sel);
      f.contentDocument.getElementById("pb-sel").textContent = SEL_CSS(i);
      const s = $("#pb-size"); if (s) s.textContent = `${el.blocks.length} blocos · ~${(bytes / 1024).toFixed(0)} KB`;
      fit();
      const bar = $("#pb-pending-bar");
      if (bar) bar.innerHTML = PB.pending && PB.showPending ? `<div class="callout info small" style="margin-bottom:8px">A mostrar a <b>proposta da IA</b> (ainda não aplicada) — vê o separador IA.</div>` : "";
    }, now ? 0 : 150);
  }

  // product blocks → /api/page-builder/hydrate (only when a product source / limit / market changed)
  async function hydrate(el) {
    const key = JSON.stringify([el.market, el.blocks.filter((b) => E.PRODUCT_BLOCKS.includes(b.type)).map((b) => [b.id, b.props.productSource, b.props.limit])]);
    if (key === PB.hydKey) return;
    PB.hydKey = key;
    if (!el.blocks.some((b) => E.PRODUCT_BLOCKS.includes(b.type))) { PB.hyd = { products: {}, counts: {} }; return; }
    try { PB.hyd = await api("/page-builder/hydrate", { method: "POST", body: { element: el } }); }
    catch (e) { toast(e.message, true); PB.hyd = { products: {}, counts: {} }; }
    const c = $("#pb-count"); if (c) c.textContent = countText();
  }

  const changed = () => { markDirty(); preview(); };

  // ------------------------------------------------------------------ panel tabs
  function drawTab() {
    const box = $("#pb-tab");
    if (!box) return;
    const t = $('[data-tab="estrutura"]'); if (t) t.textContent = `Estrutura · ${PB.el.blocks.length}`;
    if (PB.tab === "estrutura") return drawStructure(box);
    if (PB.tab === "bloco") return drawBlock(box);
    return drawAI(box);
  }

  const blockTitle = (b) => b.props.title || b.props.eyebrow || b.items?.[0]?.title || b.items?.[0]?.label || (b.props.productSource ? (b.props.productSource.mode === "manual" ? `${b.props.productSource.ids.length} produtos escolhidos` : [b.props.productSource.category, b.props.productSource.subcategory].filter(Boolean).join(" › ") || "regra") : "");

  function drawStructure(box) {
    const el = PB.el;
    box.innerHTML = `
      ${el.blocks.length ? "" : `<p class="muted small">Sem blocos. Adiciona o primeiro em baixo ou usa o separador IA.</p>`}
      <div id="pb-blocks">${el.blocks.map((b, i) => `<div class="pb-blk ${b.id === PB.sel ? "on" : ""}" data-i="${i}" data-id="${esc(b.id)}">
        <span class="handle" title="Arrastar">⠿</span><span class="small muted">${i + 1}</span>
        <div class="t"><div><b>${esc(E.BLOCKS[b.type].label)}</b>${b.props.hideOn ? ` <span class="badge">sem ${b.props.hideOn}</span>` : ""}</div><div class="muted">${esc(blockTitle(b))}</div></div>
        <button class="btn sm ghost" data-mv="-1" title="Subir">↑</button><button class="btn sm ghost" data-mv="1" title="Descer">↓</button>
        <button class="btn sm ghost" data-hide="mobile" title="Esconder no mobile">${b.props.hideOn === "mobile" ? "📵" : "📱"}</button><button class="btn sm ghost" data-hide="desktop" title="Esconder no desktop">${b.props.hideOn === "desktop" ? "⊘" : "🖥"}</button>
        <button class="btn sm ghost" data-cp title="Duplicar">⧉</button><button class="btn sm ghost danger" data-rm title="Apagar">✕</button></div>`).join("")}</div>
      <div class="row" style="margin-top:10px"><select id="pb-add" style="flex:1"><option value="">＋ Adicionar bloco…</option>${E.BLOCK_TYPES.map((t) => `<option value="${t}">${esc(E.BLOCKS[t].label)} — ${esc(E.BLOCKS[t].figma)}</option>`).join("")}</select></div>
      <p class="pb-help" style="margin-top:6px">O novo bloco entra a seguir ao bloco selecionado.</p>`;
    const at = (row) => el.blocks.findIndex((b) => b.id === row.dataset.id);
    $$(".pb-blk", box).forEach((row) => {
      row.onclick = (e) => { if (e.target.closest("button")) return; PB.sel = row.dataset.id; PB.tab = "bloco"; $$("[data-tab]").forEach((x) => x.classList.toggle("on", x.dataset.tab === "bloco")); drawTab(); preview(true); };
      $("[data-mv='-1']", row).onclick = () => move(at(row), at(row) - 1);
      $("[data-mv='1']", row).onclick = () => move(at(row), at(row) + 1);
      $$("[data-hide]", row).forEach((b) => (b.onclick = () => { const bl = el.blocks[at(row)]; bl.props.hideOn = bl.props.hideOn === b.dataset.hide ? "" : b.dataset.hide; drawStructure(box); changed(); }));
      $("[data-cp]", row).onclick = () => { const i = at(row); const c = E.normalizeBlock({ ...structuredClone(el.blocks[i]), id: E.newId() }); el.blocks.splice(i + 1, 0, c); PB.sel = c.id; drawTab(); changed(); };
      $("[data-rm]", row).onclick = async () => { const i = at(row); if (!(await ask(`Apagar o bloco “${E.BLOCKS[el.blocks[i].type].label}”?`, { ok: "Apagar", danger: true }))) return; el.blocks.splice(i, 1); PB.sel = el.blocks[Math.min(i, el.blocks.length - 1)]?.id || null; drawTab(); changed(); };
    });
    PP.enableReorder($("#pb-blocks", box), ".pb-blk", (from, to) => move(from, to));
    $("#pb-add").onchange = (e) => {
      const t = e.target.value; if (!t) return;
      const b = E.blankBlock(t);
      const i = el.blocks.findIndex((x) => x.id === PB.sel);
      el.blocks.splice(i < 0 ? el.blocks.length : i + 1, 0, b);
      PB.sel = b.id; PB.tab = "bloco"; $$("[data-tab]").forEach((x) => x.classList.toggle("on", x.dataset.tab === "bloco"));
      drawTab(); changed();
    };
    function move(from, to) {
      if (to < 0 || to >= el.blocks.length || from === to) return;
      const [m] = el.blocks.splice(from, 1); el.blocks.splice(to, 0, m);
      drawStructure(box); changed();
    }
  }

  // ---------- block form (generated from the block definition)
  const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; };

  function fieldHtml(f, path, v) {
    const id = `f-${path.replace(/\W/g, "_")}`;
    switch (f.kind) {
      case "text": return `<label class="f">${esc(f.label)}${f.required ? " *" : ""}${f.multiline ? `<textarea data-path="${path}" rows="3" maxlength="${f.max}">${esc(v)}</textarea>` : `<input data-path="${path}" value="${esc(v)}" maxlength="${f.max}"/>`}</label>`;
      case "rich": return `<label class="f">${esc(f.label)}<span class="pb-tb"><button type="button" class="btn sm" data-wrap="strong" data-for="${id}"><b>B</b></button><button type="button" class="btn sm" data-wrap="em" data-for="${id}"><i>I</i></button><button type="button" class="btn sm" data-wrap="a" data-for="${id}">Link</button><button type="button" class="btn sm" data-wrap="ul" data-for="${id}">• Lista</button><button type="button" class="btn sm" data-wrap="p" data-for="${id}">¶</button></span>
        <textarea id="${id}" data-path="${path}" rows="6" style="font-family:ui-monospace,Menlo,monospace;font-size:12px">${esc(v)}</textarea><span class="pb-help">Só &lt;p&gt;, &lt;strong&gt;, &lt;em&gt;, &lt;a href&gt; (homastores.com), &lt;ul&gt;/&lt;ol&gt;/&lt;li&gt;. O resto é removido.</span></label>`;
      case "image": return `<div class="f" style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted)">${esc(f.label)}${f.required ? " *" : ""}
        <input data-path="${path}.src" value="${esc(v?.src)}" placeholder="https://www.homastores.com/dw/image/…"/>
        <input data-path="${path}.alt" value="${esc(v?.alt)}" placeholder="Texto alternativo (obrigatório)"/>
        ${v?.description ? `<span class="pb-help">📷 ${esc(v.description)}</span>` : ""}<span data-imginfo="${path}"></span></div>`;
      case "link": {
        const n = v?.url ? E.normalizeUrl(v.url, PB.el.market) : null;
        const msg = `<span data-linkinfo="${path}">${n ? (n.error ? `<span class="pb-err">${esc(n.error)}</span>` : `<span class="pb-help">→ ${esc(n.url)}${n.warn ? ` <b style="color:var(--warn)">${esc(n.warn)}</b>` : ""}</span>`) : ""}</span>`;
        return f.urlOnly
          ? `<label class="f">${esc(f.label)}${f.required ? " *" : ""}<input data-path="${path}.url" value="${esc(v?.url)}" placeholder="/natal ou https://www.homastores.com/pt/pt/…"/>${msg}</label>`
          : `<div class="f" style="display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--muted)">${esc(f.label)}<div class="row" style="flex-wrap:nowrap"><input data-path="${path}.label" value="${esc(v?.label)}" placeholder="Texto" style="width:40%"/><input data-path="${path}.url" value="${esc(v?.url)}" placeholder="/natal" style="flex:1"/></div>${msg}</div>`;
      }
      case "enum":
        if (path.endsWith("props.background") || path.endsWith(".bg")) {
          const opts = f.options;
          return `<div class="f" style="font-size:12px;color:var(--muted)">${esc(f.label)}<div class="pb-sw">${opts.map(([o, l]) => `<label class="${o === v ? "on" : ""}"><input type="radio" name="${id}" data-path="${path}" value="${esc(o)}" ${o === v ? "checked" : ""} hidden/><i style="background:${o === "image" ? "linear-gradient(135deg,#999,#333)" : E.BACKGROUNDS[o].bg}"></i>${esc(l.split(" (")[0])}</label>`).join("")}</div></div>`;
        }
        return `<label class="f">${esc(f.label)}<select data-path="${path}" data-type="${typeof f.options[0][0] === "number" ? "num" : "str"}">${f.options.map(([o, l]) => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
      case "int": return `<label class="f">${esc(f.label)}<span class="row" style="flex-wrap:nowrap"><input type="range" min="${f.min}" max="${f.max}" value="${v}" data-path="${path}" data-type="num" style="flex:1"/><input type="number" min="${f.min}" max="${f.max}" value="${v}" data-path="${path}" data-type="num" style="width:72px"/></span></label>`;
      case "bool": return `<label class="chk"><input type="checkbox" data-path="${path}" ${v ? "checked" : ""}/> ${esc(f.label)}</label>`;
      case "products": return `<div id="pb-products"></div>`;
      default: return "";
    }
  }

  function drawBlock(box) {
    const b = blk();
    if (!b) { box.innerHTML = `<p class="muted small">Seleciona um bloco na estrutura ou na pré-visualização.</p>`; return; }
    const d = E.BLOCKS[b.type];
    const i = PB.el.blocks.indexOf(b);
    box.innerHTML = `<div class="small muted" style="margin-bottom:8px">Bloco ${i + 1} · <b>${esc(d.label)}</b> <span class="mono">${esc(b.type)}</span> · Figma: ${esc(d.figma)}</div>
      <div class="form">${Object.entries(d.props).map(([k, f]) => fieldHtml(f, `props.${k}`, b.props[k])).join("")}</div>
      ${d.items ? `<h3>${esc(d.items.label)}s · ${b.items.length}/${d.items.max}</h3><div>${b.items.map((it, j) => `<div class="pb-item"><div class="row small" style="margin-bottom:6px"><b>${esc(d.items.label)} ${j + 1}</b><span class="grow"></span>
          <button class="btn sm ghost" data-it="up" data-j="${j}" ${j ? "" : "disabled"}>↑</button><button class="btn sm ghost" data-it="down" data-j="${j}" ${j < b.items.length - 1 ? "" : "disabled"}>↓</button><button class="btn sm ghost" data-it="dup" data-j="${j}" ${b.items.length < d.items.max ? "" : "disabled"}>⧉</button><button class="btn sm ghost danger" data-it="rm" data-j="${j}">✕</button></div>
          <div class="form">${Object.entries(d.items.fields).map(([k, f]) => (b.type === "modular-cards" && ((it.variant === "solid" && k === "image") || (it.variant !== "solid" && ["bg", "text"].includes(k)))) ? "" : fieldHtml(f, `items.${j}.${k}`, it[k])).join("")}</div></div>`).join("")}</div>
        ${b.items.length < d.items.max ? `<button class="btn sm" data-it="add">＋ ${esc(d.items.label)}</button>` : ""}` : ""}
      <details class="pb-adv" ${["background", "fullBleed"].some((k) => b.props[k] !== (d.defaults?.[k] ?? E.COMMON[k].default)) ? "open" : ""}><summary>Aparência e espaçamento</summary><div class="form">${Object.entries(E.COMMON).filter(([k]) => k !== "backgroundImage" || b.props.background === "image").map(([k, f]) => fieldHtml(f, `props.${k}`, b.props[k])).join("")}</div></details>`;
    bindForm(box, b);
    if (b.props.productSource) drawProducts(b);
  }

  function bindForm(box, b) {
    $$("[data-path]", box).forEach((inp) => {
      const ev = inp.type === "checkbox" || inp.type === "radio" || inp.tagName === "SELECT" ? "change" : "input";
      inp.addEventListener(ev, () => {
        const p = inp.dataset.path;
        let v = inp.type === "checkbox" ? inp.checked : inp.value;
        if (inp.dataset.type === "num") v = Number(v);
        setPath(b, p, v);
        if (inp.type === "range" || inp.type === "number") $$(`[data-path="${p}"]`, box).forEach((o) => { if (o !== inp) o.value = v; });
        if (p.endsWith(".url")) linkInfo(box, p.slice(0, -4), v);
        if (p.endsWith(".src")) imgInfo(box, p.slice(0, -4), v);
        const structural = p === "props.background" || p.endsWith(".variant") || p === "props.limit" || p.endsWith(".bg");
        if (p === "props.limit" && b.props.productSource?.mode === "rule") b.props.productSource.limit = v;
        if (inp.type === "radio") $$(`input[name="${inp.name}"]`, box).forEach((r) => r.closest("label").classList.toggle("on", r.checked));
        if (structural && (p.endsWith(".variant") || p === "props.background")) drawBlock(box);
        changed();
        if (p === "props.title" || p.endsWith(".title")) { const st = $("#pb-blocks"); if (st) drawStructure($("#pb-tab")); }
      });
    });
    $$("[data-imginfo]", box).forEach((s) => imgInfo(box, s.dataset.imginfo, getPath(b, s.dataset.imginfo)?.src));
    $$("[data-wrap]", box).forEach((btn) => (btn.onclick = () => {
      const ta = $(`#${btn.dataset.for}`), t = btn.dataset.wrap;
      const [s, e] = [ta.selectionStart, ta.selectionEnd], sel = ta.value.slice(s, e) || "texto";
      const rep = t === "a" ? `<a href="/">${sel}</a>` : t === "ul" ? `<ul>${sel.split(/\n/).map((l) => `<li>${l}</li>`).join("")}</ul>` : `<${t}>${sel}</${t}>`;
      ta.value = ta.value.slice(0, s) + rep + ta.value.slice(e);
      ta.dispatchEvent(new Event("input"));
    }));
    $$("[data-it]", box).forEach((btn) => (btn.onclick = () => {
      const j = +btn.dataset.j, a = btn.dataset.it, it = b.items;
      if (a === "add") it.push(E.normalizeBlock({ type: b.type, items: [{}] }).items[0]);
      if (a === "rm") it.splice(j, 1);
      if (a === "dup") it.splice(j + 1, 0, structuredClone(it[j]));
      if (a === "up" && j > 0) [it[j - 1], it[j]] = [it[j], it[j - 1]];
      if (a === "down" && j < it.length - 1) [it[j + 1], it[j]] = [it[j], it[j + 1]];
      drawBlock(box); changed();
    }));
  }
  function linkInfo(box, path, url) {
    const s = $(`[data-linkinfo="${path}"]`, box); if (!s) return;
    if (!url) { s.innerHTML = ""; return; }
    const n = E.normalizeUrl(url, PB.el.market);
    s.innerHTML = n.error ? `<span class="pb-err">${esc(n.error)}</span>` : `<span class="pb-help">→ ${esc(n.url)}${n.warn ? ` <b style="color:var(--warn)">${esc(n.warn)}</b>` : ""}</span>`;
  }
  function imgInfo(box, path, src) {
    const s = $(`[data-imginfo="${path}"]`, box); if (!s) return;
    if (!src) { s.innerHTML = ""; return; }
    if (!E.isHttpsUrl(src)) { s.innerHTML = `<span class="pb-err">A imagem tem de estar em https://</span>`; return; }
    const im = new Image();
    im.onload = () => { s.innerHTML = `<img class="pb-thumb" src="${esc(src)}" alt=""/><span class="pb-help">${im.naturalWidth}×${im.naturalHeight}</span>`; };
    im.onerror = () => { s.innerHTML = `<span class="pb-err">Não foi possível carregar a imagem.</span>`; };
    im.src = src;
  }

  // ---------- product source: manual (shared ProductPicker) or rule (live count)
  const countText = () => { const b = blk(); if (!b?.props.productSource) return ""; const n = PB.hyd.counts?.[b.id]; return n == null ? "" : b.props.productSource.mode === "rule" ? `${n} produto(s) correspondem · mostra ${Math.min(n, b.props.limit)}` : `${n} escolhido(s)`; };
  async function drawProducts(b) {
    const box = $("#pb-products"); if (!box) return;
    const src = b.props.productSource, market = PB.el.market;
    box.innerHTML = `<div class="f" style="font-size:12px;color:var(--muted)">Produtos</div>
      <div class="chips" style="margin:4px 0 8px"><span class="chip ${src.mode === "rule" ? "on" : ""}" data-mode="rule">Regra (do feed)</span><span class="chip ${src.mode === "manual" ? "on" : ""}" data-mode="manual">Escolher produtos</span></div>
      <div id="pb-src"></div><div class="small" style="margin-top:6px"><b id="pb-count">${esc(countText())}</b></div>`;
    $$("[data-mode]", box).forEach((c) => (c.onclick = () => {
      if (c.dataset.mode === src.mode) return;
      b.props.productSource = c.dataset.mode === "manual" ? { mode: "manual", ids: (PB.hyd.products[b.id] || []).filter((p) => !p.missing).map((p) => p.id) } : E.normalizeSource({ mode: "rule" }, b.props.limit);
      drawProducts(b); changed();
    }));
    const inner = $("#pb-src", box);
    if (src.mode === "manual") {
      PB.pickers[b.id] ||= PP.newState();
      return PP.mount(inner, {
        market, state: PB.pickers[b.id], addLabel: "Adicionar", selectedLabel: "✓ no bloco",
        selected: { title: "Produtos do bloco", ids: () => src.ids, onChange: (ids) => { src.ids = ids.slice(0, 48); if (src.ids.length > b.props.limit) { b.props.limit = Math.min(24, src.ids.length); $$('[data-path="props.limit"]').forEach((o) => (o.value = b.props.limit)); } changed(); } },
      });
    }
    const tree = await guard(() => PP.categories(market));
    const cats = tree?.children || [], subs = cats.find((c) => c.name === src.category)?.children || [];
    inner.innerHTML = `<div class="form">
      <div class="grid two"><label class="f">Categoria<select data-r="category"><option value="">Todas</option>${cats.map((c) => `<option value="${esc(c.name)}" ${c.name === src.category ? "selected" : ""}>${esc(c.name)} (${c.count})</option>`).join("")}</select></label>
        <label class="f">Subcategoria<select data-r="subcategory" ${subs.length ? "" : "disabled"}><option value="">Todas</option>${subs.map((c) => `<option value="${esc(c.name)}" ${c.name === src.subcategory ? "selected" : ""}>${esc(c.name)} (${c.count})</option>`).join("")}</select></label></div>
      <div class="row"><label class="chk"><input type="checkbox" data-r="onSale" ${src.onSale ? "checked" : ""}/> Em promoção</label><label class="chk"><input type="checkbox" data-r="inStock" ${src.inStock !== false ? "checked" : ""}/> Só em stock</label></div>
      <div class="row small">Preço <input type="number" min="0" data-r="priceMin" value="${esc(src.priceMin ?? "")}" placeholder="mín" style="width:80px"/>–<input type="number" min="0" data-r="priceMax" value="${esc(src.priceMax ?? "")}" placeholder="máx" style="width:80px"/> €
        <select data-r="sort">${E.SORTS.map(([v, l]) => `<option value="${v}" ${src.sort === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="row"><button class="btn sm" id="pb-freeze">Congelar em lista manual</button><span class="pb-help">fixa os produtos que a regra dá agora</span></div></div>`;
    $$("[data-r]", inner).forEach((i) => i.addEventListener(i.type === "checkbox" || i.tagName === "SELECT" ? "change" : "input", () => {
      const k = i.dataset.r;
      let v = i.type === "checkbox" ? i.checked : i.value;
      if (k === "priceMin" || k === "priceMax") { if (v === "") delete src[k]; else src[k] = Number(v); } else src[k] = v;
      if (k === "category") { src.subcategory = ""; drawProducts(b); }
      changed();
    }));
    $("#pb-freeze", inner).onclick = async () => {
      PB.hydKey = ""; await hydrate(PB.el);
      const ids = (PB.hyd.products[b.id] || []).filter((p) => !p.missing).map((p) => p.id);
      if (!ids.length) return toast("A regra não dá nenhum produto", true);
      b.props.productSource = { mode: "manual", ids };
      drawProducts(b); changed(); toast(`${ids.length} produtos fixados`);
    };
  }

  // ---------- AI refine (whole element or selected block) with diff → apply
  function drawAI(box) {
    const b = blk(), P = PB.pending;
    box.innerHTML = `
      <div class="form">
        <div class="chips"><span class="chip ${PB.aiScope !== "block" ? "on" : ""}" data-scope="element">Elemento todo</span><span class="chip ${PB.aiScope === "block" ? "on" : ""} ${b ? "" : "hidden"}" data-scope="block">Bloco selecionado${b ? `: ${esc(E.BLOCKS[b.type].label)}` : ""}</span></div>
        <label class="f">Instrução<textarea id="pb-ins" rows="4" placeholder="${PB.aiScope === "block" ? "Ex.: título mais curto e o texto em 2 frases" : "Ex.: põe o título mais curto e troca para 3 colunas"}">${esc(PB.aiIns || "")}</textarea></label>
        <label class="chk"><input type="checkbox" id="pb-copy" ${PB.aiCopy ? "checked" : ""}/> Só textos (mais rápido e barato — Haiku)</label>
        <div class="row"><button class="btn primary" id="pb-ai-go">Pedir à IA</button><span id="pb-ai-st" class="small muted"></span></div>
      </div>
      ${P ? `<div class="card" style="margin-top:12px;padding:12px"><b>${P.diff.length} alteraç${P.diff.length === 1 ? "ão" : "ões"}</b> <span class="small muted">(${esc(P.model)}, ${(P.ms / 1000).toFixed(0)} s)</span>
        <ul class="small" style="margin:6px 0;padding-left:18px">${P.diff.map((d) => `<li>${esc(d)}</li>`).join("") || "<li>Sem diferenças</li>"}</ul>
        ${P.notes?.length ? `<div class="callout small">${P.notes.map((n) => `• ${esc(n)}`).join("<br>")}</div>` : ""}
        <label class="chk small" style="margin:8px 0"><input type="checkbox" id="pb-showp" ${PB.showPending ? "checked" : ""}/> Ver a proposta na pré-visualização</label>
        <div class="row"><button class="btn primary" id="pb-apply">Aplicar</button><button class="btn" id="pb-discard">Descartar</button></div></div>` : ""}`;
    $$("[data-scope]", box).forEach((c) => (c.onclick = () => { PB.aiScope = c.dataset.scope; PB.aiIns = $("#pb-ins").value; drawAI(box); }));
    $("#pb-ins").oninput = (e) => (PB.aiIns = e.target.value);
    $("#pb-copy").onchange = (e) => (PB.aiCopy = e.target.checked);
    $("#pb-ai-go").onclick = (e) => guard(async () => {
      const instruction = $("#pb-ins").value.trim();
      if (!instruction) return toast("Escreve a instrução", true);
      const body = { current: PB.el, instruction, copyOnly: $("#pb-copy").checked, market: PB.el.market, page: PB.el.page, author: author(), ...(PB.aiScope === "block" && b ? { blockId: b.id } : {}) };
      const res = await runGeneration(body, $("#pb-ai-st"));
      res.element = E.normalizeElement({ ...res.element, id: PB.el.id }); delete res.element.notes;
      res.diff = E.diffElements(PB.el, res.element);
      PB.pending = res; PB.showPending = true; PB.hydKey = "";
      drawAI(box); preview(true);
    }, e.target);
    if (P) {
      $("#pb-showp").onchange = (e) => { PB.showPending = e.target.checked; PB.hydKey = ""; preview(true); };
      $("#pb-apply").onclick = () => { PB.el = P.element; PB.pending = null; PB.aiIns = ""; if (!blk()) PB.sel = PB.el.blocks[0]?.id || null; PB.hydKey = ""; drawWorkspace(PB.main); toast("Alterações aplicadas (guarda para manter)"); };
      $("#pb-discard").onclick = () => { PB.pending = null; PB.hydKey = ""; drawAI(box); preview(true); };
    }
  }

  // ------------------------------------------------------------------ Gerar HTML: validate → output panel
  async function drawExport(main) {
    PB.screen = "export";
    main.innerHTML = `
      <style>.pb-out{display:grid;grid-template-columns:minmax(0,1fr) 375px;gap:16px;align-items:start}.pb-out .fw{background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.pb-out iframe{border:0;display:block;background:#fff;transform-origin:0 0}</style>
      <div class="head"><div><a href="#" id="pb-back" class="small">← Voltar ao editor</a><h1 style="margin:4px 0 0">Gerar HTML · ${esc(PB.el.name)}</h1><div class="small muted">${esc(MARKETS[PB.el.market])} · ${esc(PAGES[PB.el.page])}${dirty() ? ` · <b style="color:var(--warn)">alterações por guardar</b>` : ""}</div></div>
        <div class="row"><button class="btn" id="pb-regen">Validar e gerar de novo</button><button class="btn" id="pb-dl" disabled>Descarregar .html</button><button class="btn primary" id="pb-copyhtml" disabled>Copiar HTML</button></div></div>
      <div id="pb-val" class="card"><p class="muted">A validar e a resolver os produtos no feed…</p></div>
      <div id="pb-outbox"></div>`;
    $("#pb-back").onclick = (e) => { e.preventDefault(); PB.screen = "edit"; drawWorkspace(main); };
    const run = () => guard(async () => {
      if (dirty() && PB.el.id) await save(main, true);
      PB.exportRes = await api("/page-builder/export", { method: "POST", body: { element: PB.el, author: author() } });
      if (PB.rec && PB.exportRes.check.ok) PB.rec.lastExport = { generatedAt: PB.exportRes.generatedAt };
      showExport();
    }, $("#pb-regen"));
    $("#pb-regen").onclick = run;
    run();
  }
  function showExport() {
    const r = PB.exportRes, c = r.check;
    $("#pb-val").innerHTML = (c.errors.length ? `<div class="callout" style="border-color:#e8b4b4;background:#fbeeee"><b>Corrige antes de exportar:</b><br>${c.errors.map((e) => `✕ ${esc(e)}`).join("<br>")}</div>` : `<div class="callout info">✓ Pronto para colar num componente <b>Raw HTML</b> do Page Designer · <b>${(r.bytes / 1024).toFixed(1)} KB</b>${r.bytes > 100 * 1024 ? ` <b style="color:var(--warn)">(acima de 100 KB)</b>` : ""} · ${r.caps.js ? "com JavaScript (setas)" : "sem JavaScript"}</div>`)
      + (c.warnings.length ? `<div class="small" style="color:var(--warn);margin-top:8px">${c.warnings.map((w) => `⚠ ${esc(w)}`).join("<br>")}</div>` : "")
      + `<div class="callout small" style="margin-top:8px">⚠ Os preços, promoções e o stock ficam <b>fixos</b> no HTML (feed de ${esc(fmtDate(r.feedGeneratedAt))}). Depois de mudanças de preço, volta a gerar e substitui o HTML no Page Designer — a lista marca o elemento como “desatualizado”.</div>`;
    $("#pb-copyhtml").disabled = $("#pb-dl").disabled = !c.ok;
    if (!c.ok) { $("#pb-outbox").innerHTML = ""; return; }
    $("#pb-outbox").innerHTML = `
      <div class="pb-out" style="margin-top:12px">
        <div><div class="small muted" style="margin-bottom:4px">Desktop 1440px</div><div class="fw" id="pb-fw"><iframe id="pb-od" title="Desktop" scrolling="no"></iframe></div></div>
        <div><div class="small muted" style="margin-bottom:4px">Mobile 375px</div><div class="fw"><iframe id="pb-om" title="Mobile" scrolling="no" style="width:375px"></iframe></div></div>
      </div>
      <h3>Código</h3><textarea readonly rows="10" style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:11px">${esc(r.html)}</textarea>`;
    const doc = E.previewDocument(r.html, { title: PB.el.name });
    const fd = $("#pb-od"), fm = $("#pb-om"), wrap = $("#pb-fw");
    fd.srcdoc = doc; fm.srcdoc = doc;
    fd.onload = () => { const s = Math.min(1, wrap.clientWidth / 1440); const f = () => { const h = fd.contentDocument.documentElement.scrollHeight; fd.style.width = "1440px"; fd.style.height = h + "px"; fd.style.transform = `scale(${s})`; wrap.style.height = Math.ceil(h * s) + "px"; }; f(); new fd.contentWindow.ResizeObserver(f).observe(fd.contentDocument.body); fd.contentDocument.addEventListener("click", (e) => e.preventDefault()); };
    fm.onload = () => { const f = () => (fm.style.height = fm.contentDocument.documentElement.scrollHeight + "px"); f(); new fm.contentWindow.ResizeObserver(f).observe(fm.contentDocument.body); fm.contentDocument.addEventListener("click", (e) => e.preventDefault()); };
    $("#pb-copyhtml").onclick = async () => { await navigator.clipboard.writeText(r.html); toast("HTML copiado"); };
    $("#pb-dl").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.html], { type: "text/html" })); // exactly what goes into Raw HTML
      a.download = `${r.elementId}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }
})();
