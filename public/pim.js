/* FeedForge — PIM optimizer view (Akeneo XLSX exports). */
(() => {
  "use strict";
  const { S, $, $$, esc, toast, modal, closeModal, guard, fmtDate, VIEWS } = window.FF;
  const P = { tab: "files", jobId: null, job: null, cfg: null, list: { q: "", filter: "", flag: "", page: 1 }, poll: null };

  const FLAG_LABEL = {
    "ATT_NAME:empty": "Nome vazio", "ATT_NAME:short": "Nome curto", "ATT_NAME:long": "Nome longo", "ATT_NAME:caps": "Nome em maiúsculas", "ATT_NAME:mixed_case": "Maiúsculas inconsistentes no nome",
    "ATT_PLP_NAME:empty": "Nome PLP vazio", "ATT_PLP_NAME:caps": "Nome PLP em maiúsculas",
    "ATT_LONG_DESCRIPTION:empty": "Descrição longa vazia", "ATT_LONG_DESCRIPTION:short": "Descrição longa curta p/ SEO", "ATT_LONG_DESCRIPTION:boilerplate": "Texto genérico / campanha", "ATT_LONG_DESCRIPTION:title_case": "Descrição Em Maiúsculas Por Palavra", "ATT_LONG_DESCRIPTION:html": "HTML na descrição",
    "_completeness:incomplete": "Completude < 100%", "_required:missing_content": "Obrigatórios de conteúdo em falta", "_required:missing_data": "Obrigatórios de dados em falta (compras/logística)", "ATT_PLP_DESCRIPTION:dims_mismatch": "Descrição PLP ≠ dimensões", "_dimensions:suspicious": "Dimensões suspeitas",
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
        ${[["files", "Ficheiros"], ["config", "Campos & AI"], ["dict", "Dicionário Akeneo"]].map(([k, l]) => `<span class="chip ${P.tab === k ? "on" : ""}" data-tab="${k}">${l}</span>`).join("")}
      </div>
      <div id="pim-body"></div>`;
    $$("[data-tab]", main).forEach((c) => (c.onclick = () => { P.tab = c.dataset.tab; P.jobId = null; VIEWS.pim(main); }));
    const body = $("#pim-body");
    if (P.tab === "config") return drawConfig(body);
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
    $$("[data-del]", box).forEach((b) => (b.onclick = () => guard(async () => { if (!confirm("Apagar este ficheiro e as sugestões?")) return; await papi(`/jobs/${b.dataset.del}`, { method: "DELETE" }); drawFiles(box); })));
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
          <button class="btn primary" id="pim-export">⬇ Exportar XLSX</button>
        </div>
      </div>
      ${j.running || (pr && pr.remaining) ? `<div class="callout ${j.running ? "info" : ""}" style="margin-bottom:12px">${j.running ? "⏳ AI a trabalhar" : "Pausado"}: ${pr?.done ?? 0}/${pr?.total ?? 0} produtos${pr?.errors ? ` · ${pr.errors} erros` : ""}${pr?.fatal ? ` · <b class="err">${esc(pr.fatal)}</b>` : ""}${!j.running && pr?.remaining ? ` · ${pr.remaining} por fazer — carrega em "Otimizar sinalizados" para continuar` : ""}</div>` : ""}
      <div class="grid two">
        <div class="card"><h2>Diagnóstico</h2>
          ${fc.length ? `<table>${fc.map(([f, n]) => `<tr class="click" data-flag="${esc(f)}"><td>${esc(flagLabel(f))}</td><td style="text-align:right"><b>${n}</b></td></tr>`).join("")}</table>` : `<p class="muted">Sem problemas detetados.</p>`}
        </div>
        <div class="card"><h2>Estado</h2><div id="pim-kpis" class="muted">…</div></div>
      </div>
      <div class="card">
        <div class="row" style="margin-bottom:10px">
          <input id="pim-q" placeholder="Pesquisar sku ou nome…" value="${esc(P.list.q)}" style="min-width:240px" />
          <div class="chips">${[["", "Todos"], ["warnings", "⚠ A verificar"], ["errors", "Com erros"], ["todo", "Sem sugestão"], ["pending", "Por rever"], ["accepted", "Aceites"], ["seasonal", "Sazonais"]].map(([k, l]) => `<span class="chip ${P.list.filter === k && !P.list.flag ? "on" : ""}" data-f="${k}">${l}</span>`).join("")}
          ${P.list.flag ? `<span class="chip on" data-f="">${esc(flagLabel(P.list.flag))} ✕</span>` : ""}</div>
        </div>
        <div id="pim-list"></div>
      </div>`;
    $("#pim-back").onclick = (e) => { e.preventDefault(); P.jobId = null; drawFiles(box); };
    $("#pim-run").onclick = (e) => run("flagged", e.target);
    $("#pim-run-all").onclick = (e) => run("all", e.target);
    $("#pim-redo").onclick = (e) => { if (confirm("Voltar a gerar com AI todos os produtos? Sugestões AI já aceites são substituídas (edições manuais mantêm-se).")) run("all", e.target, true); };
    $("#pim-accept").onclick = (e) => guard(async () => { const r = await papi(`/jobs/${P.jobId}/bulk`, { method: "POST", body: { action: "accept" } }); toast(`${r.changed} sugestões aceites`); drawJob(box); }, e.target);
    $("#pim-export").onclick = (e) => guard(() => exportXlsx(), e.target);
    $$("[data-flag]", box).forEach((tr) => (tr.onclick = () => { P.list = { ...P.list, flag: tr.dataset.flag, filter: "", page: 1 }; drawJob(box); }));
    $$("[data-f]", box).forEach((c) => (c.onclick = () => { P.list = { ...P.list, filter: c.dataset.f, flag: "", page: 1 }; drawJob(box); }));
    let t; $("#pim-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { P.list.q = e.target.value; P.list.page = 1; drawList(); }, 250); };
    drawList();
    clearTimeout(P.poll);
    if (j.running) P.poll = setTimeout(() => { if (S.view === "pim" && P.jobId === j.id) drawJob(box); }, 6000);
  }

  async function run(scope, btn, redo = false) {
    await guard(async () => {
      const r = await papi(`/jobs/${P.jobId}/run`, { method: "POST", body: { scope, redo } });
      if (!r.queued) return toast("Nada para otimizar (todos já têm sugestão)");
      toast(`${r.queued} produtos enviados para a AI`);
      setTimeout(() => drawJob($("#pim-body")), 1500);
    }, btn);
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
        <div><div class="kpi"><div class="v">${all.total}</div><div class="l">produtos</div></div></div>
        <div><div class="kpi"><div class="v">${comp.length ? Math.round(comp.reduce((a, b) => a + b, 0) / comp.length) + "%" : "—"}</div><div class="l">completude média (Akeneo)</div></div></div>
        <div><div class="kpi"><div class="v">${sum((i) => (i.suggested ? 1 : 0))}</div><div class="l">com sugestões</div></div></div>
        <div><div class="kpi"><div class="v">${sum((i) => i.pending)}</div><div class="l">campos por rever</div></div></div>
        <div><div class="kpi"><div class="v">${sum((i) => i.accepted)}</div><div class="l">campos aceites</div></div></div>
      </div>${idx.total > 500 ? `<p class="muted small">KPIs calculados sobre os primeiros 500.</p>` : ""}`;
    }
    if (!r.total) { box.innerHTML = `<div class="empty">Nenhum produto.</div>`; return; }
    const pages = Math.ceil(r.total / r.size);
    box.innerHTML = `<table><tr><th>SKU</th><th>Nome</th><th>Família</th><th>Compl.</th><th>Problemas</th><th>Sugestões</th></tr>
      ${r.items.map((i) => `<tr class="click" data-sku="${esc(i.sku)}"><td class="mono">${esc(i.sku)}</td><td><div class="trunc">${esc(i.name)}</div></td><td class="small muted">${esc(i.family.replace(/^FAM_/, ""))}</td>
        <td class="small">${i.completeness ?? "—"}%</td>
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
      <div class="head"><div><div class="muted mono">${esc(d.sku)} · ${esc(d.family)}</div><h1>${esc(d.facts.nome_atual || "")}</h1></div>
        <div class="row"><button class="btn" id="ps-close">Fechar</button><button class="btn" id="ps-accept-all">Aceitar tudo</button><button class="btn primary" id="ps-save">Guardar</button></div></div>
      ${d.flags.length ? `<div class="callout" style="margin-bottom:12px">${d.flags.map((f) => esc(f.msg)).join(" · ")}</div>` : ""}
      <div class="card" style="margin-bottom:12px"><h2>Dados usados pela AI</h2><div class="small">${facts.map(([k, v]) => `<span class="badge">${esc(k)}: ${esc(String(v).slice(0, 80))}</span>`).join(" ")}</div></div>
      ${d.fields.map((f) => {
        const s = f.suggestion;
        return `<div class="card" data-col="${esc(f.col)}">
          <div class="row"><b class="mono">${esc(f.col)}</b>${f.editable ? "" : `<span class="badge lock">🔒 trancado</span>`}<span class="grow"></span>
            ${s?.warning ? `<span class="badge ex" title="${esc(s.warning)}">⚠ ${esc(s.warning)}</span>` : ""}
            ${s ? `<span class="badge ${s.status === "accepted" ? "new" : s.status === "rejected" ? "ex" : "edit"}">${s.status === "accepted" ? "aceite" : s.status === "rejected" ? "rejeitada" : "por rever"}</span><span class="badge ${s.source === "ai" ? "ai" : ""}">${esc(s.source)}</span>` : ""}</div>
          <div class="grid two" style="margin-top:8px">
            <div><div class="small muted">Atual</div><div class="small" style="white-space:pre-wrap">${esc(f.current) || "<i class='muted'>vazio</i>"}</div></div>
            <div><div class="small muted">Novo ${s ? `(${String(s.value).length} car.)` : ""}</div>
              ${f.editable ? `<textarea rows="${f.attr === "ATT_LONG_DESCRIPTION" ? 7 : 2}" data-val>${esc(s?.value ?? "")}</textarea>
              <div class="row" style="margin-top:6px"><label class="chk small"><input type="radio" name="st-${esc(f.col)}" value="accepted" ${s?.status === "accepted" ? "checked" : ""}/> aceitar</label>
              <label class="chk small"><input type="radio" name="st-${esc(f.col)}" value="rejected" ${s?.status === "rejected" ? "checked" : ""}/> rejeitar</label>
              <label class="chk small"><input type="radio" name="st-${esc(f.col)}" value="pending" ${!s || s.status === "pending" ? "checked" : ""}/> por rever</label></div>` : `<span class="muted small">Não exportado</span>`}
            </div>
          </div></div>`;
      }).join("")}`;
    $("#ps-close").onclick = () => $("#drawer").classList.add("hidden");
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
      drawList();
    }, e.target);
  }

  async function exportXlsx() {
    const r = await papi(`/jobs/${P.jobId}/export`);
    if (!r.rows.length) return toast("Ainda não há alterações aceites para exportar", true);
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.aoa_to_sheet([r.headers, ...r.rows.map((row) => r.headers.map((h) => row[h] ?? ""))]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, `${P.job.name}-otimizado.xlsx`);
    toast(`${r.rows.length} produtos · ${r.changes} campos exportados`);
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
