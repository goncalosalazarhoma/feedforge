/* FeedForge UI — vanilla JS, no build step. */
(() => {
  "use strict";

  const VIRTUALS = ["_is_new", "_days_since_first_seen", "_price", "_sale_price", "_effective_price", "_discount_pct", "_title_length", "_description_length"];
  const OP_LABEL = { equals: "é igual a", not_equals: "é diferente de", contains: "contém", not_contains: "não contém", starts_with: "começa por", ends_with: "termina em", in: "está na lista", not_in: "não está na lista", regex: "regex", empty: "está vazio", not_empty: "não está vazio", gt: ">", gte: "≥", lt: "<", lte: "≤" };
  const ACT_LABEL = { set: "Definir valor", append: "Acrescentar no fim", prepend: "Acrescentar no início", replace: "Substituir texto", remove: "Remover texto", case: "Maiúsc./minúsc.", truncate: "Truncar", strip_html: "Remover HTML", clean: "Limpar espaços", map_values: "Mapear valores", price_bucket: "Faixa de preço", copy: "Copiar de campo", exclude: "Excluir produto" };
  const TF_LABEL = { copy: "copiar", availability: "availability (Meta→GMC)", condition: "condition", age_group: "age_group", gender: "gender", list: "lista (vírgulas)", template: "template {{campo}}", constant: "valor fixo", identifier_exists: "identifier_exists (auto)", price: "preço (0.00 EUR)" };
  const FLAG_LABEL = { "title:empty": "Título vazio", "title:short": "Título curto", "title:long": "Título longo", "title:caps": "Título em maiúsculas", "title:promo": "Promo no título", "title:duplicate": "Título duplicado", "description:empty": "Descrição vazia", "description:short": "Descrição curta", "description:same_as_title": "Descrição = título", "description:html": "HTML na descrição", "description:caps": "Descrição em maiúsculas", "description:long": "Descrição > 5000", "gtin:invalid": "GTIN inválido", "image_link:invalid": "Imagem inválida" };

  const S = { pw: null, me: null, feeds: [], feedId: null, cfg: null, summary: null, view: "dashboard", products: { q: "", filter: "all", flag: "", page: 1 }, poll: null };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const fmtDate = (s) => (s ? new Date(s).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : "—");
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  function toast(msg, bad = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.className = "toast"), bad ? 5000 : 2500);
  }

  async function api(path, { method = "GET", body, raw = false } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { authorization: `Bearer ${S.pw}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { logout(); throw new Error("Sessão expirada"); }
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  }
  const F = (p = "") => `/feeds/${encodeURIComponent(S.feedId)}${p}`;

  async function guard(fn, btn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    S.pw = lsGet("ff_pw");
    if (!S.pw) return showLogin();
    try {
      S.me = await api("/me");
    } catch { return showLogin(); }
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await loadFeeds();
    const hashView = location.hash.slice(1);
    if (hashView) S.view = hashView;
    render();
  }
  function showLogin() {
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
    $("#login-pw").focus();
  }
  function logout() { lsSet("ff_pw", null); S.pw = null; showLogin(); }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    S.pw = $("#login-pw").value;
    try {
      S.me = await api("/me");
      lsSet("ff_pw", S.pw);
      boot();
    } catch (err) { $("#login-err").textContent = err.message; }
  });
  $("#logout").onclick = logout;

  async function loadFeeds() {
    S.feeds = await api("/feeds");
    const sel = $("#feed-select");
    sel.innerHTML = S.feeds.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("") || `<option value="">— sem feeds —</option>`;
    S.feedId = S.feeds.find((f) => f.id === lsGet("ff_feed"))?.id || S.feeds[0]?.id || null;
    if (S.feedId) sel.value = S.feedId;
    await loadFeed();
  }
  async function loadFeed() {
    if (!S.feedId) { S.cfg = null; S.summary = null; return; }
    S.summary = await api(F("/summary"));
    S.cfg = S.summary.config;
    updateRunStatus();
  }
  $("#feed-select").onchange = async (e) => {
    S.feedId = e.target.value;
    lsSet("ff_feed", S.feedId);
    S.products.page = 1;
    await loadFeed();
    render();
  };
  $("#new-feed").onclick = () => newFeedModal();
  $("#nav").onclick = (e) => {
    const v = e.target.dataset.view;
    if (!v) return;
    S.view = v;
    location.hash = v;
    render();
  };

  function newFeedModal() {
    modal(`
      <h2>Novo feed</h2>
      <div class="form">
        <label class="f">Nome <input id="nf-name" placeholder="hôma PT" /></label>
        <label class="f">Língua <select id="nf-lang"><option value="pt-PT">Português (PT)</option><option value="es-ES">Español (ES)</option></select></label>
        <label class="f">URL do CSV (feed Meta de origem) <input id="nf-url" placeholder="https://…/meta_homa_pt_pt.csv" /></label>
        <div class="row"><span class="grow"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="nf-ok">Criar</button></div>
      </div>`);
    $("#nf-ok").onclick = (e) => guard(async () => {
      const cfg = await api("/feeds", { method: "POST", body: { name: $("#nf-name").value, language: $("#nf-lang").value, sourceUrl: $("#nf-url").value.trim() } });
      closeModal();
      lsSet("ff_feed", cfg.id);
      await loadFeeds();
      S.view = "settings";
      render();
      toast("Feed criado — confirma as definições e corre o primeiro run");
    }, e.target);
  }

  function modal(html) {
    $("#modal-card").innerHTML = html;
    $("#modal").classList.remove("hidden");
    $$("[data-close]", $("#modal-card")).forEach((b) => (b.onclick = closeModal));
  }
  function closeModal() { $("#modal").classList.add("hidden"); }
  $("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
  $("#drawer").onclick = (e) => { if (e.target.id === "drawer") closeDrawer(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal(); closeDrawer(); } });
  function closeDrawer() { $("#drawer").classList.add("hidden"); }

  function updateRunStatus() {
    const el = $("#run-status");
    const s = S.summary;
    if (!s) { el.innerHTML = ""; return; }
    const last = s.runs?.[0];
    if (s.running) el.innerHTML = `<span class="dot running"></span>Run em curso…`;
    else if (last) el.innerHTML = `<span class="dot ${last.status === "error" ? "error" : ""}"></span>Último run: ${fmtDate(last.finishedAt)}`;
    else el.innerHTML = `<span class="dot error"></span>Ainda sem runs`;
    clearTimeout(S.poll);
    if (s.running) S.poll = setTimeout(async () => { await loadFeed(); if (!S.summary.running) { toast("Run terminado"); render(); } }, 5000);
  }

  // ------------------------------------------------------------------ render
  const VIEWS = {};
  function render() {
    $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === S.view));
    const main = $("#main");
    if (!S.feedId) {
      main.innerHTML = `<div class="card empty"><h2>Bem-vindo ao FeedForge</h2><p>Cria o primeiro feed para começar.</p><button class="btn primary" id="first-feed">Criar feed</button></div>`;
      $("#first-feed").onclick = newFeedModal;
      return;
    }
    (VIEWS[S.view] || VIEWS.dashboard)(main);
  }

  async function saveConfig(patch, msg = "Guardado") {
    S.cfg = await api(F(), { method: "PUT", body: patch });
    if (S.summary) S.summary.config = S.cfg;
    toast(msg);
    return S.cfg;
  }

  function headers() {
    const h = S.summary?.headers || [];
    return h.length ? h : ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "brand", "gtin", "product_type", "color", "size", "material", "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"];
  }
  const fieldOptions = (sel, withVirtual = false, extra = []) => {
    const list = [...new Set([...headers(), ...extra, ...(withVirtual ? VIRTUALS : [])])];
    if (sel && !list.includes(sel)) list.push(sel);
    return list.map((f) => `<option value="${esc(f)}" ${f === sel ? "selected" : ""}>${esc(f)}${S.cfg.lockedFields.includes(f) ? " 🔒" : ""}</option>`).join("");
  };

  // ------------------------------------------------------------------ dashboard
  VIEWS.dashboard = (main) => {
    const s = S.summary, o = s.output, last = s.runs?.[0];
    const kpi = (v, l, filter) => `<div class="card kpi ${filter ? "click" : ""}" ${filter ? `data-filter="${filter}"` : ""}><div class="v">${v ?? "—"}</div><div class="l">${l}</div></div>`;
    const links = o?.links || {};
    main.innerHTML = `
      <div class="head">
        <div><h1>${esc(S.cfg.name)}</h1><div class="muted">Feed de origem atualizado em ${fmtDate(s.sourceFetchedAt)} · run diário às ${String(S.cfg.runHour).padStart(2, "0")}:00 (Lisboa)${S.cfg.scheduleEnabled ? "" : " — <b>agendamento desligado</b>"}</div></div>
        <div class="row">
          <button class="btn" id="btn-rebuild" title="Reaplica regras, edições e labels ao último feed descarregado e atualiza o Sheets (sem AI, sem novo download)">Aplicar alterações</button>
          <button class="btn primary" id="btn-run">Correr run completo</button>
        </div>
      </div>
      ${!S.cfg.sourceUrl ? `<div class="callout" style="margin-bottom:14px">Falta configurar o URL do feed de origem em <a href="#settings" data-go="settings">Definições</a>.</div>` : ""}
      ${!S.cfg.sheetId ? `<div class="callout" style="margin-bottom:14px">Ainda não há Google Sheet de destino — o output fica só na app até configurares em <a href="#settings" data-go="settings">Definições</a>.</div>` : ""}
      ${s.running ? `<div class="callout info" style="margin-bottom:14px">⏳ Run em curso — esta página atualiza sozinha.</div>` : ""}
      <div class="grid k">
        ${kpi(o?.meta, "produtos no feed Meta", "all")}
        ${kpi(o?.gmc, "produtos no feed GMC")}
        ${kpi(o?.isNew, "novos hoje", "new")}
        ${kpi(o?.flagged, "com campos sub-otimizados", "flagged")}
        ${kpi(o?.ai, "otimizados por AI", "ai")}
        ${kpi(s.aiQueue, "na fila de AI")}
        ${kpi(o?.edited, "editados manualmente", "edited")}
        ${kpi(o?.excluded, "excluídos", "excluded")}
      </div>
      <div class="grid two" style="margin-top:14px">
        <div class="card">
          <h2>Links finais (para Meta e GMC)</h2>
          ${linkBox("Meta", links.meta)}
          ${S.cfg.gmc?.enabled !== false ? linkBox("Google Merchant Center", links.gmc) : ""}
          <p class="muted small">Estes links leem diretamente o separador da Google Sheet em CSV. A sheet tem de estar partilhada como <i>“Qualquer pessoa com o link: leitor”</i>. Em alternativa, usa <i>Ficheiro → Partilhar → Publicar na Web → CSV</i> e cola esse link no Meta/GMC — o conteúdo é o mesmo.</p>
          <div class="row"><button class="btn sm" data-dl="meta">⬇ CSV Meta</button>${S.cfg.gmc?.enabled !== false ? `<button class="btn sm" data-dl="gmc">⬇ CSV GMC</button>` : ""}</div>
        </div>
        <div class="card">
          <h2>Último run</h2>
          ${last ? `
            <div class="row" style="margin-bottom:8px"><span class="badge ${last.status === "ok" ? "new" : "ex"}">${last.status}</span><span class="muted">${fmtDate(last.finishedAt)} · ${last.trigger === "schedule" ? "agendado" : "manual"} · ${last.mode === "rebuild" ? "aplicar alterações" : "completo"} · ${Math.round((last.durationMs || 0) / 1000)}s</span></div>
            ${last.diff ? `<table><tr><th>Novos</th><th>Removidos</th><th>Conteúdo alterado</th><th>Só stock/preço</th><th>Iguais</th></tr><tr><td>${last.diff.new}</td><td>${last.diff.removed}</td><td>${last.diff.changedContent}</td><td>${last.diff.changedLocked}</td><td>${last.diff.unchanged}</td></tr></table>` : ""}
            ${last.error ? `<p class="err">${esc(last.error)}</p>` : ""}
            <div class="steps" style="margin-top:10px">${last.steps.map((x) => esc(x.msg)).join("\n")}</div>` : `<p class="muted">Ainda não correu nenhum run. Configura as Definições e carrega em “Correr run completo”.</p>`}
        </div>
      </div>
      ${o?.flagCount && Object.keys(o.flagCount).length ? `
      <div class="card" style="margin-top:14px">
        <h2>Problemas de qualidade detetados</h2>
        <table>${Object.entries(o.flagCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr class="click" data-flag="${esc(k)}"><td>${esc(FLAG_LABEL[k] || k)}</td><td class="muted mono">${esc(k)}</td><td style="text-align:right"><b>${n}</b></td></tr>`).join("")}</table>
      </div>` : ""}
    `;
    $("#btn-run").onclick = (e) => startRun("full", e.target);
    $("#btn-rebuild").onclick = (e) => startRun("rebuild", e.target);
    $$("[data-filter]", main).forEach((el) => (el.onclick = () => { S.products = { ...S.products, filter: el.dataset.filter, flag: "", page: 1 }; S.view = "products"; render(); }));
    $$("[data-flag]", main).forEach((el) => (el.onclick = () => { S.products = { ...S.products, filter: "all", flag: el.dataset.flag, page: 1 }; S.view = "products"; render(); }));
    $$("[data-go]", main).forEach((el) => (el.onclick = (e) => { e.preventDefault(); S.view = el.dataset.go; render(); }));
    $$("[data-copy]", main).forEach((el) => (el.onclick = () => { navigator.clipboard.writeText(el.dataset.copy); toast("Link copiado"); }));
    $$("[data-dl]", main).forEach((el) => (el.onclick = () => download(el.dataset.dl)));
  };

  function linkBox(label, url) {
    return `<div style="margin-bottom:10px"><div class="small muted" style="margin-bottom:4px">${label}</div>${url
      ? `<div class="link-box"><code>${esc(url)}</code><button class="btn sm" data-copy="${esc(url)}">Copiar</button><a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">Abrir</a></div>`
      : `<div class="link-box"><span class="muted small">Disponível depois do primeiro run com Sheet configurada</span></div>`}</div>`;
  }

  async function download(ch) {
    await guard(async () => {
      const res = await api(F(`/export/${ch}.csv`), { raw: true });
      if (!res.ok) throw new Error("Sem output — corre um run primeiro");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${S.feedId}-${ch}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  async function startRun(mode, btn) {
    await guard(async () => {
      await api(F("/run"), { method: "POST", body: { mode } });
      toast(mode === "rebuild" ? "A aplicar alterações…" : "Run iniciado…");
      await new Promise((r) => setTimeout(r, 1500));
      await loadFeed();
      S.summary.running = true;
      updateRunStatus();
      render();
    }, btn);
  }

  // ------------------------------------------------------------------ products
  VIEWS.products = async (main) => {
    const P = S.products;
    const chips = [["all", "Todos"], ["new", "Novos"], ["flagged", "Sub-otimizados"], ["ai", "Com AI"], ["edited", "Editados"], ["excluded", "Excluídos"]];
    main.innerHTML = `
      <div class="head">
        <div><h1>Produtos</h1><div class="muted">Clica num produto para editar campos, ver o antes/depois e gerar copy com AI.</div></div>
        <div class="row"><button class="btn" id="bulk-ai" title="Envia os produtos deste filtro para a fila de AI (processados no próximo run completo)">Enviar filtro para AI</button></div>
      </div>
      <div class="card">
        <div class="row" style="margin-bottom:12px">
          <input id="p-q" placeholder="Pesquisar por id ou título…" value="${esc(P.q)}" style="min-width:260px" />
          <div class="chips">${chips.map(([k, l]) => `<span class="chip ${P.filter === k && !P.flag ? "on" : ""}" data-f="${k}">${l}</span>`).join("")}${P.flag ? `<span class="chip on" data-f="all">${esc(FLAG_LABEL[P.flag] || P.flag)} ✕</span>` : ""}</div>
        </div>
        <div id="p-list"><div class="empty">A carregar…</div></div>
      </div>`;
    let t;
    $("#p-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { P.q = e.target.value; P.page = 1; loadList(); }, 250); };
    $$("[data-f]", main).forEach((c) => (c.onclick = () => { P.filter = c.dataset.f; P.flag = ""; P.page = 1; VIEWS.products(main); }));
    $("#bulk-ai").onclick = (e) => guard(async () => {
      const r = await api(F(`/products?${qs({ ids: 1, size: 1 })}`));
      if (!r.ids?.length) return toast("Nenhum produto neste filtro");
      if (!confirm(`Enviar ${r.ids.length} produtos para a fila de AI? A copy AI existente destes produtos será regenerada no próximo run completo.`)) return;
      const q = await api(F("/ai-requests"), { method: "POST", body: { ids: r.ids, clearExisting: false } });
      toast(`${q.queued} produtos na fila — serão otimizados no próximo run completo`);
    }, e.target);
    loadList();
  };
  function qs(extra = {}) {
    const P = S.products;
    return new URLSearchParams({ q: P.q, filter: P.filter, flag: P.flag, page: P.page, size: 50, ...extra }).toString();
  }
  async function loadList() {
    const box = $("#p-list");
    if (!box) return;
    const r = await guard(() => api(F(`/products?${qs()}`)));
    if (!r) return;
    if (!r.total) { box.innerHTML = `<div class="empty">${S.summary.output ? "Nenhum produto encontrado." : "Ainda não há produtos — corre o primeiro run no Dashboard."}</div>`; return; }
    const pages = Math.ceil(r.total / r.size);
    box.innerHTML = `
      <table>
        <tr><th></th><th>ID</th><th>Título (final)</th><th>Preço</th><th>Stock</th><th>Estado</th></tr>
        ${r.items.map((i) => `
          <tr class="click" data-id="${esc(i.id)}">
            <td>${i.image ? `<img class="thumb" loading="lazy" src="${esc(i.image)}" alt="" onerror="this.style.visibility='hidden'" />` : ""}</td>
            <td class="mono">${esc(i.id)}</td>
            <td><div class="trunc">${esc(i.title)}</div>${i.flags.length ? `<div style="margin-top:4px">${i.flags.slice(0, 3).map((f) => `<span class="badge flag">${esc(FLAG_LABEL[f] || f)}</span>`).join("")}${i.flags.length > 3 ? `<span class="badge flag">+${i.flags.length - 3}</span>` : ""}</div>` : ""}</td>
            <td class="mono">${esc(i.price)}</td>
            <td class="small">${esc(i.availability)}</td>
            <td>${i.isNew ? `<span class="badge new">novo</span>` : ""}${i.ai ? `<span class="badge ai">AI</span>` : ""}${i.edited ? `<span class="badge edit">editado</span>` : ""}${i.excluded.meta ? `<span class="badge ex">fora Meta</span>` : ""}${i.excluded.gmc ? `<span class="badge ex">fora GMC</span>` : ""}</td>
          </tr>`).join("")}
      </table>
      <div class="pager"><span class="muted">${r.total} produtos · página ${r.page}/${pages}</span><button class="btn sm" id="pg-prev" ${r.page <= 1 ? "disabled" : ""}>←</button><button class="btn sm" id="pg-next" ${r.page >= pages ? "disabled" : ""}>→</button></div>`;
    $$("tr[data-id]", box).forEach((tr) => (tr.onclick = () => openProduct(tr.dataset.id)));
    $("#pg-prev").onclick = () => { S.products.page--; loadList(); };
    $("#pg-next").onclick = () => { S.products.page++; loadList(); };
  }

  async function openProduct(id) {
    const panel = $("#drawer-panel");
    panel.innerHTML = `<div class="empty">A carregar…</div>`;
    $("#drawer").classList.remove("hidden");
    const d = await guard(() => api(F(`/products/${encodeURIComponent(id)}`)));
    if (!d) return closeDrawer();
    const locked = new Set(d.locked);
    const fields = d.headers;
    panel.innerHTML = `
      <div class="head">
        <div>
          <div class="muted mono">${esc(d.id)} · visto pela 1ª vez a ${esc(d.firstSeen)}</div>
          <h1>${esc(d.final.title)}</h1>
          <div>${d.isNew ? `<span class="badge new">novo hoje</span>` : ""}${d.ai ? `<span class="badge ai">AI ${d.ai.manual ? "(aceite manualmente)" : ""}</span>` : ""}${d.excluded.meta ? `<span class="badge ex">excluído Meta</span>` : ""}${d.excluded.gmc ? `<span class="badge ex">excluído GMC</span>` : ""}</div>
        </div>
        <div class="row"><button class="btn" id="d-close">Fechar</button><button class="btn primary" id="d-save">Guardar edições</button></div>
      </div>
      ${d.flags.length ? `<div class="callout" style="margin-bottom:12px"><b>Sub-otimizado:</b> ${d.flags.map((f) => esc(f.msg)).join(" · ")}</div>` : ""}
      <div class="ai-box" style="margin-bottom:14px">
        <div class="row"><b>AI</b><span class="muted small grow">Campos: ${d.aiFields.join(", ")} · ${S.me.hasAnthropic ? "pronto" : "ANTHROPIC_API_KEY em falta"}</span>
          ${d.ai ? `<button class="btn sm danger" id="ai-del">Remover copy AI</button>` : ""}
          <button class="btn sm primary" id="ai-gen" ${S.me.hasAnthropic ? "" : "disabled"}>Gerar sugestão</button></div>
        <div id="ai-sugg"></div>
      </div>
      <div class="card" style="padding:0">
        <table class="field-table">
          <tr><th>Campo</th><th>Origem (CSV)</th><th>Final (editável)</th></tr>
          ${fields.map((f) => {
            const isLocked = locked.has(f);
            const ov = f in d.overrides;
            const long = String(d.final[f] ?? "").length > 80 || f === "description";
            return `<tr class="${isLocked ? "locked" : ""} ${ov ? "overridden" : ""}" data-field="${esc(f)}">
              <td>${esc(f)}${isLocked ? ` <span class="badge lock">🔒</span>` : ""}${d.afterAi[f] !== d.source[f] && d.ai ? ` <span class="badge ai">AI</span>` : ""}${ov ? ` <span class="badge edit">editado</span>` : ""}</td>
              <td class="src">${esc(d.source[f] ?? "")}</td>
              <td>${isLocked ? `<div class="small" style="white-space:pre-wrap;word-break:break-word">${esc(d.final[f] ?? "")}</div><div class="muted small">trancado — passa sempre direto da origem</div>`
                : `<textarea rows="${long ? 4 : 1}" data-f="${esc(f)}">${esc(d.final[f] ?? "")}</textarea>${ov ? `<button class="btn sm ghost" data-revert="${esc(f)}">↺ repor (regras/AI)</button>` : ""}`}</td>
            </tr>`;
          }).join("")}
        </table>
      </div>
      <div class="grid two" style="margin-top:14px">
        <div class="card"><h2>Regras aplicadas</h2>${d.appliedRules.length ? d.appliedRules.map((r) => `<div>• ${esc(r)}</div>`).join("") : `<span class="muted">Nenhuma</span>`}
          ${d.blocked.length ? `<p class="muted small">Ações ignoradas por campo trancado: ${d.blocked.map(esc).join(", ")}</p>` : ""}</div>
        <div class="card"><h2>Pré-visualização GMC</h2><table>${Object.entries(d.gmc).map(([k, v]) => `<tr><td class="mono muted">${esc(k)}</td><td class="small" style="word-break:break-word">${esc(String(v).slice(0, 160))}</td></tr>`).join("")}</table></div>
      </div>`;

    $("#d-close").onclick = closeDrawer;
    $$("[data-revert]", panel).forEach((b) => (b.onclick = () => guard(async () => {
      await api(F(`/products/${encodeURIComponent(d.id)}/overrides`), { method: "PUT", body: { fields: { [b.dataset.revert]: null } } });
      toast("Campo reposto"); openProduct(d.id);
    })));
    $("#d-save").onclick = (e) => guard(async () => {
      const changes = {};
      $$("textarea[data-f]", panel).forEach((ta) => {
        const f = ta.dataset.f;
        const val = ta.value;
        const computed = String(d.afterRules[f] ?? "");
        if (val !== String(d.final[f] ?? "")) changes[f] = val === computed ? null : val;
      });
      if (!Object.keys(changes).length) return toast("Sem alterações");
      await api(F(`/products/${encodeURIComponent(d.id)}/overrides`), { method: "PUT", body: { fields: changes } });
      toast("Edições guardadas — entram no Sheets no próximo run ou em “Aplicar alterações”");
      openProduct(d.id);
    }, e.target);
    if ($("#ai-del")) $("#ai-del").onclick = () => guard(async () => {
      await api(F(`/products/${encodeURIComponent(d.id)}/ai`), { method: "DELETE" });
      toast("Copy AI removida"); openProduct(d.id);
    });
    $("#ai-gen").onclick = (e) => guard(async () => {
      $("#ai-sugg").innerHTML = `<p class="muted">A gerar…</p>`;
      const r = await api(F(`/products/${encodeURIComponent(d.id)}/ai-preview`), { method: "POST" });
      const s = r.suggestion || {};
      if (!Object.keys(s).length) { $("#ai-sugg").innerHTML = `<p class="muted">Sem sugestão.</p>`; return; }
      $("#ai-sugg").innerHTML = `
        <div class="form" style="margin-top:10px">${Object.entries(s).map(([f, v]) => `<label class="f">${esc(f)} <span class="muted small">(${String(v).length} caracteres)</span><textarea data-ai="${esc(f)}" rows="${f === "description" ? 5 : 2}">${esc(v)}</textarea></label>`).join("")}
        <div class="row"><span class="grow"></span><button class="btn primary sm" id="ai-accept">Aceitar sugestão</button></div></div>`;
      $("#ai-accept").onclick = (ev) => guard(async () => {
        const fields = {};
        $$("[data-ai]", panel).forEach((ta) => (fields[ta.dataset.ai] = ta.value));
        await api(F(`/products/${encodeURIComponent(d.id)}/ai-accept`), { method: "POST", body: { fields } });
        toast("Copy AI aceite"); openProduct(d.id);
      }, ev.target);
    }, e.target);
  }

  // expose for part 2
  window.FF = { S, $, $$, esc, uid, clone, api, F, guard, toast, modal, closeModal, render, saveConfig, headers, fieldOptions, loadFeed, fmtDate, VIEWS, VIRTUALS, OP_LABEL, ACT_LABEL, TF_LABEL, startRun };
  window.addEventListener("DOMContentLoaded", boot);
})();
