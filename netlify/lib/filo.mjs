// Run report to Filo (internal team hub): one POST at the end of every run, success or not.
// Best effort — any failure here is logged and swallowed, it never breaks the run.
import { todayLisbon } from "./util.mjs";

const CATALOG = [
  { key: "feed_products_changed", label: "Products changed", unit: "count", higher_is_better: true, dimensions: ["market"] },
  { key: "feed_errors", label: "Feed errors", unit: "count", higher_is_better: false, dimensions: ["market"] },
];
const TIMEOUT_MS = 15_000;
const RETRY_DELAYS = [2000, 4000, 8000]; // on 429 / 5xx / network error

// "pt-PT" → "PT", "es-ES" → "ES"; unknown → null (metrics then go without dimensions)
const marketOf = (cfg) => { const m = /^(pt|es)\b/i.exec(cfg?.language || ""); return m ? m[1].toUpperCase() : null; };

// log = runFeed's run log (may be partial or missing when the run failed early)
export function buildFiloPayload({ feedId, cfg, log, error }) {
  const started = log?.startedAt ? new Date(log.startedAt) : new Date();
  const finished = log?.finishedAt ? new Date(log.finishedAt) : new Date();
  const runId = `${feedId}-${log?.id || started.getTime()}`;
  const failed = !!error || log?.status === "error";
  const errorMsgs = (log?.steps || []).map((s) => s.msg).filter((m) => /^(ERRO|Erro AI|AI parada)/.test(m));
  if (error && !errorMsgs.some((m) => m.includes(error.message))) errorMsgs.unshift(`ERRO: ${error.message}`);
  // errors = products the AI failed on + 1 if the AI was stopped (key/credit) + 1 if the run itself failed
  const errors = (log?.ai?.failed || 0) + (log?.ai?.fatal ? 1 : 0) + (failed ? 1 : 0);
  const status = failed ? "failed" : errors ? "partial" : "success";

  const market = marketOf(cfg);
  const dims = market ? { dimensions: { market } } : {};
  const date = todayLisbon(started);
  const metrics = [];
  // daily metrics only from full runs that actually started (a "rebuild" re-uses the last download and would report 0 changes)
  if (log?.startedAt && log.mode === "full") {
    if (log?.diff) metrics.push({ key: "feed_products_changed", period: "day", date, value: log.diff.new + log.diff.changedContent + log.diff.changedLocked, ...dims });
    metrics.push({ key: "feed_errors", period: "day", date, value: errors, ...dims });
  }

  const payload = {
    catalog: CATALOG,
    metrics,
    events: [{ type: "run_completed", at: finished.toISOString(), data: { run_id: runId, status, duration_s: Math.round((finished - started) / 1000) } }],
    alerts: [],
  };
  if (status !== "success") {
    const name = cfg?.name || feedId;
    const link = process.env.URL || (cfg?.sheetId ? `https://docs.google.com/spreadsheets/d/${cfg.sheetId}` : undefined);
    payload.alerts.push({
      external_id: runId,
      severity: failed ? "critical" : "warning",
      title: failed ? `Feed run failed (${name})` : `Feed run finished with ${errors} error${errors === 1 ? "" : "s"} (${name})`,
      message: errorMsgs.slice(0, 3).join(" | ").slice(0, 500) || "Sem detalhe",
      ...(link?.startsWith("https://") ? { link_url: link } : {}),
    });
  }
  return payload;
}

export async function reportToFilo(payload) {
  const url = process.env.FILO_INBOX_URL, key = process.env.FILO_API_KEY;
  if (!url || !key) { console.warn("[filo] FILO_INBOX_URL / FILO_API_KEY em falta — relatório não enviado"); return; }
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      console.log(`[filo] ${res.status} ${text.slice(0, 1000)}`);
      if (res.ok) {
        let body = null;
        try { body = JSON.parse(text); } catch {}
        if (body?.rejected?.length) console.warn("[filo] rejeitado:", JSON.stringify(body.rejected));
        return body;
      }
      if (res.status !== 429 && res.status < 500) return; // 4xx: retrying won't help
    } catch (e) {
      console.warn(`[filo] tentativa ${attempt + 1} falhou: ${e.message}`);
    }
    if (attempt < RETRY_DELAYS.length) await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
  }
  console.error("[filo] desisti depois de 4 tentativas");
}

// Never throws.
export async function reportRun(args) {
  try { await reportToFilo(buildFiloPayload(args)); } catch (e) { console.error("[filo] erro inesperado:", e.message); }
}
