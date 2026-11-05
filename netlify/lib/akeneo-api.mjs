// Akeneo REST API client (read-only): pulls products + product models straight from the PIM
// and turns them into the same rows as an Akeneo XLSX export (ATT-locale-channel columns).
// Credentials only from env vars: AKENEO_URL, AKENEO_CLIENT_ID, AKENEO_SECRET, AKENEO_USERNAME, AKENEO_PASSWORD.
import { db } from "./store.mjs";

const TOKEN_KEY = "pim/akeneo-token";
const ENV = ["AKENEO_CLIENT_ID", "AKENEO_SECRET", "AKENEO_USERNAME", "AKENEO_PASSWORD"];

// values pasted into Netlify often carry a stray space or line break
const env = (k) => String(process.env[k] ?? "").trim();
export const akeneoBase = () => (env("AKENEO_URL") || "https://homa.cloud.akeneo.com").replace(/\/+$/, "");
export const akeneoMissing = () => ENV.filter((k) => !env(k));

async function newToken() {
  const missing = akeneoMissing();
  if (missing.length) throw Object.assign(new Error(`Faltam variáveis de ambiente: ${missing.join(", ")}`), { status: 400 });
  const basic = Buffer.from(`${env("AKENEO_CLIENT_ID")}:${env("AKENEO_SECRET")}`).toString("base64");
  const res = await fetch(`${akeneoBase()}/api/oauth/v1/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "password", username: env("AKENEO_USERNAME"), password: env("AKENEO_PASSWORD") }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // show Akeneo's own reason (it never echoes the credentials) and which variables to check
    const text = await res.text();
    let msg = text.slice(0, 200);
    try { msg = JSON.parse(text).message || msg; } catch {}
    const hint = /client|secret/i.test(msg) ? "verifica AKENEO_CLIENT_ID e AKENEO_SECRET" : /user|password/i.test(msg) ? "verifica AKENEO_USERNAME e AKENEO_PASSWORD" : `confirma as credenciais e o AKENEO_URL (${akeneoBase()})`;
    throw Object.assign(new Error(`Akeneo recusou a autenticação (${res.status}): ${msg} — ${hint}`), { status: 502 });
  }
  const j = await res.json();
  const t = { access_token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60_000 };
  await db.set(TOKEN_KEY, t); // server-side only (Netlify Blobs)
  return t.access_token;
}

async function token(force = false) {
  if (!force) { const t = await db.get(TOKEN_KEY); if (t?.access_token && t.exp > Date.now()) return t.access_token; }
  return newToken();
}

// GET a path or an absolute URL from the API (retries on 401 once, on 429/5xx with backoff)
export async function akeneoGet(pathOrUrl, params) {
  const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${akeneoBase()}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  let refreshed = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${await token()}`, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 401 && !refreshed) { refreshed = true; await token(true); continue; }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000)); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Akeneo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error("Akeneo indisponível (várias tentativas)");
}

// ---------------------------------------------------------------------------- values → export columns
const isoDate = /^\d{4}-\d{2}-\d{2}T00:00:00/;

// { ATT: [{ locale, scope, data }] } → { "ATT-pt_PT-ecommerce": "...", "ATT-unit": "CENTIMETER", "ATT_PVP-EUR": "20.00" }
export function valuesToColumns(values = {}, { locales = [], channel = "ecommerce" } = {}) {
  const out = {};
  for (const [attr, list] of Object.entries(values)) {
    for (const v of list || []) {
      if (v.locale && locales.length && !locales.includes(v.locale)) continue;
      if (v.scope && v.scope !== channel) continue;
      const col = [attr, v.locale, v.scope].filter(Boolean).join("-");
      const d = v.data;
      if (d === null || d === undefined || d === "") continue;
      if (Array.isArray(d) && d.length && d[0] && typeof d[0] === "object" && "currency" in d[0]) { for (const p of d) if (p.amount != null) out[`${col}-${p.currency}`] = String(p.amount); }
      else if (typeof d === "object" && !Array.isArray(d) && "amount" in d) { if (d.amount != null) { out[col] = String(d.amount); out[`${col}-unit`] = d.unit || ""; } }
      else if (Array.isArray(d)) out[col] = d.length && typeof d[0] === "object" ? JSON.stringify(d) : d.join(",");
      else if (typeof d === "boolean") out[col] = d ? "1" : "0";
      else if (typeof d === "string" && isoDate.test(d)) out[col] = d.slice(0, 10);
      else out[col] = typeof d === "object" ? JSON.stringify(d) : String(d);
    }
  }
  return out;
}

export function productToRow(p, opts) {
  const row = {
    sku: p.identifier || p.values?.sku?.[0]?.data || p.uuid,
    ...(p.parent ? { parent: p.parent } : {}),
    family: p.family || "",
    categories: (p.categories || []).join(","),
    enabled: p.enabled === false ? "0" : "1",
    ...valuesToColumns(p.values, opts),
  };
  for (const c of p.completenesses || []) if (c.scope === opts.channel && opts.locales.includes(c.locale)) row[`completeness_ratio-${c.locale}-${c.scope}`] = String(c.data);
  return row;
}

export function modelToRow(m, opts) {
  return {
    entity_type: "product_model",
    code: m.code,
    ...(m.parent ? { parent: m.parent } : {}),
    family: m.family || "",
    family_variant: m.family_variant || "",
    categories: (m.categories || []).join(","),
    ...valuesToColumns(m.values, opts),
  };
}

// Akeneo search filter from the import form
export function buildSearch(f = {}, { channel, locale }) {
  const s = {};
  const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
  if (list(f.skus).length) s.identifier = [{ operator: "IN", value: list(f.skus).slice(0, 1000) }];
  if (list(f.families).length) s.family = [{ operator: "IN", value: list(f.families) }];
  if (list(f.categories).length) s.categories = [{ operator: "IN", value: list(f.categories) }];
  if (f.incompleteOnly) s.completeness = [{ operator: "<", value: 100, scope: channel, locales: [locale] }];
  if (f.updatedSince) s.updated = [{ operator: ">", value: `${f.updatedSince} 00:00:00` }];
  if (f.enabledOnly) s.enabled = [{ operator: "=", value: true }];
  return s;
}

// Pull products (+ their parent models); stops at `limit` or the deadline.
export async function fetchFromAkeneo(filters, { channel = "ecommerce", locales = ["pt_PT", "es_ES"], limit = 1000, includeModels = true, deadline = Date.now() + 12 * 60 * 1000, onProgress } = {}) {
  const opts = { channel, locales };
  const rows = [];
  let next = "/api/rest/v1/products";
  let params = { search: buildSearch(filters, { channel, locale: locales[0] }), scope: channel, locales: locales.join(","), with_completenesses: "true", pagination_type: "search_after", limit: 100 };
  let truncated = false;
  while (next) {
    if (Date.now() > deadline) { truncated = true; break; }
    const page = await akeneoGet(next, params);
    params = null; // the next link already carries every parameter
    for (const p of page?._embedded?.items || []) {
      if (rows.length >= limit) { truncated = true; break; }
      rows.push(productToRow(p, opts));
    }
    if (rows.length >= limit) { truncated = !!page?._links?.next || truncated; break; }
    next = page?._links?.next?.href || null;
    await onProgress?.({ phase: "produtos", done: rows.length });
  }
  // parent models (sub-models and their root models) so edits can be routed to the right level
  let models = 0;
  if (includeModels) {
    const seen = new Set();
    let pending = [...new Set(rows.map((r) => r.parent).filter(Boolean))];
    while (pending.length && Date.now() < deadline) {
      const batch = pending.filter((c) => !seen.has(c));
      pending = [];
      for (let i = 0; i < batch.length; i += 4) {
        const got = await Promise.all(batch.slice(i, i + 4).map((code) => { seen.add(code); return akeneoGet(`/api/rest/v1/product-models/${encodeURIComponent(code)}`); }));
        for (const m of got.filter(Boolean)) { rows.push(modelToRow(m, opts)); models++; if (m.parent && !seen.has(m.parent)) pending.push(m.parent); }
        await onProgress?.({ phase: "modelos", done: rows.length - models, models });
      }
    }
  }
  return { rows, products: rows.length - models, models, truncated };
}

// export-like header order: identity columns first, then attributes alphabetically
export function headersFor(rows) {
  const first = ["entity_type", "code", "sku", "parent", "family", "family_variant", "categories", "enabled"];
  const all = new Set();
  for (const r of rows) for (const k of Object.keys(r)) all.add(k);
  return [...first.filter((h) => all.has(h)), ...[...all].filter((h) => !first.includes(h)).sort()];
}
