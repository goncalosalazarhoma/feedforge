// Background (up to 15 min): imports products straight from the Akeneo API into a PIM job,
// then runs the same steps as a file upload (normalise models, deductions/labels, diagnosis).
import { db } from "../lib/store.mjs";
import { authorized } from "../lib/http.mjs";
import { PK, getPimConfig, normaliseRows, refreshMeta } from "../lib/pim.mjs";
import { fetchFromAkeneo, headersFor } from "../lib/akeneo-api.mjs";
import { applyAuto } from "./pim-api.mjs";

export async function importFromAkeneo(id, { deadline = Date.now() + 12 * 60 * 1000 } = {}) {
  const cfg = await getPimConfig();
  const meta = await db.get(PK.job(id));
  const setImport = async (patch) => { const m = await db.get(PK.job(id)); m.import = { ...(m.import || {}), ...patch }; await db.set(PK.job(id), m); };
  try {
    const f = meta.import?.filters || {};
    let last = 0;
    const res = await fetchFromAkeneo(f, {
      channel: cfg.channel, locales: cfg.targetLocales, limit: Math.min(Number(f.limit) || 1000, 5000), includeModels: f.includeModels !== false, deadline,
      onProgress: async (p) => { if (Date.now() - last > 3000) { last = Date.now(); await setImport(p); } },
    });
    const rows = normaliseRows(res.rows);
    await db.set(PK.rows(id), { headers: headersFor(res.rows), rows, normalised: true });
    await applyAuto(id);
    const m = await db.get(PK.job(id));
    m.status = "ready";
    m.import = { ...(m.import || {}), phase: "concluído", done: res.products, models: res.models, truncated: res.truncated, skipped: res.skipped, finishedAt: new Date().toISOString() };
    await refreshMeta(id, m);
    return m.import;
  } catch (e) {
    console.error("[pim-akeneo] falhou", e.message);
    const m = await db.get(PK.job(id));
    m.status = "error";
    m.import = { ...(m.import || {}), phase: "erro", error: e.message, finishedAt: new Date().toISOString() };
    await db.set(PK.job(id), m);
    return m.import;
  }
}

export default async (req) => {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id) return new Response("id em falta", { status: 400 });
  console.log("[pim-akeneo]", id, JSON.stringify(await importFromAkeneo(id)));
};
