/* FeedForge — PIM optimizer view (Akeneo XLSX exports). */
(() => {
  "use strict";
  const { S, $, $$, esc, toast, modal, closeModal, guard, fmtDate, VIEWS, ask } = window.FF;
  const P = { tab: "files", jobId: null, job: null, cfg: null, list: { q: "", filter: "", flag: "", page: 1 }, poll: null };

  const FLAG_LABEL = {
    "ATT_NAME:empty": "Nome vazio", "ATT_NAME:short": "Nome curto", "ATT_NAME:long": "Nome longo", "ATT_NAME:caps": "Nome em maiúsculas", "ATT_NAME:mixed_case": "Maiúsculas inconsistentes no nome",
    "ATT_PLP_NAME:empty": "Nome PLP vazio", "ATT_PLP_NAME:caps": "Nome PLP em maiúsculas",
    "ATT_LONG_DESCRIPTION:empty": "Descrição longa vazia", "ATT_LONG_DESCRIPTION:short": "Descrição longa curta p/ SEO", "ATT_LONG_DESCRIPTION:boilerplate": "Texto genérico / campanha", "ATT_LONG_DESCRIPTION:title_case": "Descrição Em Maiúsculas Por Palavra", "ATT_LONG_DESCRIPTION:html": "HTML na descrição",
    "_completeness:incomplete": "Completude < 100%", "_categories:no_ecom": "Sem categoria ecommerce", "_categories:no_leaf": "Categoria só no nível superior", "_categories:unlikely": "Categoria improvável para a família", "_categories:xmas_missing": "Natal fora da categoria Natal", "_categories:price_band": "Faixa de preço errada", "_required:missing_content": "Obrigatórios de conteúdo em falta", "_required:missing_data": "Obrigatórios de dados em falta (compras/logística)", "ATT_PLP_DESCRIPTION:dims_mismatch": "Descrição PLP ≠ dimensões", "_dimensions:suspicious": "Dimensões suspeitas",
  };
  const flagLabel = (f) => FLAG_LABEL[f] || f.replace(/:missing_(\w+)/, " sem $1");

  async function papi(path, { method = "GET", body } = {}) {
    const res = await fetch(`/pim-api${path}`, { method, headers: { authorization: `Bearer ${S.pw}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  }
  window.FF.papi = papi;

  let xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    xlsxLoading ||= new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => ok(window.XLSX);
      s.onerror = () => ko(new Error("Não foi possível carregar o leitor de Excel"));
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }

  // ================================================================ main view
  VIEWS.pim = async (main) => {
    if (!P.cfg) P.cfg = (await guard(() => papi("/config")))?.config;
    main.innerHTML = `
      <div class="head"><div><h1>PIM optimizer</h1><div class="muted">Diagnóstico e otimização de exports do Akeneo (nome, nome PLP, descrição longa SEO/GEO, PT + ES). Devolve um XLSX só com o <code>sku</code> e as colunas alteradas, pronto a importar.</div></div></div>
      <div class="chips" style="margin-bottom:14px">
        ${[["files", "Ficheiros"], ["labels", "Labels"], ["config", "Campos & AI"], ["dict", "Dicionário Akeneo"]].map(([k, l]) => `<span class="chip ${P.tab === k ? "on" : ""}" data-tab="${k}">${l}</span>`).join("")}
      </div>
      <div id="pim-body"></div>`;
    $$("[data-tab]", main).forEach((c) => (c.onclick = () => { P.tab = c.dataset.tab; P.jobId = null; VIEWS.pim(main); }));
    const body = $("#pim-body");
    if (P.tab === "config") return drawConfig(body);
    if (P.tab === "labels") return drawLabels(body);
    if (P.tab === "dict") return drawDict(body);
    if (P.jobId) return drawJob(body);
    return drawFiles(body);
  };

  // ================================================================ files
  async function drawFiles(box) {
    const jobs = (await guard(() => papi("/jobs"))) || [];
    box.innerHTML = `
      <div class="card">
        <h2>Carregar export do Akeneo</h2>
        <div class="row"><input type="file" id="pim-file" accept=".xlsx,.xls,.csv" /><span class="muted small" id="pim-up-status"></span></div>
        <p class="muted small">XLSX ou CSV exportado do Akeneo, com a coluna <code>sku</code>. O ficheiro é lido no browser; só os dados seguem para a app.</p>
      </div>
      <div class="card">
        <h2>Ficheiros</h2>
        ${jobs.length ? `<table><tr><th>Nome</th><th>Produtos</th><th>Carregado</th><th>Progresso AI</th><th></th></tr>
          ${jobs.map((j) => `<tr class="click" data-job="${esc(j.id)}"><td>${esc(j.name)}</td><td>${j.count ?? "—"}</td><td class="small">${fmtDate(j.createdAt)}</td>
            <td class="small">${j.progress ? `${j.progress.done}/${j.progress.total}${j.progress.remaining ? ` · ${j.progress.remaining} por fazer` : ""}` : "—"}</td>
            <td><button class="btn sm ghost danger" data-del="${esc(j.id)}">✕</button></td></tr>`).join("")}</table>` : `<p class="muted">Ainda não carregaste nenhum ficheiro.</p>`}
      </div>`;
    $("#pim-file").onchange = (e) => upload(e.target.files[0]);
    $$("tr[data-job]", box).forEach((tr) => (tr.onclick = (e) => { if (e.target.dataset.del) return; P.jobId = tr.dataset.job; P.list = { q: "", filter: "", flag: "", page: 1 }; drawJob(box); }));
    $$("[data-del]", box).forEach((b) => (b.onclick = () => guard(async () => { if (!(await ask("Apagar este ficheiro e as sugestões?", { ok: "Apagar", danger: true }))) return; await papi(`/jobs/${b.dataset.del}`, { method: "DELETE" }); drawFiles(box); })));
  }

  async function upload(file) {
    if (!file) return;
    const st = $("#pim-up-status");
    await guard(async () => {
      st.textContent = "A ler o ficheiro…";
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      const headers = aoa[0].map((h) => String(h).trim());
      const rows = aoa.slice(1).filter((r) => r.some((c) => c !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
      st.textContent = `${rows.length} produtos · ${headers.length} colunas — a enviar…`;
      const { id } = await papi("/jobs", { method: "POST", body: { name: file.name.replace(/\.(xlsx|xls|csv)$/i, ""), headers } });
      for (let i = 0; i < rows.length; i += 250) {
        await papi(`/jobs/${id}/rows`, { method: "POST", body: { rows: rows.slice(i, i + 250) } });
        st.textContent = `A enviar… ${Math.min(i + 250, rows.length)}/${rows.length}`;
      }
      st.textContent = "A diagnosticar…";
      await papi(`/jobs/${id}/finalize`, { method: "POST" });
      P.jobId = id;
      toast("Ficheiro carregado e diagnosticado");
      drawJob($("#pim-body"));
    });
  }

  // ================================================================ job
  async function drawJob(box) {
    const j = await guard(() => papi(`/jobs/${P.jobId}`));
    if (!j) return;
    P.job = j;
    const fc = Object.entries(j.flagCount || {}).sort((a, b) => b[1] - a[1]);
    const pr = j.progress;
    box.innerHTML = `
      <div class="head" style="margin-bottom:12px">
        <div><a href="#" id="pim-back" class="small">← Ficheiros</a><h2 style="margin:4px 0 0">${esc(j.name)}</h2><div class="muted small">${j.count} produtos · carregado ${fmtDate(j.createdAt)}</div></div>
        <div class="row">
          <button class="btn" id="pim-run" ${j.running ? "disabled" : ""}>Otimizar sinalizados com AI</button>
          <button class="btn" id="pim-run-all" ${j.running ? "disabled" : ""}>Otimizar todos</button>
          <button class="btn" id="pim-redo" ${j.running ? "disabled" : ""} title="Volta a gerar com AI todos os produtos, substituindo sugestões AI já aceites (as tuas edições manuais mantêm-se)">Refazer AI</button>
          <button class="btn" id="pim-accept">Aceitar todas as pendentes</button>
          <button class="btn primary" id="pim-export" title="Só sku + colunas alteradas — recomendado para importar no Akeneo">⬇ Exportar alterações</button>
          ${j.models ? `<button class="btn" id="pim-export-split" title="Dois ficheiros: produtos (sku) e modelos (code), para jobs de import separados no Akeneo">⬇ Produtos + modelos separados</button>` : ""}
          <button class="btn" id="pim-export-full" title="Todas as colunas do ficheiro original (+ colunas ES novas), com as alterações aceites aplicadas">⬇ Ficheiro completo</button>
        </div>
      </div>
      ${j.running || (pr && pr.remaining) ? `<div class="callout ${j.running ? "info" : ""}" style="margin-bottom:12px">${j.running ? "⏳ AI a trabalhar" : "Pausado"}: ${pr?.done ?? 0}/${pr?.total ?? 0} produtos${pr?.errors ? ` · ${pr.errors} erros` : ""}${pr?.fatal ? ` · <b class="err">${esc(pr.fatal)}</b>` : ""}${!j.running && pr?.remaining ? ` · ${pr.remaining} por fazer — carrega em "Otimizar sinalizados" para continuar` : ""}</div>` : ""}
      <div class="grid two">
        <div class="card"><h2>Diagnóstico</h2>
          ${fc.length ? `<table>${fc.map(([f, n]) => `<tr class="click" data-flag="${esc(f)}"><td>${esc(flagLabel(f))}</td><td style="text-align:right"><b>${n}</b></td></tr>`).join("")}</table>` : `<p class="muted">Sem problemas detetados.</p>`}
        </div>
        <div class="card"><h2>Estado</h2><div id="pim-kpis" class="muted">…</div></div>
      </div>
      <div class="grid two">
        <div class="card"><h2>Preenchido automaticamente (sem AI)</h2>
          ${Object.keys(j.autoCount || {}).length ? `<table>${Object.entries(j.autoCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const [src, col] = k.split(/:(.+)/); return `<tr><td class="mono small">${esc(col)}</td><td><span class="badge ${src === "label" ? "ai" : ""}">${src === "label" ? "label" : "dedução"}</span></td><td style="text-align:right"><b>${n}</b></td></tr>`; }).join("")}</table>
            <p class="muted small">Só preenche células vazias. Vês a origem de cada valor no produto (ex.: "Calculado: 62 x 26 x 17 cm").</p>` : `<p class="muted">Nada a preencher.</p>`}
          <button class="btn sm" id="pim-auto">Recalcular deduções e labels</button>
        </div>
        <div class="card"><h2>Imagens</h2><div id="pim-img">A carregar…</div></div>
      </div>
      <div class="card"><h2>Categorias</h2>
        ${(() => { const cf = Object.entries(j.flagCount || {}).filter(([k]) => k.startsWith("_categories:")); return cf.length ? `<div class="chips" style="margin-bottom:10px">${cf.map(([k, n]) => `<span class="chip" data-flag="${esc(k)}">${esc(flagLabel(k))} · <b>${n}</b></span>`).join("")}</div>` : `<p class="muted">Sem problemas de categorização detetados.</p>`; })()}
        <p class="muted small">Correções automáticas (categoria-mãe em falta, Natal, faixa de preço vs PVP) aparecem já como propostas. A AI propõe a categoria final certa e remove as erradas, usando só códigos existentes. Os códigos ERP (numéricos) nunca são alterados. As categorias não são aceites em bloco com o resto.</p>
        <div class="row"><button class="btn" id="pim-cat-run" ${j.running ? "disabled" : ""}>Propor re-categorização (AI)</button><button class="btn primary" id="pim-cat-review">Rever propostas de categorias</button><button class="btn" id="pim-cat-accept">Aceitar categorias propostas</button>
        ${j.progress?.mode === "categories" ? `<span class="muted small">Última proposta: ${j.progress.changed ?? 0} com alterações · ${j.progress.kept ?? 0} mantidas com justificação${j.progress.noAnswer ? ` · ${j.progress.noAnswer} sem resposta` : ""} · ${fmtDate(j.progress.finishedAt)}</span>` : ""}</div>
      </div>
      <div class="card"><h2>Recategorização</h2><div id="pim-cat-table" class="muted">A carregar…</div></div>
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <input id="pim-q" placeholder="Pesquisar sku ou nome…" value="${esc(P.list.q)}" style="min-width:240px" />
          <div class="chips">${[["", "Todos"], ["warnings", "⚠ A verificar"], ["errors", "Com erros"], ["todo", "Sem sugestão"], ["pending", "Por rever"], ["accepted", "Aceites"], ["seasonal", "Sazonais"], ...(P.job?.models ? [["models", "Modelos"]] : [])].map(([k, l]) => `<span class="chip ${P.list.filter === k && !P.list.flag ? "on" : ""}" data-f="${k}">${l}</span>`).join("")}
          ${P.list.flag ? `<span class="chip on" data-f="">${esc(flagLabel(P.list.flag))} ✕</span>` : ""}</div>
        </div>
        <div id="pim-list"></div>
      </div>`;
    $("#pim-back").onclick = (e) => { e.preventDefault(); P.jobId = null; drawFiles(box); };
    $("#pim-run").onclick = (e) => run("flagged", e.target);
    $("#pim-run-all").onclick = (e) => run("all", e.target);
    $("#pim-redo").onclick = async (e) => { if (await ask("Voltar a gerar com AI todos os produtos? As sugestões AI já aceites são substituídas; as tuas edições manuais mantêm-se.", { ok: "Refazer AI" })) run("all", e.target, true); };
    $("#pim-accept").onclick = (e) => guard(async () => { const r = await papi(`/jobs/${P.jobId}/bulk`, { method: "POST", body: { action: "accept" } }); toast(`${r.changed} sugestões aceites`); drawJob(box); }, e.target);
    $("#pim-export").onclick = (e) => guard(() => exportXlsx(false), e.target);
    $("#pim-export-full").onclick = (e) => guard(() => exportXlsx(true), e.target);
    if ($("#pim-export-split")) $("#pim-export-split").onclick = (e) => guard(() => exportXlsx(false, true), e.target);
    $$("[data-flag]", box).forEach((tr) => (tr.onclick = () => { P.list = { ...P.list, flag: tr.dataset.flag, filter: "", page: 1 }; drawJob(box); }));
    $$("[data-f]", box).forEach((c) => (c.onclick = () => { P.list = { ...P.list, filter: c.dataset.f, flag: "", page: 1 }; drawJob(box); }));
    let t; $("#pim-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { P.list.q = e.target.value; P.list.page = 1; drawList(); }, 250); };
    $("#pim-cat-run").onclick = (e) => guard(async () => { const r = await papi(`/jobs/${P.jobId}/run`, { method: "POST", body: { mode: "categories" } }); toast(r.queued ? `${r.queued} produtos enviados para re-categorização` : "Nenhum produto com problemas de categoria"); setTimeout(() => drawJob(box), 4000); }, e.target);
    $("#pim-cat-accept").onclick = async (e) => { if (await ask("Aceitar todas as propostas de categorias pendentes? Revê primeiro algumas no detalhe do produto.", { ok: "Aceitar categorias" })) guard(async () => { const r = await papi(`/jobs/${P.jobId}/bulk`, { method: "POST", body: { action: "accept", cols: ["categories"] } }); toast(`${r.changed} propostas de categoria aceites`); drawJob(box); }, e.target); };
    $("#pim-cat-review").onclick = () => reviewCategories();
    $("#pim-auto").onclick = (e) => guard(async () => { const r = await papi(`/jobs/${P.jobId}/auto`, { method: "POST" }); toast(`${r.fixes} deduções · ${r.labels} labels`); drawJob(box); }, e.target);
    drawImages();
    drawCatTable();
    drawList();
    clearTimeout(P.poll);
    if (j.running) P.poll = setTimeout(() => { if (S.view === "pim" && P.jobId === j.id) drawJob(box); }, 6000);
  }

  async function drawImages() {
    const box = $("#pim-img");
    if (!box) return;
    const im = await papi(`/jobs/${P.jobId}/images`);
    const s = im.summary;
    const worst = Object.entries(im.items || {}).map(([sku, v]) => ({ sku, ...v })).sort((a, b) => (a.score ?? a.quantityScore) - (b.score ?? b.quantityScore)).slice(0, 12);
    box.innerHTML = `${s ? `
      <div class="grid k" style="margin-bottom:10px">
        <div class="kpi"><div class="v">${s.avgScore ?? "—"}</div><div class="l">pontuação média /100</div></div>
        <div class="kpi"><div class="v">${s.noImage}</div><div class="l">sem imagem de produto</div></div>
        <div class="kpi"><div class="v">${s.lessThan3}</div><div class="l">com menos de 3 fotos</div></div>
        <div class="kpi"><div class="v">${s.noAmbiance}</div><div class="l">sem imagem de ambiente</div></div>
        <div class="kpi"><div class="v">${s.lowRes}</div><div class="l">resolução &lt; 800 px</div></div>
        <div class="kpi"><div class="v">${s.duplicatedCodes}</div><div class="l">códigos de asset duplicados</div></div>
      </div>
      <p class="muted small">${s.matchedInFeed}/${s.products} produtos encontrados no feed · ${s.probed} imagens medidas · avaliado ${fmtDate(im.evaluatedAt)}. Resolução, formato e peso vêm dos links públicos do feed; quantidade dos códigos do Akeneo.</p>
      <table>${worst.map((w) => `<tr class="click" data-sku="${esc(w.sku)}"><td class="mono">${esc(w.sku)}</td><td><b>${w.score ?? w.quantityScore}</b></td><td class="small">${esc(w.issues.slice(0, 2).join(" · "))}</td></tr>`).join("")}</table>`
      : `<p class="muted">Ainda não avaliado.</p>`}
      <button class="btn sm" id="pim-img-run" style="margin-top:8px">${s ? "Reavaliar imagens" : "Avaliar imagens"}</button>`;
    $$("tr[data-sku]", box).forEach((tr) => (tr.onclick = () => openSku(tr.dataset.sku)));
    $("#pim-img-run").onclick = (e) => guard(async () => { await papi(`/jobs/${P.jobId}/images`, { method: "POST" }); toast("A avaliar imagens (1–3 min)…"); setTimeout(drawImages, 45000); }, e.target);
  }

  async function reviewCategories() {
    const panel = $("#drawer-panel");
    panel.innerHTML = `<div class="empty">A carregar…</div>`;
    $("#drawer").classList.remove("hidden");
    const { items } = await papi(`/jobs/${P.jobId}/categories`);
    const filter = P.catFilter || "pending";
    const list = items.filter((i) => filter === "all" || i.status === filter);
    const chip = (k, l) => `<span class="chip ${filter === k ? "on" : ""}" data-cf="${k}">${l} · ${k === "all" ? items.length : items.filter((i) => i.status === k).length}</span>`;
    panel.innerHTML = `
      <div class="head"><div><h1>Propostas de categorias</h1><div class="muted">Verde = adicionar · vermelho riscado = remover · os códigos ERP nunca mudam.</div></div>
        <div class="row"><button class="btn" id="cr-close">Fechar</button></div></div>
      <div class="chips" style="margin-bottom:12px">${chip("pending", "Por rever")}${chip("kept", "Mantidas (com justificação)")}${chip("none", "Sem análise")}${chip("accepted", "Aceites")}${chip("rejected", "Rejeitadas")}${chip("all", "Todas")}</div>
      ${list.length ? `<div class="card" style="padding:0"><table>
        <tr><th>Produto</th><th>Categorias atuais → proposta</th><th>Motivo</th><th></th></tr>
        ${list.map((i) => `<tr data-sku="${esc(i.sku)}">
          <td style="min-width:200px"><div class="mono small muted">${esc(i.sku)} · ${esc(i.family.replace(/^FAM_/, ""))}</div><div>${esc(i.name)}</div></td>
          <td>${i.flags?.length ? `<div class="small" style="color:var(--warn,#b26b00);margin-bottom:4px">⚠ ${i.flags.map(esc).join(" · ")}</div>` : ""}${i.current.map((c) => `<span class="badge${i.remove.some((r) => r.code === c.code) ? " ex" : ""}" style="${i.remove.some((r) => r.code === c.code) ? "text-decoration:line-through" : ""}">${esc(c.label)}</span>`).join(" ") || `<span class="muted small">sem categoria</span>`}
            ${i.add.map((c) => `<span class="badge new">＋ ${esc(c.label)}</span>`).join(" ")}</td>
          <td class="small muted" style="max-width:280px">${i.status === "kept" ? "<b>AI manteve:</b> " : ""}${esc(i.reason)}${i.aiView ? `<div style="margin-top:4px"><b>Visão da AI:</b> ${esc(i.aiView)}</div>` : ""} ${i.source ? `<span class="badge">${i.source === "ai" ? "AI" : "regra"}</span>` : ""}</td>
          <td style="white-space:nowrap">${i.status === "kept" ? `<span class="badge">mantida</span>` : i.status === "none" ? `<span class="muted small">—</span>` : i.status === "pending" ? `<button class="btn sm primary" data-st="accepted">Aceitar</button> <button class="btn sm" data-st="rejected">Rejeitar</button>` : `<span class="badge ${i.status === "accepted" ? "new" : "ex"}">${i.status === "accepted" ? "aceite" : "rejeitada"}</span> <button class="btn sm ghost" data-st="pending">↺</button>`}</td>
        </tr>`).join("")}</table></div>` : `<div class="card empty">Nada nesta vista.</div>`}`;
    $("#cr-close").onclick = () => { $("#drawer").classList.add("hidden"); drawJob($("#pim-body")); };
    $$("[data-cf]", panel).forEach((c) => (c.onclick = () => { P.catFilter = c.dataset.cf; reviewCategories(); }));
    $$("tr[data-sku] [data-st]", panel).forEach((b) => (b.onclick = () => guard(async () => {
      const sku = b.closest("tr").dataset.sku;
      await papi(`/jobs/${P.jobId}/categories/${encodeURIComponent(sku)}`, { method: "POST", body: { status: b.dataset.st } });
      reviewCategories();
    })));
  }

  async function run(scope, btn, redo = false) {
    await guard(async () => {
      const r = await papi(`/jobs/${P.jobId}/run`, { method: "POST", body: { scope, redo } });
      if (!r.queued) return toast("Nada para otimizar (todos já têm sugestão)");
      toast(`${r.queued} produtos enviados para a AI`);
      setTimeout(() => drawJob($("#pim-body")), 1500);
    }, btn);
  }

  async function drawCatTable() {
    const box = $("#pim-cat-table");
    if (!box) return;
    const { items } = await papi(`/jobs/${P.jobId}/categories`);
    const changes = items.filter((i) => i.add.length || i.remove.length);
    const filter = P.catTable || "all";
    const list = changes.filter((i) => filter === "all" || i.status === filter);
    const chip = (k, l) => `<span class="chip ${filter === k ? "on" : ""}" data-ct="${k}">${l} · ${k === "all" ? changes.length : changes.filter((i) => i.status === k).length}</span>`;
    const cats = (arr, cls = "") => arr.map((c) => `<span class="badge${cls}">${esc(c.label)}</span>`).join(" ") || `<span class="muted small">sem categoria</span>`;
    box.classList.remove("muted");
    box.innerHTML = changes.length ? `
      <div class="chips" style="margin-bottom:10px">${chip("all", "Todas")}${chip("pending", "Por rever")}${chip("accepted", "Aceites")}${chip("rejected", "Rejeitadas")}</div>
      ${list.length ? `<table><tr><th>SKU</th><th>Nome</th><th>Categorias anteriores</th><th>Categorias propostas</th></tr>
      ${list.map((i) => {
        const proposed = [...i.current.filter((c) => !i.remove.some((r) => r.code === c.code)), ...i.add.filter((a) => !i.current.some((c) => c.code === a.code))];
        return `<tr class="click" data-sku="${esc(i.sku)}"><td class="mono">${esc(i.sku)}</td><td><div class="trunc">${esc(i.name)}</div></td>
          <td class="small">${cats(i.current)}</td>
          <td class="small">${proposed.map((c) => `<span class="badge${i.add.some((a) => a.code === c.code) ? " new" : ""}">${esc(c.label)}</span>`).join(" ") || `<span class="muted small">sem categoria</span>`}
            ${i.status === "accepted" ? `<span class="badge new">aceite</span>` : i.status === "rejected" ? `<span class="badge ex">rejeitada</span>` : `<span class="badge edit">por rever</span>`}</td></tr>`;
      }).join("")}</table>` : `<div class="empty">Nada nesta vista.</div>`}
      <p class="muted small">Verde = categoria nova. Clica num produto para ver o motivo e aceitar/rejeitar. As categorias aceites saem no mesmo export das restantes alterações.</p>`
      : `<p class="muted">Sem propostas de alteração de categorias.</p>`;
    $$("[data-ct]", box).forEach((c) => (c.onclick = () => { P.catTable = c.dataset.ct; drawCatTable(); }));
    $$("tr[data-sku]", box).forEach((tr) => (tr.onclick = () => openSku(tr.dataset.sku)));
  }

  async function drawList() {
    const box = $("#pim-list");
    const q = new URLSearchParams({ q: P.list.q, filter: P.list.filter, flag: P.list.flag, page: P.list.page, size: 50 });
    const r = await guard(() => papi(`/jobs/${P.jobId}/products?${q}`));
    if (!r) return;
    const all = await papi(`/jobs/${P.jobId}/products?size=1`);
    const k = $("#pim-kpis");
    if (k && P.job) {
      const idx = await papi(`/jobs/${P.jobId}/products?size=500`);
      const items = idx.items;
      const sum = (f) => items.reduce((n, i) => n + f(i), 0);
      const comp = items.filter((i) => i.completeness).map((i) => i.completeness);
      k.innerHTML = `<div class="grid k">
        <div><div class="kpi"><div class="v">${P.job.count ?? all.total}</div><div class="l">produtos${P.job.models ? ` · ${P.job.models} modelos` : ""}</div></div></div>
        ${P.job.completeness?.pt?.[0] != null ? `
        <div><div class="kpi"><div class="v">${P.job.completeness.pt[0]}% → <span style="color:var(--ok)">${P.job.completeness.pt[1]}%</span></div><div class="l">completude média PT (atual → com alterações aceites)</div></div></div>
        <div><div class="kpi"><div class="v">${P.job.completeness.es[0]}% → <span style="color:var(--ok)">${P.job.completeness.es[1]}%</span></div><div class="l">completude média ES (estimada)</div></div></div>
        <div><div class="kpi"><div class="v">${P.job.completeness.complete.pt[0]} → ${P.job.completeness.complete.pt[1]}</div><div class="l">produtos a 100% PT</div></div></div>`
        : `<div><div class="kpi"><div class="v">${comp.length ? Math.round(comp.reduce((a, b) => a + b, 0) / comp.length) + "%" : "—"}</div><div class="l">completude média (Akeneo)</div></div></div>`}
        <div><div class="kpi"><div class="v">${sum((i) => (i.suggested ? 1 : 0))}</div><div class="l">com sugestões</div></div></div>
        <div><div class="kpi"><div class="v">${sum((i) => i.pending)}</div><div class="l">campos por rever</div></div></div>
        <div><div class="kpi"><div class="v">${sum((i) => i.accepted)}</div><div class="l">campos aceites</div></div></div>
      </div>${idx.total > 500 ? `<p class="muted small">KPIs calculados sobre os primeiros 500.</p>` : ""}`;
    }
    if (!r.total) { box.innerHTML = `<div class="empty">Nenhum produto.</div>`; return; }
    const pages = Math.ceil(r.total / r.size);
    box.innerHTML = `<table><tr><th>SKU</th><th>Nome</th><th>Família</th><th>Completude PT · ES</th><th>Problemas</th><th>Sugestões</th></tr>
      ${r.items.map((i) => `<tr class="click" data-sku="${esc(i.sku)}"><td class="mono">${esc(i.sku)}${i.entity === "model" ? ` <span class="badge ai">modelo</span>` : ""}${i.parent ? `<div class="small muted">↳ ${esc(i.parent)}</div>` : ""}</td><td><div class="trunc">${esc(i.name)}</div>${i.inherited?.length ? `<div class="small muted">corrigir no modelo ${i.inherited.map(esc).join(", ")}</div>` : ""}</td><td class="small muted">${esc((i.family || "").replace(/^FAM_/, ""))}</td>
        <td class="small">${i.comp ? `${i.comp.pt[0]}${i.comp.pt[1] !== i.comp.pt[0] ? `→<b style="color:var(--ok)">${i.comp.pt[1]}</b>` : ""}% <span class="muted">· ES ${i.comp.es[0]}${i.comp.es[1] !== i.comp.es[0] ? `→<b style="color:var(--ok)">${i.comp.es[1]}</b>` : ""}%</span>` : `${i.completeness ?? "—"}%`}</td>
        <td>${i.flags.filter((f) => !f.includes(":missing_es") && !f.startsWith("_completeness")).slice(0, 3).map((f) => `<span class="badge flag">${esc(flagLabel(f))}</span>`).join("")}${i.seasonal ? `<span class="badge ai">sazonal</span>` : ""}</td>
        <td>${i.warnings ? `<span class="badge ex">⚠ ${i.warnings}</span>` : ""}${i.suggested ? `${i.pending ? `<span class="badge edit">${i.pending} por rever</span>` : ""}${i.accepted ? `<span class="badge new">${i.accepted} aceites</span>` : ""}` : `<span class="muted small">—</span>`}</td></tr>`).join("")}</table>
      <div class="pager"><span class="muted">${r.total} produtos · página ${r.page}/${pages}</span><button class="btn sm" id="pp" ${r.page <= 1 ? "disabled" : ""}>←</button><button class="btn sm" id="pn" ${r.page >= pages ? "disabled" : ""}>→</button></div>`;
    $$("tr[data-sku]", box).forEach((tr) => (tr.onclick = () => openSku(tr.dataset.sku)));
    $("#pp").onclick = () => { P.list.page--; drawList(); };
    $("#pn").onclick = () => { P.list.page++; drawList(); };
  }

  async function openSku(sku) {
    const panel = $("#drawer-panel");
    panel.innerHTML = `<div class="empty">A carregar…</div>`;
    $("#drawer").classList.remove("hidden");
    const d = await guard(() => papi(`/jobs/${P.jobId}/products/${encodeURIComponent(sku)}`));
    if (!d) return;
    const facts = Object.entries(d.facts).filter(([k]) => !["nome_atual", "nome_plp_atual", "descricao_atual", "sku"].includes(k));
    panel.innerHTML = `
      <div class="head"><div><div class="muted mono">${d.hier?.entity === "model" ? `<span class="badge ai">modelo${d.hier.virtual ? " (fora do ficheiro)" : ""}</span> ` : ""}${esc(d.sku)} · ${esc(d.family || "")}</div><h1>${esc(d.hier?.entity === "model" ? (d.facts.nome_plp_atual || d.facts.nome_atual || "") : d.facts.nome_atual || "")}</h1>
        ${d.hier?.chain?.length ? `<div class="small muted">Hierarquia: ${d.hier.chain.map((c) => `<a href="#" data-open="${esc(c.key)}" class="mono">${esc(c.key)}</a>`).join(" › ")} › <b class="mono">${esc(d.sku)}</b></div>` : ""}
        ${d.hier?.children?.length ? `<div class="small muted">${d.hier.entity === "model" ? "Variantes" : "Filhos"}: ${d.hier.children.map((c) => `<a href="#" data-open="${esc(c.key)}" class="mono">${esc(c.key)}</a>${c.name ? ` <span>${esc(c.name)}</span>` : ""}`).join(" · ")}</div>` : ""}</div>
        <div class="row"><button class="btn" id="ps-close">Fechar</button><button class="btn" id="ps-accept-all">Aceitar tudo</button><button class="btn primary" id="ps-save">Guardar</button></div></div>
      ${d.flags.length ? `<div class="callout" style="margin-bottom:12px">${d.flags.map((f) => esc(f.msg)).join(" · ")}</div>` : ""}
      ${d.images ? `<div class="card" style="margin-bottom:12px"><h2>Imagens · ${d.images.score ?? d.images.quantityScore}/100</h2>
        <div class="small muted" style="margin-bottom:6px">${d.images.product.effective} foto(s) de produto${d.images.product.duplicated ? ` (${d.images.product.raw} códigos)` : ""} · ${d.images.ambiance.effective} de ambiente${d.images.issues.length ? " · " + esc(d.images.issues.join(" · ")) : ""}</div>
        <div class="row">${d.images.feedImages.map((im) => `<div style="text-align:center"><img src="${esc(im.url)}" style="width:96px;height:96px;object-fit:cover;border-radius:6px;background:var(--soft)" loading="lazy" onerror="this.style.opacity=.2"/><div class="small muted">${im.w ? `${im.w}×${im.h}` : esc(im.error || "")}${im.kb ? ` · ${im.kb} KB` : ""}</div></div>`).join("")}</div></div>` : ""}
      ${d.categories ? `<div class="card" style="margin-bottom:12px"><h2>Categorias</h2>
        ${d.categories.flags?.length ? `<div class="small" style="color:var(--warn,#b26b00);margin-bottom:6px">${d.categories.flags.map((f) => `⚠ ${esc(f.msg)}`).join("<br>")}</div>` : ""}
        <div class="small">${d.categories.current.filter((c) => c.ecom).map((c) => `<span class="badge${d.categories.suggestion?.remove.some((x) => x.code === c.code) ? " ex" : ""}">${esc(c.label)}</span>`).join(" ") || `<span class="muted">sem categoria ecommerce</span>`}</div>
        ${d.categories.suggestion?.status === "kept" ? `<div style="margin-top:8px" class="small"><b>AI manteve as categorias:</b> <span class="muted">${esc(d.categories.suggestion.reason || "")}</span></div>` : d.categories.suggestion ? `<div style="margin-top:8px" class="small">Proposta (${esc(d.categories.suggestion.source)}): ${d.categories.suggestion.add.map((c) => `<span class="badge new">＋ ${esc(c.label)}</span>`).join(" ")} ${d.categories.suggestion.remove.map((c) => `<span class="badge ex">− ${esc(c.label)}</span>`).join(" ")}<div class="muted" style="margin-top:4px">${esc(d.categories.suggestion.reason || "")}</div>${d.categories.suggestion.aiView ? `<div class="muted" style="margin-top:4px"><b>Visão da AI:</b> ${esc(d.categories.suggestion.aiView)}</div>` : ""}</div>` : d.categories.flags?.length ? `<div class="muted small" style="margin-top:8px">Ainda sem análise da AI — corre "Propor re-categorização (AI)".</div>` : ""}
      </div>` : ""}
      <div class="card" style="margin-bottom:12px"><h2>Dados usados pela AI</h2><div class="small">${facts.map(([k, v]) => `<span class="badge">${esc(k)}: ${esc((typeof v === "object" ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join(", ") : String(v)).slice(0, 80))}</span>`).join(" ")}</div></div>
      ${d.fields.map((f) => {
        const s = f.suggestion;
        return `<div class="card" data-col="${esc(f.col)}">
          <div class="row"><b class="mono">${esc(f.col)}</b>${f.editable ? "" : f.lock ? `<span class="badge lock" title="${esc(f.lock.msg)}">🔒 ${esc(f.lock.msg)}</span>${f.lock.owner && f.lock.reason === "inherited" ? ` <a href="#" class="small" data-open="${esc(f.lock.owner)}">abrir modelo →</a>` : ""}` : `<span class="badge lock">🔒 trancado</span>`}<span class="grow"></span>
            ${s?.warning ? `<span class="badge ex" title="${esc(s.warning)}">⚠ ${esc(s.warning)}</span>` : ""}
            ${s?.reason ? `<span class="badge" title="Origem do valor">ℹ ${esc(s.reason)}</span>` : ""}
            ${s ? `<span class="badge ${s.status === "accepted" ? "new" : s.status === "rejected" ? "ex" : "edit"}">${s.status === "accepted" ? "aceite" : s.status === "rejected" ? "rejeitada" : "por rever"}</span><span class="badge ${s.source === "ai" ? "ai" : ""}">${esc(s.source)}</span>` : ""}</div>
          <div class="grid two" style="margin-top:8px">
            <div><div class="small muted">Atual</div><div class="small" style="white-space:pre-wrap">${esc(f.current) || "<i class='muted'>vazio</i>"}</div></div>
            <div><div class="small muted">Novo ${s ? `(${String(s.value).length} car.)` : ""}</div>
              ${f.editable ? `<textarea rows="${f.attr === "ATT_LONG_DESCRIPTION" ? 7 : 2}" data-val>${esc(s?.value ?? "")}</textarea>
              <div class="row" style="margin-top:6px"><label class="chk small"><input type="radio" name="st-${esc(f.col)}" value="accepted" ${s?.status === "accepted" ? "checked" : ""}/> aceitar</label>
              <label class="chk small"><input type="radio" name="st-${esc(f.col)}" value="rejected" ${s?.status === "rejected" ? "checked" : ""}/> rejeitar</label>
              <label class="chk small"><input type="radio" name="st-${esc(f.col)}" value="pending" ${!s || s.status === "pending" ? "checked" : ""}/> por rever</label></div>` : f.ownerSuggestion ? `<div class="small" style="white-space:pre-wrap">${esc(f.ownerSuggestion.value)}</div><div class="small muted">proposta no modelo ${esc(f.lock.owner)} · ${f.ownerSuggestion.status === "accepted" ? "aceite" : f.ownerSuggestion.status === "rejected" ? "rejeitada" : "por rever"}</div>` : `<span class="muted small">Não exportado</span>`}
            </div>
          </div></div>`;
      }).join("")}`;
    $("#ps-close").onclick = () => $("#drawer").classList.add("hidden");
    $$("[data-open]", panel).forEach((a) => (a.onclick = (e) => { e.preventDefault(); openSku(a.dataset.open); }));
    $("#ps-accept-all").onclick = () => { $$("input[type=radio][value=accepted]", panel).forEach((r) => { if (r.closest("[data-col]").querySelector("[data-val]").value.trim()) r.checked = true; }); };
    $("#ps-save").onclick = (e) => guard(async () => {
      const fields = {};
      $$("[data-col]", panel).forEach((c) => {
        const ta = c.querySelector("[data-val]");
        if (!ta) return;
        const status = c.querySelector("input[type=radio]:checked")?.value || "pending";
        const orig = d.fields.find((f) => f.col === c.dataset.col);
        if (!ta.value.trim() && !orig.suggestion) return;
        if (!ta.value.trim()) { fields[c.dataset.col] = null; return; }
        if (!orig.suggestion || orig.suggestion.value !== ta.value || orig.suggestion.status !== status) fields[c.dataset.col] = { value: ta.value, status };
      });
      if (!Object.keys(fields).length) return toast("Sem alterações");
      await papi(`/jobs/${P.jobId}/products/${encodeURIComponent(sku)}`, { method: "PUT", body: { fields } });
      toast("Guardado");
      $("#drawer").classList.add("hidden");
      drawList(); drawCatTable();
    }, e.target);
  }

  async function exportXlsx(full, split = false) {
    const r = await papi(`/jobs/${P.jobId}/export${full ? "?full=1" : split ? "?split=1" : ""}`);
    if (!r.changes && !full) return toast("Ainda não há alterações aceites para exportar", true);
    const XLSX = await loadXlsx();
    if (r.split) {
      for (const f of r.files) {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([f.headers, ...f.rows.map((row) => f.headers.map((h) => row[h] ?? ""))]), "Sheet1");
        XLSX.writeFile(wb, `${P.job.name}-alteracoes-${f.name}.xlsx`);
      }
      return toast(r.files.map((f) => `${f.name}: ${f.rows.length}`).join(" · ") + ` · ${r.changes} campos`);
    }
    const ws = XLSX.utils.aoa_to_sheet([r.headers, ...r.rows.map((row) => r.headers.map((h) => row[h] ?? ""))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, `${P.job.name}-${full ? "completo" : "alteracoes"}.xlsx`);
    toast(full ? `${r.rows.length} produtos · ${r.headers.length} colunas · ${r.changes} campos alterados` : `${r.rows.length} produtos · ${r.changes} campos exportados`);
  }

  // ================================================================ labels (merchandising rules)
  const OPS = { equals: "é igual a", not_equals: "é diferente de", contains: "contém", not_contains: "não contém", in: "está na lista", empty: "está vazio", not_empty: "não está vazio", gt: ">", lt: "<" };
  let ldraft = null;
  async function drawLabels(box) {
    const { config: c } = await papi("/config");
    P.cfg = c;
    if (!ldraft) ldraft = JSON.parse(JSON.stringify(c.labelRules || []));
    const jobs = await papi("/jobs");
    let headers = [];
    if (jobs[0]) { const l = await papi(`/jobs/${jobs[0].id}/products?size=1`); if (l.items[0]) headers = Object.keys((await papi(`/jobs/${jobs[0].id}/products/${encodeURIComponent(l.items[0].sku)}`)).raw); }
    const condFields = [...new Set(["family", "categories", "ATT_MARKETING_TYPE-pt_PT", "ATT_SEASONALITY-pt_PT", "ATT_BROCHURE_COLLECTION", "ATT_BRAND", "ATT_SUPPLIER_COLLECTION", "ATT_ONLINE_STATUS", "ATT_PVP-EUR", ...headers])].sort();
    const targetFields = [...new Set([...headers.filter((h) => c.labelFields.includes(h.split("-")[0]) && !h.includes("erp_channel")), ...c.labelFields.filter((a) => !headers.some((h) => h.split("-")[0] === a)), "Etiqueta_homa-es_ES-ecommerce"])].sort();
    const opt = (list, sel) => list.map((f) => `<option ${f === sel ? "selected" : ""}>${esc(f)}</option>`).join("");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
    const status = (r) => { if (r.enabled === false) return ["", "desligada"]; const s = r.schedule || {}; if (s.mode && s.mode !== "always") { if (s.start && today < s.start) return ["ai", "agendada"]; if (s.mode === "range" && s.end && today > s.end) return ["ex", "expirada"]; } return ["new", "ativa"]; };
    box.innerHTML = `
      <div class="head" style="margin-bottom:12px"><div class="muted">Regras para os campos de merchandising do Akeneo (${c.labelFields.map((x) => `<code>${esc(x)}</code>`).join(" ")}). Funcionam como os labels do feed: SE condição → ENTÃO valor, com agendamento entre datas ou até removeres. Aplicadas a todos os ficheiros e incluídas no export.</div>
        <div class="row"><button class="btn" id="lb-add">＋ Regra</button><button class="btn primary" id="lb-save">Guardar e aplicar</button></div></div>
      <div class="callout info" style="margin-bottom:12px">Ex.: "categories contém Christmas → ATT_THEME = Natal" · "ATT_MARKETING_TYPE = PROMOCIONAL, entre 20/11 e 30/11 → Etiqueta_homa = 1" · "ATT_BROCHURE_COLLECTION = T6/26 → ATT_NEW = 1, ATT_START_DATE_NEW = 2026-11-01". Valores booleanos: 1 / 0; datas: AAAA-MM-DD.</div>
      ${ldraft.length ? ldraft.map((r, i) => { const [cls, txt] = status(r); return `
        <div class="rule ${txt !== "ativa" ? "off" : ""}" data-i="${i}">
          <div class="rule-head"><label class="chk"><input type="checkbox" data-k="enabled" ${r.enabled !== false ? "checked" : ""}/></label><input class="name" data-k="name" value="${esc(r.name)}"/><span class="badge ${cls}">${txt}</span><button class="btn sm ghost danger" data-del="${i}">✕</button></div>
          <div class="rule-body">
            <div class="line"><span class="kw">Quando</span><select data-s="mode">${[["always", "Sempre (até eu remover)"], ["from", "A partir de… (até eu remover)"], ["range", "Entre datas"]].map(([k, l]) => `<option value="${k}" ${(r.schedule?.mode || "always") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
              ${r.schedule?.mode && r.schedule.mode !== "always" ? `<input type="date" data-s="start" value="${esc(r.schedule.start || today)}"/>` : ""}${r.schedule?.mode === "range" ? `<span class="muted">até</span><input type="date" data-s="end" value="${esc(r.schedule.end || "")}"/>` : ""}</div>
            <div class="line"><span class="kw">Se</span>${r.conditions.length ? `<select data-k="match"><option value="all" ${r.match !== "any" ? "selected" : ""}>todas</option><option value="any" ${r.match === "any" ? "selected" : ""}>qualquer</option></select>` : `<span class="muted">todos os produtos</span>`}<button class="btn sm" data-addc="${i}">＋ condição</button></div>
            ${r.conditions.map((cd, ci) => `<div class="line" data-ci="${ci}"><span class="kw"></span><select data-c="field">${opt(condFields, cd.field)}</select><select data-c="op">${Object.entries(OPS).map(([k, l]) => `<option value="${k}" ${k === cd.op ? "selected" : ""}>${l}</option>`).join("")}</select>${["empty", "not_empty"].includes(cd.op) ? "" : `<input class="val" data-c="value" value="${esc(cd.value || "")}"/>`}<button class="btn sm ghost" data-delc="${ci}">✕</button></div>`).join("")}
            <div class="line"><span class="kw">Então</span><button class="btn sm" data-adda="${i}">＋ valor</button></div>
            ${r.actions.map((a, ai) => `<div class="line" data-ai="${ai}"><span class="kw"></span><select data-a="field">${opt(targetFields, a.field)}</select><span class="muted">=</span><input class="val" data-a="value" value="${esc(a.value || "")}" placeholder="valor (1/0, texto, AAAA-MM-DD)"/><button class="btn sm ghost" data-dela="${ai}">✕</button></div>`).join("")}
          </div></div>`; }).join("") : `<div class="card empty">Sem regras de labels.</div>`}`;
    const redraw = () => drawLabels(box);
    $("#lb-add").onclick = () => { ldraft.push({ id: Math.random().toString(36).slice(2, 9), name: "Nova regra", enabled: true, match: "all", schedule: { mode: "always" }, conditions: [{ field: "categories", op: "contains", value: "Christmas" }], actions: [{ type: "set", field: targetFields[0] || "ATT_THEME", value: "" }] }); redraw(); };
    $$(".rule", box).forEach((el) => {
      const r = ldraft[Number(el.dataset.i)];
      el.oninput = el.onchange = (e) => {
        const t = e.target;
        if (t.dataset.k) r[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value;
        if (t.dataset.s) { r.schedule = { mode: "always", ...(r.schedule || {}), [t.dataset.s]: t.value }; if (r.schedule.mode !== "always" && !r.schedule.start) r.schedule.start = today; }
        const ci = t.closest("[data-ci]")?.dataset.ci, ai = t.closest("[data-ai]")?.dataset.ai;
        if (t.dataset.c && ci != null) r.conditions[ci][t.dataset.c] = t.value;
        if (t.dataset.a && ai != null) { r.actions[ai][t.dataset.a] = t.value; r.actions[ai].type = "set"; }
        if (e.type === "change" && (t.dataset.s === "mode" || t.dataset.c === "op" || t.dataset.k === "enabled")) redraw();
      };
      el.onclick = async (e) => {
        const d = e.target.dataset;
        if (d.del != null && (await ask(`Apagar a regra "${r.name}"?`, { ok: "Apagar", danger: true }))) { ldraft.splice(Number(d.del), 1); return redraw(); }
        if (d.addc != null) { r.conditions.push({ field: "categories", op: "contains", value: "" }); redraw(); }
        if (d.delc != null) { r.conditions.splice(Number(d.delc), 1); redraw(); }
        if (d.adda != null) { r.actions.push({ type: "set", field: targetFields[0], value: "" }); redraw(); }
        if (d.dela != null) { r.actions.splice(Number(d.dela), 1); redraw(); }
      };
    });
    $("#lb-save").onclick = (e) => guard(async () => {
      await papi("/config", { method: "PUT", body: { labelRules: ldraft } });
      let n = 0;
      for (const j of jobs) { const r = await papi(`/jobs/${j.id}/auto`, { method: "POST" }); n += r.labels; }
      toast(`Regras guardadas · ${n} labels aplicados`);
      ldraft = null; redraw();
    }, e.target);
  }

  // ================================================================ config
  async function drawConfig(box) {
    const { config: c } = await papi("/config");
    P.cfg = c;
    const jobs = await papi("/jobs");
    let attrs = new Set(["ATT_NAME", "ATT_PLP_NAME", "ATT_LONG_DESCRIPTION", "ATT_SHORT_DESCRIPTION", "ATT_PLP_DESCRIPTION"]);
    if (jobs[0]) {
      const d = await papi(`/jobs/${jobs[0].id}/products?size=1`);
      if (d.items[0]) {
        const p = await papi(`/jobs/${jobs[0].id}/products/${encodeURIComponent(d.items[0].sku)}`);
        for (const k of Object.keys(p.raw)) if (/-(pt_PT|es_ES)/.test(k) && !/completeness/.test(k)) attrs.add(k.split("-")[0]);
      }
    }
    attrs = [...attrs].sort();
    box.innerHTML = `
      <div class="head" style="margin-bottom:12px"><div class="muted">Só os atributos marcados como <b>editáveis</b> podem ser alterados e exportados; tudo o resto (preços, EAN, códigos ERP, fornecedor, logística…) fica trancado.</div><button class="btn primary" id="pc-save">Guardar</button></div>
      <div class="grid two">
        <div class="card" style="padding:0"><table><tr><th>Atributo (texto, por língua)</th><th>Editável</th><th>AI gera</th></tr>
          ${attrs.map((a) => `<tr><td class="mono">${esc(a)}</td><td><input type="checkbox" data-ed="${esc(a)}" ${c.editable.includes(a) ? "checked" : ""}/></td><td><input type="checkbox" data-ai="${esc(a)}" ${c.aiFields.includes(a) ? "checked" : ""}/></td></tr>`).join("")}
        </table><p class="muted small" style="padding:0 12px">A descrição curta (ATT_SHORT_DESCRIPTION) fica trancada por defeito, como pediste.</p></div>
        <div class="card form">
          <label class="f">Canal <input id="pc-channel" value="${esc(c.channel)}" /></label>
          <label class="f">Línguas a gerar <input id="pc-locales" value="${esc(c.targetLocales.join(", "))}" /></label>
          <div class="form cols">
            <label class="f">Nome — máx. <input type="number" id="pc-lname" value="${c.limits.ATT_NAME}" /></label>
            <label class="f">Nome PLP — máx. <input type="number" id="pc-lplp" value="${c.limits.ATT_PLP_NAME}" /></label>
            <label class="f">Descrição longa — mín. <input type="number" id="pc-lmin" value="${c.limits.longMin}" /></label>
            <label class="f">Descrição longa — máx. <input type="number" id="pc-lmax" value="${c.limits.longMax}" /></label>
          </div>
          <label class="f">Sazonalidade que mantém o texto de campanha <input id="pc-seasonal" value="${esc(c.seasonalValues.join(", "))}" /></label>
          <label class="f">… ou categorias que contenham (regex) <input id="pc-seasonal-cat" value="${esc(c.seasonalCategoryPattern)}" /></label>
          <label class="f">Modelo <input id="pc-model" value="${esc(c.model)}" /></label>
          <label class="f">Tom de voz <textarea id="pc-voice" rows="3">${esc(c.brandVoice)}</textarea></label>
        </div>
      </div>
      <div class="card form"><h2>Instruções por campo</h2>
        ${c.aiFields.map((f) => `<label class="f">${esc(f)}<textarea data-instr="${esc(f)}" rows="3">${esc(c.instructions[f] || "")}</textarea></label>`).join("")}
      </div>`;
    $("#pc-save").onclick = (e) => guard(async () => {
      const instructions = {};
      $$("[data-instr]", box).forEach((t) => (instructions[t.dataset.instr] = t.value));
      P.cfg = await papi("/config", { method: "PUT", body: {
        editable: $$("[data-ed]", box).filter((x) => x.checked).map((x) => x.dataset.ed),
        aiFields: $$("[data-ai]", box).filter((x) => x.checked).map((x) => x.dataset.ai),
        channel: $("#pc-channel").value.trim(), targetLocales: $("#pc-locales").value.split(",").map((s) => s.trim()).filter(Boolean),
        limits: { ATT_NAME: +$("#pc-lname").value, ATT_PLP_NAME: +$("#pc-lplp").value, longMin: +$("#pc-lmin").value, longMax: +$("#pc-lmax").value },
        seasonalValues: $("#pc-seasonal").value.split(",").map((s) => s.trim()).filter(Boolean), seasonalCategoryPattern: $("#pc-seasonal-cat").value,
        model: $("#pc-model").value.trim(), brandVoice: $("#pc-voice").value, instructions,
      } });
      toast("Configuração PIM guardada");
      drawConfig(box);
    }, e.target);
  }

  // ================================================================ dictionary
  async function drawDict(box) {
    const { dictionary: d } = await papi("/config");
    box.innerHTML = `<div class="card">
      <h2>Dicionário Akeneo</h2>
      ${d ? `<p>${d.bundled ? "📦 " : ""}<b>${d.families}</b> famílias com requisitos · <b>${d.attributesWithOptions}</b> atributos com opções · importado ${fmtDate(d.importedAt)} (${esc(d.source || "")})</p>`
        : `<p class="muted">Ainda não importado. Sem dicionário, cores/materiais em código (ex.: <code>260</code>) não são usados pela AI e a completude não é explicada atributo a atributo.</p>`}
      <p class="muted small">Incluído na app: snapshot do Akeneo (requisitos de completude do canal ecommerce por família, opções de cor/material/marca/estilo/secções/sazonalidade/aroma e nomes dos atributos). Para atualizar, substitui <code>netlify/lib/akeneo-dictionary.mjs</code>.</p>
    </div>`;
  }
})();
