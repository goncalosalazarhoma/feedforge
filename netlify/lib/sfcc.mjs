// Salesforce B2C Commerce (SCAPI) — read-only Shopper Products client.
// Live price / promotions / stock per site (Homa_PT, Homa_ES), the same data the storefront shows to a guest.
// Auth: SLAS guest token.
//   - private client (SFCC_CLIENT_SECRET set): client_credentials
//   - public client (default; the PWA's own client): authorization_code_pkce with hint=guest
// Env: SFCC_CLIENT_ID (required), SFCC_CLIENT_SECRET, SFCC_SHORT_CODE, SFCC_ORG_ID, SFCC_REDIRECT_URI, SFCC_SITES ({"pt":"Homa_PT","es":"Homa_ES"}).
import crypto from "node:crypto";
import { db } from "./store.mjs";

const env = (k) => String(process.env[k] ?? "").trim();
export const sfccConfig = () => {
  let sites = { pt: "Homa_PT", es: "Homa_ES" };
  try { if (env("SFCC_SITES")) sites = { ...sites, ...JSON.parse(env("SFCC_SITES")) }; } catch {}
  return {
    shortCode: env("SFCC_SHORT_CODE") || "5gapigs5",
    orgId: env("SFCC_ORG_ID") || "f_ecom_bfdh_prd",
    clientId: env("SFCC_CLIENT_ID"),
    secret: env("SFCC_CLIENT_SECRET"),
    redirectUri: env("SFCC_REDIRECT_URI") || "https://www.homastores.com/callback",
    sites,
  };
};
export const sfccMissing = () => (sfccConfig().clientId ? [] : ["SFCC_CLIENT_ID"]);
export const BATCH = 24; // Shopper Products getProducts: max ids per call

const base = (c) => `https://${c.shortCode}.api.commercecloud.salesforce.com`;
const authUrl = (c, p) => `${base(c)}/shopper/auth/v1/organizations/${c.orgId}/oauth2/${p}`;
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenKey = (site) => `sfcc/token/${site}`;
const mem = new Map(); // site -> { token, exp }
const inflight = new Map(); // site -> Promise<token>

async function readError(res) {
  const t = await res.text();
  try { const j = JSON.parse(t); return j.message || j.detail || j.title || t.slice(0, 200); } catch { return t.slice(0, 200); }
}

async function newToken(c, site, fetchFn) {
  if (!c.clientId) throw Object.assign(new Error("Falta a variável de ambiente SFCC_CLIENT_ID no Netlify"), { status: 400 });
  let res;
  if (c.secret) {
    res = await fetchFn(authUrl(c, "token"), {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", channel_id: site }).toString(),
    });
  } else {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const q = new URLSearchParams({ redirect_uri: c.redirectUri, response_type: "code", client_id: c.clientId, hint: "guest", channel_id: site, code_challenge: challenge });
    const auth = await fetchFn(`${authUrl(c, "authorize")}?${q}`, { redirect: "manual" });
    const loc = auth.headers.get("location");
    if (!loc) throw Object.assign(new Error(`SFCC: login de convidado sem redirect (${auth.status}): ${await readError(auth)}`), { status: 502 });
    const back = new URL(loc, c.redirectUri);
    const code = back.searchParams.get("code"), usid = back.searchParams.get("usid");
    if (!code) throw Object.assign(new Error(`SFCC: o login de convidado não devolveu código (${back.searchParams.get("error") || "sem detalhe"})`), { status: 502 });
    res = await fetchFn(authUrl(c, "token"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code_pkce", code, usid: usid || "", code_verifier: verifier, client_id: c.clientId, redirect_uri: c.redirectUri, channel_id: site }).toString(),
    });
  }
  if (!res.ok) throw Object.assign(new Error(`SFCC recusou o token (${res.status}): ${await readError(res)}`), { status: 502 });
  const j = await res.json();
  const t = { token: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in || 1800) - 120) * 1000 };
  mem.set(site, t);
  await db.set(tokenKey(site), t);
  return t.token;
}

async function token(c, site, fetchFn, force = false) {
  if (!force) {
    const m = mem.get(site);
    if (m && m.exp > Date.now()) return m.token;
    const s = await db.get(tokenKey(site));
    if (s?.token && s.exp > Date.now()) { mem.set(site, s); return s.token; }
  }
  // parallel batches share one login
  if (!inflight.has(site)) inflight.set(site, newToken(c, site, fetchFn).finally(() => inflight.delete(site)));
  return inflight.get(site);
}

// SCAPI product → the fields the folhetos / blocks need
export function normalizeProduct(p) {
  const books = Object.values(p.prices || {}).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const promos = (p.productPromotions || []).map((x) => ({ id: x.promotionId, price: Number.isFinite(Number(x.promotionalPrice)) ? Number(x.promotionalPrice) : null, text: x.calloutMsg || "" }));
  const promoPrice = promos.map((x) => x.price).filter((n) => n !== null && n > 0).sort((a, b) => a - b)[0] ?? null;
  const base = Number(p.price);
  const price = promoPrice !== null && (!Number.isFinite(base) || promoPrice < base) ? promoPrice : Number.isFinite(base) ? base : null;
  const listMax = books.length ? Math.max(...books, Number.isFinite(base) ? base : 0) : (promoPrice !== null && Number.isFinite(base) ? base : null);
  const inv = p.inventory || {};
  const img = p.imageGroups?.find((g) => g.viewType === "large") || p.imageGroups?.[0];
  return {
    id: String(p.id),
    name: p.name || "",
    price,
    listPrice: listMax && price !== null && listMax > price ? listMax : null,
    currency: p.currency || "EUR",
    promotions: promos,
    stock: Number.isFinite(Number(inv.ats)) ? Number(inv.ats) : null,
    orderable: inv.orderable !== false,
    inStock: inv.orderable !== false && !(Number(inv.ats) <= 0),
    image: img?.images?.[0]?.disBaseLink || img?.images?.[0]?.link || "",
  };
}

// ids -> { found: {id: product}, missing: [ids] } for one market (batches of 24, 2 at a time)
export async function getProducts(ids, market = "pt", { fetchFn = fetch } = {}) {
  const c = sfccConfig();
  const site = c.sites[market];
  if (!site) throw Object.assign(new Error(`Mercado sem site SFCC: ${market}`), { status: 400 });
  const uniq = [...new Set(ids.map(String).filter(Boolean))];
  const found = {};
  const batches = [];
  for (let i = 0; i < uniq.length; i += BATCH) batches.push(uniq.slice(i, i + BATCH));
  let calls = 0;
  const one = async (batch) => {
    const q = new URLSearchParams({ ids: batch.join(","), siteId: site, expand: "prices,availability,promotions,images", allImages: "false" });
    const url = `${base(c)}/product/shopper-products/v1/organizations/${c.orgId}/products?${q}`;
    for (let attempt = 0, refreshed = false; attempt < 4; attempt++) {
      calls++;
      const res = await fetchFn(url, { headers: { authorization: `Bearer ${await token(c, site, fetchFn)}`, accept: "application/json" } });
      if (res.status === 401 && !refreshed) { refreshed = true; await token(c, site, fetchFn, true); continue; }
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000)); continue; }
      if (res.status === 404) return; // none of the ids exist on this site
      if (!res.ok) throw Object.assign(new Error(`SFCC ${res.status}: ${await readError(res)}`), { status: 502 });
      const j = await res.json();
      for (const p of j.data || []) found[String(p.id)] = normalizeProduct(p);
      return;
    }
    throw Object.assign(new Error("SFCC indisponível (várias tentativas)"), { status: 502 });
  };
  for (let i = 0; i < batches.length; i += 2) await Promise.all(batches.slice(i, i + 2).map(one));
  return { site, found, missing: uniq.filter((id) => !found[id]), calls };
}
