/* FeedForge UI — config views (rules, labels, fields, AI, GMC, settings, history). */
(() => {
  "use strict";
  const { S, $, $$, esc, uid, clone, api, F, guard, toast, modal, closeModal, ask, render, saveConfig, headers, fieldOptions, fmtDate, VIEWS, VIRTUALS, OP_LABEL, ACT_LABEL, TF_LABEL } = window.FF;
  const NO_VALUE_OPS = ["empty", "not_empty"];
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
  function ruleStatus(r) {
    if (r.enabled === false) return "off";
    const s = r.schedule || { mode: "always" };
    if (!s.mode || s.mode === "always") return "active";
    if (s.start && today() < s.start) return "scheduled";
    if (s.mode === "range" && s.end && today() > s.end) return "expired";
    return "active";
  }
  const STATUS = { active: ["new", "ativa"], scheduled: ["ai", "agendada"], expired: ["ex", "expirada"], off: ["", "desligada"] };
  const statusBadge = (r) => { const [cls, txt] = STATUS[ruleStatus(r)]; return `<span class="badge ${cls}">${txt}</span>`; };
  function scheduleText(r) {
    const s = r.schedule || {};
    if (s.mode === "from") return `a partir de ${s.start || "?"} · até eu remover`;
    if (s.mode === "range") return `${s.start || "?"} → ${s.end || "?"}`;
    return "sempre · até eu remover";
  }
  function scheduleFields(s = {}, attr = "data-s") {
    const mode = s.mode || "always";
    return `<select ${attr}="mode">${[["always", "Sempre (até eu remover)"], ["from", "A partir de… (até eu remover)"], ["range", "Entre datas"]].map(([k, l]) => `<option value="${k}" ${k === mode ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${mode !== "always" ? `<input type="date" ${attr}="start" value="${esc(s.start || today())}" />` : ""}
      ${mode === "range" ? `<span class="muted">até</span><input type="date" ${attr}="end" value="${esc(s.end || "")}" />` : ""}`;
  }

  // ================================================================== RULES
  let draft = null; // working copy of rules
  VIEWS.rules = (main) => {
    if (!draft || draft._feed !== S.feedId) { draft = clone(S.cfg.rules || []); draft._feed = S.feedId; }
    main.innerHTML = `
      <div class="head">
        <div><h1>Regras</h1><div class="muted">Calculadas <b>uma vez por produto</b> e guardadas em cache — só voltam a correr para produtos novos, produtos cujo conteúdo mudou, ou quando uma regra é editada / entra ou sai do agendamento. Ordem: origem → AI → <b>regras</b> → edições manuais → campos trancados (sempre da origem).</div></div>
        <div class="row"><button class="btn" id="r-add">＋ Nova regra</button><button class="btn" id="r-preview">Pré-visualizar</button><button class="btn primary" id="r-save">Guardar regras</button></div>
      </div>
      <div class="callout info" style="margin-bottom:14px">A pré-visualização ignora agendamentos (mostra o efeito de todas as regras ligadas). Templates: usa <code>{{campo}}</code> nos valores (ex.: <code>{{brand}} {{title}}</code>, <code>{{color|title}}</code>). Campos virtuais para condições: ${VIRTUALS.map((v) => `<code>${v}</code>`).join(" ")}.</div>
      <div id="r-list"></div>
      <div id="r-prev"></div>`;
    drawRules();
    $("#r-add").onclick = () => { draft.push(newRule()); drawRules(); };
    $("#r-save").onclick = (e) => guard(async () => { await saveConfig({ rules: stripDraft() }, "Regras guardadas"); }, e.target);
    $("#r-preview").onclick = (e) => guard(() => previewRules(), e.target);
  };
  const stripDraft = () => draft.filter(Boolean).map((r) => ({ ...r }));
  function newRule(partial = {}) {
    return { id: uid(), name: "Nova regra", enabled: true, match: "all", conditions: [], actions: [{ type: "set", field: "title", value: "" }], ...partial };
  }

  function drawRules() {
    const box = $("#r-list");
    if (!draft.length) { box.innerHTML = `<div class="card empty">Sem regras. Cria a primeira — ex.: “se brand = hôma → custom_label_1 = marca própria”.</div>`; return; }
    box.innerHTML = draft.map((r, i) => `
      <div class="rule ${ruleStatus(r) !== "active" ? "off" : ""}" data-i="${i}">
        <div class="rule-head">
          <label class="chk" title="Ativa/desativa"><input type="checkbox" data-k="enabled" ${r.enabled !== false ? "checked" : ""} /></label>
          <span class="muted mono">#${i + 1}</span>
          <input class="name" data-k="name" value="${esc(r.name)}" />
          ${statusBadge(r)}
          <button class="btn sm ghost" data-act="up" title="Subir">↑</button>
          <button class="btn sm ghost" data-act="down" title="Descer">↓</button>
          <button class="btn sm ghost" data-act="dup" title="Duplicar">⧉</button>
          <button class="btn sm ghost danger" data-act="del" title="Apagar">✕</button>
        </div>
        <div class="rule-body">
          <div class="line"><span class="kw">Quando</span>${scheduleFields(r.schedule)}</div>
          <div class="line"><span class="kw">Se</span>
            ${r.conditions.length ? `<select data-k="match"><option value="all" ${r.match !== "any" ? "selected" : ""}>todas as condições</option><option value="any" ${r.match === "any" ? "selected" : ""}>qualquer condição</option></select>` : `<span class="muted">sempre (todos os produtos)</span>`}
            <button class="btn sm" data-act="add-cond">＋ condição</button></div>
          ${r.conditions.map((c, ci) => `
            <div class="line" data-ci="${ci}"><span class="kw"></span>
              <select data-c="field">${fieldOptions(c.field, true)}</select>
              <select data-c="op">${Object.entries(OP_LABEL).map(([k, l]) => `<option value="${k}" ${k === c.op ? "selected" : ""}>${l}</option>`).join("")}</select>
              ${NO_VALUE_OPS.includes(c.op) ? "" : `<input class="val" data-c="value" value="${esc(c.value ?? "")}" placeholder="${c.op === "in" || c.op === "not_in" ? "valor1, valor2" : "valor"}" />`}
              <button class="btn sm ghost" data-act="del-cond" data-ci="${ci}">✕</button>
            </div>`).join("")}
          <div class="line"><span class="kw">Então</span><button class="btn sm" data-act="add-act">＋ ação</button></div>
          ${r.actions.map((a, ai) => actionRow(a, ai)).join("")}
        </div>
      </div>`).join("");

    $$(".rule", box).forEach((el) => {
      const i = Number(el.dataset.i);
      const r = draft[i];
      el.oninput = el.onchange = (e) => {
        const t = e.target;
        if (t.dataset.k) { r[t.dataset.k] = t.type === "checkbox" ? t.checked : t.value; if (t.dataset.k === "enabled" && e.type === "change") return drawRules(); }
        if (t.dataset.s) {
          r.schedule = { mode: "always", ...(r.schedule || {}), [t.dataset.s]: t.value };
          if (r.schedule.mode !== "always" && !r.schedule.start) r.schedule.start = today();
          if (e.type === "change") drawRules();
          return;
        }
        const ci = t.closest("[data-ci]")?.dataset.ci;
        if (t.dataset.c && ci != null) { r.conditions[ci][t.dataset.c] = t.value; if (t.dataset.c === "op" && e.type === "change") drawRules(); }
        const ai = t.closest("[data-ai]")?.dataset.ai;
        if (t.dataset.a && ai != null) {
          const a = r.actions[ai];
          if (t.dataset.a === "regex") a.regex = t.checked;
          else if (t.dataset.a === "map") a.map = parseMap(t.value);
          else a[t.dataset.a] = t.value;
          if (t.dataset.a === "type" && e.type === "change") drawRules();
        }
      };
      el.onclick = async (e) => {
        const act = e.target.dataset.act;
        if (!act) return;
        if (act === "up" && i > 0) [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]];
        if (act === "down" && i < draft.length - 1) [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]];
        if (act === "dup") draft.splice(i + 1, 0, { ...clone(r), id: uid(), name: r.name + " (cópia)" });
        if (act === "del" && (await ask(`Apagar a regra “${r.name}”?`, { ok: "Apagar", danger: true }))) draft.splice(i, 1);
        if (act === "add-cond") r.conditions.push({ field: "brand", op: "equals", value: "" });
        if (act === "del-cond") r.conditions.splice(Number(e.target.dataset.ci), 1);
        if (act === "add-act") r.actions.push({ type: "set", field: "custom_label_0", value: "" });
        if (act === "del-act") r.actions.splice(Number(e.target.dataset.ai), 1);
        drawRules();
      };
    });
  }

  function parseMap(text) {
    const m = {};
    for (const line of String(text).split("\n")) {
      const idx = line.indexOf("=>");
      if (idx > 0) m[line.slice(0, idx).trim()] = line.slice(idx + 2).trim();
    }
    return m;
  }
  const mapText = (m) => Object.entries(m || {}).map(([k, v]) => `${k} => ${v}`).join("\n");

  function actionRow(a, ai) {
    const field = a.type === "exclude" ? "" : `<select data-a="field">${fieldOptions(a.field, false, ["custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"])}</select>`;
    let extra = "";
    switch (a.type) {
      case "set": case "append": case "prepend":
        extra = `<input class="val" data-a="value" value="${esc(a.value ?? "")}" placeholder="texto ou {{campo}}" />`; break;
      case "copy": extra = `<span class="muted">de</span><select data-a="source">${fieldOptions(a.source, true)}</select>`; break;
      case "replace":
        extra = `<input data-a="find" value="${esc(a.find ?? "")}" placeholder="procurar" /><span class="muted">→</span><input data-a="replace" value="${esc(a.replace ?? "")}" placeholder="substituir por" /><label class="chk small"><input type="checkbox" data-a="regex" ${a.regex ? "checked" : ""}/> regex</label>`; break;
      case "remove": extra = `<input class="val" data-a="find" value="${esc(a.find ?? "")}" placeholder="texto a remover" />`; break;
      case "case": extra = `<select data-a="mode">${[["sentence", "Primeira maiúscula"], ["title", "Cada Palavra"], ["lower", "minúsculas"], ["upper", "MAIÚSCULAS"]].map(([k, l]) => `<option value="${k}" ${a.mode === k ? "selected" : ""}>${l}</option>`).join("")}</select>`; break;
      case "truncate": extra = `<input type="number" data-a="length" value="${esc(a.length ?? 150)}" style="width:90px" /><span class="muted">caracteres (corta na palavra)</span>`; break;
      case "map_values": extra = `<textarea data-a="map" rows="3" placeholder="valor origem => valor final (uma por linha)" style="flex:1;min-width:220px">${esc(mapText(a.map))}</textarea><input data-a="value" value="${esc(a.value ?? "")}" placeholder="fallback (opcional)" />`; break;
      case "price_bucket": extra = `<span class="muted">a partir de</span><select data-a="source">${["_effective_price", "_price", "_sale_price", "_discount_pct"].map((s) => `<option ${a.source === s ? "selected" : ""}>${s}</option>`).join("")}</select><input class="val" data-a="buckets" value="${esc(a.buckets ?? "0-25,25-50,50-100,100-250,250+")}" />`; break;
      case "exclude": extra = `<select data-a="channel">${[["all", "de ambos os feeds"], ["meta", "só do Meta"], ["gmc", "só do GMC"]].map(([k, l]) => `<option value="${k}" ${a.channel === k ? "selected" : ""}>${l}</option>`).join("")}</select>`; break;
      default: break;
    }
    return `<div class="line" data-ai="${ai}"><span class="kw"></span>
      <select data-a="type">${Object.entries(ACT_LABEL).map(([k, l]) => `<option value="${k}" ${k === a.type ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${field}${extra}
      <button class="btn sm ghost" data-act="del-act" data-ai="${ai}">✕</button></div>`;
  }

  async function previewRules() {
    const r = await api(F("/rules/preview"), { method: "POST", body: { rules: stripDraft() } });
    $("#r-prev").innerHTML = `
      <div class="card" style="margin-top:14px">
        <h2>Pré-visualização (sem guardar)</h2>
        <p><b>${r.matched}</b> de ${r.total} produtos são afetados por pelo menos uma regra · <b>${r.excluded}</b> excluídos.</p>
        ${r.samples.length ? `<table><tr><th>ID</th><th>Alterações</th></tr>${r.samples.map((s) => `<tr><td class="mono">${esc(s.id)}</td><td>
          ${s.changes.map((c) => `<div><span class="mono muted">${esc(c.field)}</span>: <span class="diff-old">${esc(String(c.before).slice(0, 120)) || "∅"}</span> → <span class="diff-new">${esc(String(c.after).slice(0, 120)) || "∅"}</span></div>`).join("")}
          ${s.excluded.meta || s.excluded.gmc ? `<span class="badge ex">excluído ${s.excluded.meta && s.excluded.gmc ? "de ambos" : s.excluded.meta ? "Meta" : "GMC"}</span>` : ""}
          ${s.blocked.length ? `<div class="muted small">Ignorado (trancado): ${s.blocked.map(esc).join(", ")}</div>` : ""}</td></tr>`).join("")}</table>` : `<p class="muted">Nenhuma alteração nos primeiros produtos.</p>`}
      </div>`;
  }

  // ================================================================== LABELS
  VIEWS.labels = (main) => {
    const labelRules = (lf) => (S.cfg.rules || []).filter((r) => r.actions.some((a) => a.field === lf));
    main.innerHTML = `
      <div class="head"><div><h1>Labels</h1><div class="muted">custom_label_0 a 4 servem Meta e GMC (segmentação de campanhas, PMax, catálogos). Cada label é calculado uma vez por produto (cache) e pode ter agendamento — entre datas (ex.: Black Friday) ou até o removeres. Os presets criam regras que podes afinar em <a href="#rules" data-go="rules">Regras</a>.</div></div></div>
      ${S.cfg.lockedFields.some((f) => f.startsWith("custom_label")) ? `<div class="callout" style="margin-bottom:14px">Há labels trancados — regras sobre eles são ignoradas.</div>` : ""}
      ${["custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"].map((lf) => `
        <div class="card">
          <div class="row"><h2 class="grow" style="margin:0">${lf} ${S.cfg.lockedFields.includes(lf) ? `<span class="badge lock">🔒 trancado</span>` : ""}</h2>
            <select data-preset="${lf}">
              <option value="">＋ Adicionar preset…</option>
              <option value="price">Faixa de preço</option>
              <option value="sale">Em promoção (sale_price preenchido)</option>
              <option value="discount">Desconto ≥ X%</option>
              <option value="new">Novidades (primeiros N dias no feed)</option>
              <option value="map">Mapear a partir de outro campo</option>
              <option value="fixed">Valor fixo para todos</option>
              <option value="clear">Limpar (valor vazio)</option>
            </select></div>
          <div style="margin-top:8px">${labelRules(lf).length ? labelRules(lf).map((r) => `<div class="row small">${statusBadge(r)}${esc(r.name)} <span class="muted">[${esc(scheduleText(r))}] — ${r.conditions.length ? r.conditions.map((c) => `${esc(c.field)} ${esc(OP_LABEL[c.op] || c.op)} ${esc(c.value ?? "")}`).join(r.match === "any" ? " ou " : " e ") : "todos"}</span></div>`).join("") : `<span class="muted small">Sem regras — mantém o valor da origem.</span>`}</div>
        </div>`).join("")}`;
    $$("[data-go]", main).forEach((el) => (el.onclick = (e) => { e.preventDefault(); S.view = "rules"; render(); }));
    $$("[data-preset]", main).forEach((sel) => (sel.onchange = () => { const p = sel.value; sel.value = ""; if (p) labelPreset(sel.dataset.preset, p); }));
  };

  function labelPreset(lf, p) {
    const forms = {
      price: `<label class="f">Faixas (€) <input id="lp-a" value="0-25,25-50,50-100,100-250,250+" /></label><label class="f">Com base em <select id="lp-b"><option value="_effective_price">preço efetivo (promo se existir)</option><option value="_price">preço normal</option></select></label>`,
      sale: `<label class="f">Valor quando em promoção <input id="lp-a" value="promo" /></label><label class="f">Valor quando não está (vazio = não mexe) <input id="lp-b" value="regular" /></label>`,
      discount: `<label class="f">Desconto mínimo (%) <input id="lp-a" type="number" value="30" /></label><label class="f">Valor <input id="lp-b" value="desconto-forte" /></label>`,
      new: `<label class="f">Dias <input id="lp-a" type="number" value="30" /></label><label class="f">Valor <input id="lp-b" value="novidade" /></label>`,
      map: `<label class="f">Campo de origem <select id="lp-a">${fieldOptions("brand")}</select></label><label class="f">Mapa (origem => label, uma por linha) <textarea id="lp-b" rows="5" placeholder="hôma => marca própria&#10;atmosphera => marca parceira"></textarea></label><label class="f">Fallback (opcional, aceita {{campo}}) <input id="lp-c" /></label>`,
      fixed: `<label class="f">Valor <input id="lp-a" /></label>`,
      clear: `<p class="muted">Cria uma regra que esvazia ${lf} em todos os produtos.</p>`,
    };
    modal(`<h2>${lf} — preset</h2><div class="form">${forms[p]}<label class="f">Agendamento<div class="row" id="lp-sched">${scheduleFields({}, "data-ls")}</div></label><div class="row"><span class="grow"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="lp-ok">Criar regra</button></div></div>`);
    let sched = { mode: "always" };
    const wireSched = () => $$("[data-ls]", $("#lp-sched")).forEach((el) => (el.onchange = () => {
      sched = { ...sched, [el.dataset.ls]: el.value };
      if (sched.mode !== "always" && !sched.start) sched.start = today();
      $("#lp-sched").innerHTML = scheduleFields(sched, "data-ls");
      wireSched();
    }));
    wireSched();
    $("#lp-ok").onclick = (e) => guard(async () => {
      if (sched.mode === "range" && !sched.end) throw new Error("Indica a data de fim");
      const a = $("#lp-a")?.value, b = $("#lp-b")?.value, c = $("#lp-c")?.value;
      const rules = [];
      if (p === "price") rules.push(newRule({ name: `${lf}: faixa de preço`, actions: [{ type: "price_bucket", field: lf, source: b, buckets: a }] }));
      if (p === "sale") {
        if (b) rules.push(newRule({ name: `${lf}: ${b} (base)`, actions: [{ type: "set", field: lf, value: b }] }));
        rules.push(newRule({ name: `${lf}: ${a} se em promoção`, conditions: [{ field: "_discount_pct", op: "gt", value: "0" }], actions: [{ type: "set", field: lf, value: a }] }));
      }
      if (p === "discount") rules.push(newRule({ name: `${lf}: desconto ≥ ${a}%`, conditions: [{ field: "_discount_pct", op: "gte", value: a }], actions: [{ type: "set", field: lf, value: b }] }));
      if (p === "new") rules.push(newRule({ name: `${lf}: novidade (${a} dias)`, conditions: [{ field: "_days_since_first_seen", op: "lte", value: a }], actions: [{ type: "set", field: lf, value: b }] }));
      if (p === "map") rules.push(newRule({ name: `${lf}: a partir de ${a}`, actions: [{ type: "copy", field: lf, source: a }, { type: "map_values", field: lf, map: parseMap(b), value: c || "" }] }));
      if (p === "fixed") rules.push(newRule({ name: `${lf}: ${a}`, actions: [{ type: "set", field: lf, value: a }] }));
      if (p === "clear") rules.push(newRule({ name: `${lf}: limpar`, actions: [{ type: "set", field: lf, value: "" }] }));
      for (const r of rules) r.schedule = { ...sched };
      await saveConfig({ rules: [...(S.cfg.rules || []), ...rules] }, "Regra(s) criada(s)");
      draft = null;
      closeModal();
      render();
    }, e.target);
  }
  const _newRule = newRule;

  // ================================================================== FIELDS & LOCKS
  VIEWS.fields = (main) => {
    const cfg = S.cfg;
    const locked = new Set(cfg.lockedFields);
    const aiF = new Set(cfg.ai.fields);
    const req = new Set(cfg.quality.requireFields || []);
    main.innerHTML = `
      <div class="head"><div><h1>Campos &amp; locks</h1><div class="muted">Campos <b>trancados</b> passam sempre diretamente da origem para o Sheets (stock, preço…) — regras, AI e edições nunca lhes tocam.</div></div>
        <button class="btn primary" id="fl-save">Guardar</button></div>
      <div class="grid two">
        <div class="card" style="padding:0">
          <table><tr><th>Campo</th><th>🔒 Trancado</th><th>AI otimiza</th><th>Obrigatório</th></tr>
          ${headers().map((h) => `<tr><td class="mono">${esc(h)}</td>
            <td><input type="checkbox" data-lock="${esc(h)}" ${locked.has(h) ? "checked" : ""} ${h === cfg.idField ? "disabled" : ""} /></td>
            <td><input type="checkbox" data-ai="${esc(h)}" ${aiF.has(h) ? "checked" : ""} /></td>
            <td><input type="checkbox" data-req="${esc(h)}" ${req.has(h) ? "checked" : ""} /></td></tr>`).join("")}
          </table>
        </div>
        <div>
          <div class="card">
            <h2>Deteção de campos sub-otimizados</h2>
            <div class="form cols">
              <label class="f">Título — mínimo <input type="number" id="q-tmin" value="${cfg.quality.titleMin}" /></label>
              <label class="f">Título — máximo <input type="number" id="q-tmax" value="${cfg.quality.titleMax}" /></label>
              <label class="f">Descrição — mínimo <input type="number" id="q-dmin" value="${cfg.quality.descMin}" /></label>
            </div>
            <p class="muted small">Também é sinalizado: MAIÚSCULAS, texto promocional, títulos duplicados (sem item_group_id), HTML na descrição, descrição igual ao título, GTIN inválido e campos obrigatórios vazios.</p>
          </div>
          <div class="callout info" style="margin-top:14px">Um campo que está trancado e marcado para AI é ignorado pela AI. Recomendação: tranca <code>availability</code>, <code>price</code>, <code>sale_price</code>, <code>link</code>, <code>image_link</code> e <code>gtin</code>.</div>
        </div>
      </div>`;
    $("#fl-save").onclick = (e) => guard(async () => {
      const lockedFields = $$("[data-lock]", main).filter((c) => c.checked).map((c) => c.dataset.lock);
      for (const f of cfg.lockedFields) if (!headers().includes(f)) lockedFields.push(f); // keep locks of fields not in this feed
      await saveConfig({
        lockedFields: [...new Set([cfg.idField, ...lockedFields])],
        ai: { ...cfg.ai, fields: $$("[data-ai]", main).filter((c) => c.checked).map((c) => c.dataset.ai) },
        quality: { ...cfg.quality, titleMin: Number($("#q-tmin").value), titleMax: Number($("#q-tmax").value), descMin: Number($("#q-dmin").value), requireFields: $$("[data-req]", main).filter((c) => c.checked).map((c) => c.dataset.req) },
      });
      render();
    }, e.target);
  };

  // ================================================================== AI
  VIEWS.ai = (main) => {
    const ai = S.cfg.ai;
    main.innerHTML = `
      <div class="head"><div><h1>AI</h1><div class="muted">No run diário, a AI só corre para <b>produtos novos</b> (vs dia anterior) — os restantes mantêm a copy já gerada. Podes forçar produtos em Produtos → “Enviar filtro para AI”.</div></div>
        <button class="btn primary" id="ai-save">Guardar</button></div>
      ${S.me.hasAnthropic ? "" : `<div class="callout" style="margin-bottom:14px">Falta a variável <code>ANTHROPIC_API_KEY</code> no Netlify.</div>`}
      <div class="grid two">
        <div class="card form">
          <label class="chk"><input type="checkbox" id="ai-en" ${ai.enabled ? "checked" : ""}/> AI ativa no run diário</label>
          <label class="f">Modelo <input id="ai-model" value="${esc(ai.model)}" /></label>
          <label class="f">Produtos novos que vão à AI
            <select id="ai-mode"><option value="flagged" ${ai.mode !== "all" ? "selected" : ""}>Só os que têm campos sub-otimizados</option><option value="all" ${ai.mode === "all" ? "selected" : ""}>Todos os produtos novos</option></select></label>
          <label class="f">Máximo de produtos por run <input type="number" id="ai-max" value="${ai.maxPerRun}" /></label>
          <label class="chk"><input type="checkbox" id="ai-reopt" ${ai.reoptimizeOnSourceChange ? "checked" : ""}/> Re-otimizar também produtos existentes cujo conteúdo mudou na origem</label>
          <p class="muted small">Fila atual: <b>${S.summary.aiQueue}</b> produtos. O excedente acima do máximo passa para o run seguinte.</p>
        </div>
        <div class="card form">
          <label class="f">Tom de voz / contexto da marca <textarea id="ai-voice" rows="5">${esc(ai.brandVoice)}</textarea></label>
          <p class="muted small">Campos otimizados: <b>${ai.fields.join(", ") || "nenhum"}</b> (altera em Campos &amp; locks).</p>
        </div>
      </div>
      <div class="card"><h2>Instruções por campo</h2><div class="form">
        ${ai.fields.map((f) => `<label class="f">${esc(f)}<textarea data-instr="${esc(f)}" rows="2">${esc(ai.fieldInstructions?.[f] || S.me.aiPresets?.[f] || "")}</textarea></label>`).join("")}
      </div></div>`;
    $("#ai-save").onclick = (e) => guard(async () => {
      const fieldInstructions = { ...ai.fieldInstructions };
      $$("[data-instr]", main).forEach((t) => (fieldInstructions[t.dataset.instr] = t.value));
      await saveConfig({ ai: { ...ai, enabled: $("#ai-en").checked, model: $("#ai-model").value.trim(), mode: $("#ai-mode").value, maxPerRun: Number($("#ai-max").value) || 300, reoptimizeOnSourceChange: $("#ai-reopt").checked, brandVoice: $("#ai-voice").value, fieldInstructions } });
    }, e.target);
  };

  // ================================================================== GMC
  let gmcDraft = null;
  VIEWS.gmc = async (main) => {
    const g = S.cfg.gmc;
    if (!gmcDraft || gmcDraft._feed !== S.feedId) {
      gmcDraft = g.mapping?.length ? clone(g.mapping) : await api(F("/gmc/auto-mapping"));
      gmcDraft._feed = S.feedId;
      gmcDraft._auto = !g.mapping?.length;
    }
    main.innerHTML = `
      <div class="head"><div><h1>Conversão Meta → GMC</h1><div class="muted">Cada linha gera uma coluna do feed GMC a partir do feed Meta já otimizado. Campos exclusivos do Meta (fb_product_category, inventory…) são descartados.</div></div>
        <div class="row"><button class="btn" id="g-auto">Repor automático</button><button class="btn" id="g-add">＋ Coluna</button><button class="btn primary" id="g-save">Guardar</button></div></div>
      <div class="card form cols" style="margin-bottom:14px">
        <label class="chk"><input type="checkbox" id="g-en" ${g.enabled !== false ? "checked" : ""}/> Gerar feed GMC</label>
        <label class="f">Moeda por omissão <input id="g-cur" value="${esc(g.currency || "EUR")}" /></label>
        <div class="muted small">${gmcDraft._auto ? "A usar mapeamento <b>automático</b> (adapta-se a novas colunas). Ao guardar, fica fixo." : "Mapeamento personalizado."}</div>
      </div>
      <div class="card" style="padding:0">
        <table><tr><th>Coluna GMC</th><th>Origem (Meta)</th><th>Transformação</th><th>Valor / template</th><th></th></tr>
        ${gmcDraft.map((m, i) => `<tr data-i="${i}">
          <td><input data-m="target" value="${esc(m.target)}" /></td>
          <td><select data-m="source"><option value="">—</option>${fieldOptions(m.source)}</select></td>
          <td><select data-m="transform">${S.me.transforms.map((t) => `<option value="${t}" ${t === m.transform ? "selected" : ""}>${esc(TF_LABEL[t] || t)}</option>`).join("")}</select></td>
          <td>${["template", "constant"].includes(m.transform) ? `<input data-m="value" value="${esc(m.value ?? "")}" placeholder="${m.transform === "template" ? "{{brand}} {{title}}" : "valor"}" />` : ""}</td>
          <td><button class="btn sm ghost danger" data-del="${i}">✕</button></td></tr>`).join("")}
        </table>
      </div>
      <div class="callout info" style="margin-top:14px">availability: <code>in stock → in_stock</code>, <code>out of stock → out_of_stock</code>, <code>available for order → backorder</code>, <code>preorder → preorder</code>. <code>identifier_exists</code> = yes quando há GTIN (ou MPN + marca). Dica: o GMC aceita também a Google Sheet diretamente como fonte de dados (Produtos → Fontes de dados → Google Sheets).</div>`;
    const tbl = $("table", main);
    tbl.oninput = tbl.onchange = (e) => {
      const i = e.target.closest("tr")?.dataset.i;
      if (i == null || !e.target.dataset.m) return;
      gmcDraft[i][e.target.dataset.m] = e.target.value;
      gmcDraft._auto = false;
      if (e.target.dataset.m === "transform" && e.type === "change") VIEWS.gmc(main);
    };
    tbl.onclick = (e) => { if (e.target.dataset.del != null) { gmcDraft.splice(Number(e.target.dataset.del), 1); gmcDraft._auto = false; VIEWS.gmc(main); } };
    $("#g-add").onclick = () => { gmcDraft.push({ target: "", source: "", transform: "copy" }); gmcDraft._auto = false; VIEWS.gmc(main); };
    $("#g-auto").onclick = () => guard(async () => { await saveConfig({ gmc: { ...g, mapping: null } }, "Mapeamento automático reposto"); gmcDraft = null; VIEWS.gmc(main); });
    $("#g-save").onclick = (e) => guard(async () => {
      const mapping = gmcDraft._auto ? null : gmcDraft.filter((m) => m.target).map(({ target, source, transform, value }) => ({ target, source, transform, value }));
      await saveConfig({ gmc: { ...g, enabled: $("#g-en").checked, currency: $("#g-cur").value.trim() || "EUR", mapping } });
      gmcDraft = null;
      VIEWS.gmc(main);
    }, e.target);
  };

  // ================================================================== SETTINGS
  VIEWS.settings = (main) => {
    const c = S.cfg;
    main.innerHTML = `
      <div class="head"><div><h1>Definições</h1><div class="muted">${esc(c.name)} · id <code>${esc(c.id)}</code></div></div><button class="btn primary" id="s-save">Guardar</button></div>
      <div class="card">
        <h2>Origem</h2>
        <div class="form">
          <label class="f">URL do CSV (feed Meta, atualizado diariamente)
            <div class="row"><input id="s-url" class="grow" value="${esc(c.sourceUrl)}" placeholder="https://…/meta_homa_pt_pt.csv" /><button class="btn" id="s-test">Testar</button></div></label>
          <div id="s-test-out"></div>
          <div class="form cols">
            <label class="f">Nome <input id="s-name" value="${esc(c.name)}" /></label>
            <label class="f">Língua <select id="s-lang"><option value="pt-PT" ${c.language === "pt-PT" ? "selected" : ""}>Português (PT)</option><option value="es-ES" ${c.language === "es-ES" ? "selected" : ""}>Español (ES)</option></select></label>
            <label class="f">Coluna de ID <select id="s-idf">${fieldOptions(c.idField)}</select></label>
            <label class="f">Proteção: abortar se o feed tiver menos de <select id="s-ratio">${[0.3, 0.5, 0.7, 0.9].map((r) => `<option value="${r}" ${Number(c.minRowRatio) === r ? "selected" : ""}>${r * 100}% dos produtos de ontem</option>`).join("")}</select></label>
          </div>
        </div>
      </div>
      <div class="card">
        <h2>Destino — Google Sheets</h2>
        <div class="form">
          <label class="f">URL ou ID da Google Sheet <input id="s-sheet" value="${esc(c.sheetId)}" placeholder="https://docs.google.com/spreadsheets/d/…" /></label>
          <div class="form cols">
            <label class="f">Separador Meta <input id="s-tab-meta" value="${esc(c.sheetTabs.meta)}" /></label>
            <label class="f">Separador GMC <input id="s-tab-gmc" value="${esc(c.sheetTabs.gmc)}" /></label>
          </div>
          <div class="callout ${S.me.hasGoogle ? "info" : ""}">${S.me.hasGoogle
            ? `Partilha a Google Sheet como <b>Editor</b> com a service account:<div class="link-box" style="margin-top:6px"><code>${esc(S.me.serviceAccount)}</code><button class="btn sm" id="copy-sa">Copiar</button></div><div class="small" style="margin-top:6px">E para o link ficar público: Partilhar → “Qualquer pessoa com o link” → Leitor.</div>`
            : `Falta a variável <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> no Netlify (ver README).`}</div>
        </div>
      </div>
      <div class="card">
        <h2>Agendamento</h2>
        <div class="form cols">
          <label class="chk"><input type="checkbox" id="s-sched" ${c.scheduleEnabled ? "checked" : ""}/> Run diário automático</label>
          <label class="f">Hora (Lisboa) <select id="s-hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${Number(c.runHour) === h ? "selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></label>
        </div>
        <p class="muted small">Escolhe uma hora depois da atualização diária do CSV no SFCC. Se o run falhar, tenta de novo na hora seguinte (até 3 vezes).</p>
      </div>
      <div class="card"><h2>Zona perigosa</h2><div class="row"><button class="btn danger" id="s-unlock">Libertar lock de run</button><button class="btn danger" id="s-del">Apagar este feed</button></div></div>`;
    if ($("#copy-sa")) $("#copy-sa").onclick = () => { navigator.clipboard.writeText(S.me.serviceAccount); toast("Copiado"); };
    $("#s-test").onclick = (e) => guard(async () => {
      $("#s-test-out").innerHTML = `<p class="muted">A descarregar…</p>`;
      const r = await api(F("/test-source"), { method: "POST", body: { url: $("#s-url").value.trim() } });
      $("#s-test-out").innerHTML = `<div class="callout info"><b>${r.count}</b> produtos · ${r.headers.length} colunas · ${r.ms} ms ${r.hasId ? "" : `· <span class="err">coluna de ID "${esc(c.idField)}" não encontrada</span>`}
        <div class="small mono" style="margin-top:6px">${r.headers.map(esc).join(", ")}</div>
        ${r.warnings?.length ? `<div class="small err">${r.warnings.map(esc).join("<br>")}</div>` : ""}</div>`;
      if (S.summary) S.summary.headers = r.headers;
    }, e.target);
    $("#s-save").onclick = (e) => guard(async () => {
      await saveConfig({
        sourceUrl: $("#s-url").value.trim(), name: $("#s-name").value.trim(), language: $("#s-lang").value, idField: $("#s-idf").value,
        minRowRatio: Number($("#s-ratio").value), sheetId: $("#s-sheet").value.trim(),
        sheetTabs: { meta: $("#s-tab-meta").value.trim() || "meta", gmc: $("#s-tab-gmc").value.trim() || "gmc" },
        scheduleEnabled: $("#s-sched").checked, runHour: Number($("#s-hour").value),
      });
      const opt = $(`#feed-select option[value="${CSS.escape(S.feedId)}"]`);
      if (opt) opt.textContent = S.cfg.name;
      render();
    }, e.target);
    $("#s-unlock").onclick = () => guard(async () => { await api(F("/lock"), { method: "DELETE" }); toast("Lock libertado"); });
    $("#s-del").onclick = () => guard(async () => {
      if (!(await ask("Apagar o feed e todo o histórico, edições e copy AI?", { ok: "Apagar feed", danger: true, typeToConfirm: c.id }))) return;
      await api(F(), { method: "DELETE" });
      try { localStorage.removeItem("ff_feed"); } catch {}
      location.hash = "";
      location.reload();
    });
  };

  // ================================================================== HISTORY
  VIEWS.history = async (main) => {
    main.innerHTML = `<div class="head"><div><h1>Histórico</h1><div class="muted">Últimos 40 runs.</div></div></div><div id="h-list" class="card"><div class="empty">A carregar…</div></div>`;
    const runs = await guard(() => api(F("/runs")));
    if (!runs) return;
    $("#h-list").innerHTML = runs.length ? `<table><tr><th>Quando</th><th>Tipo</th><th>Estado</th><th>Diff</th><th>Output</th><th>AI</th></tr>
      ${runs.map((r, i) => `<tr class="click" data-i="${i}"><td>${fmtDate(r.startedAt)}</td><td class="small">${r.trigger === "schedule" ? "agendado" : "manual"} · ${r.mode === "rebuild" ? "aplicar" : "completo"}</td>
        <td><span class="badge ${r.status === "ok" ? "new" : r.status === "error" ? "ex" : ""}">${r.status}</span></td>
        <td class="small">${r.diff ? `+${r.diff.new} / −${r.diff.removed} / ~${r.diff.changedContent} / $${r.diff.changedLocked}` : "—"}</td>
        <td class="small">${r.output ? `${r.output.meta} Meta · ${r.output.gmc} GMC` : "—"}</td>
        <td class="small">${r.ai ? `${r.ai.optimized} (fila ${r.ai.remaining})` : "—"}</td></tr>
        <tr class="hidden" id="h-${i}"><td colspan="6"><div class="steps">${r.steps.map((s) => `${(s.t / 1000).toFixed(1)}s  ${esc(s.msg)}`).join("\n")}</div>
          ${r.diffSample?.new?.length ? `<p class="small"><b>Novos:</b> <span class="mono">${r.diffSample.new.map(esc).join(", ")}</span></p>` : ""}
          ${r.diffSample?.removed?.length ? `<p class="small"><b>Removidos:</b> <span class="mono">${r.diffSample.removed.map(esc).join(", ")}</span></p>` : ""}</td></tr>`).join("")}</table>
      <p class="muted small" style="padding:0 10px">Diff: +novos / −removidos / ~conteúdo alterado / $só stock ou preço</p>` : `<div class="empty">Sem runs.</div>`;
    $$("tr[data-i]", main).forEach((tr) => (tr.onclick = () => $(`#h-${tr.dataset.i}`).classList.toggle("hidden")));
  };
})();
