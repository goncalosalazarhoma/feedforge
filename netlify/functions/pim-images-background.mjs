// Background: evaluate images for every product of a PIM job.
// Quantity from ATT_PRODUCT_IMAGE / ATT_AMBIANCE_IMAGES; quality from the image URLs of the matching product in the feed.
import { db, K, listFeeds } from "../lib/store.mjs";
import { authorized } from "../lib/http.mjs";
import { mapLimit } from "../lib/util.mjs";
import { PK } from "../lib/pim.mjs";
import { probe, assetCount, scoreImages } from "../lib/images.mjs";

const norm = (id) => String(id || "").trim().replace(/^0+/, "");

export async function evaluateImages(id, { deadline = Date.now() + 13 * 60 * 1000 } = {}) {
  const data = await db.get(PK.rows(id));
  // feed lookup (all feeds; first match wins)
  const lookup = new Map();
  for (const f of await listFeeds()) {
    const cfg = await db.get(K.config(f.id));
    const src = await db.get(K.source(f.id));
    if (!src) continue;
    for (const r of src.rows) {
      const key = norm(r[cfg?.idField || "id"]);
      if (!lookup.has(key)) lookup.set(key, { main: r.image_link, extra: String(r.additional_image_link || "").split(/[,|]\s*/).filter(Boolean), link: r.link });
    }
  }
  const prev = (await db.get(PK.images(id))) || { items: {} };
  const items = { ...prev.items };
  let probed = 0, matched = 0;
  await mapLimit(data.rows, 6, async (r) => {
    if (Date.now() > deadline) return;
    const product = assetCount(r.ATT_PRODUCT_IMAGE, r.sku);
    const ambiance = assetCount(r.ATT_AMBIANCE_IMAGES, r.sku);
    const feed = lookup.get(norm(r.sku));
    let probes = [];
    if (feed?.main) {
      matched++;
      const urls = [feed.main, ...feed.extra].slice(0, 6);
      probes = await Promise.all(urls.map((u) => probe(u)));
      probed += probes.length;
    }
    const s = scoreImages({ product, ambiance, probes });
    items[r.sku] = { product, ambiance, inFeed: !!feed, feedImages: probes.map(({ url, w, h, kb, format, error }) => ({ url, w, h, kb, format, error })), ...s, at: new Date().toISOString() };
  });
  const scored = Object.values(items);
  const summary = {
    products: data.rows.length,
    matchedInFeed: matched,
    probed,
    noImage: scored.filter((i) => i.product.effective === 0).length,
    lessThan3: scored.filter((i) => i.product.effective > 0 && i.product.effective < 3).length,
    noAmbiance: scored.filter((i) => i.ambiance.effective === 0).length,
    duplicatedCodes: scored.filter((i) => i.product.duplicated).length,
    lowRes: scored.filter((i) => i.issues.some((x) => x.startsWith("Resolução baixa"))).length,
    notSquare: scored.filter((i) => i.issues.some((x) => x.includes("não quadrada"))).length,
    broken: scored.filter((i) => i.issues.some((x) => x.includes("com erro"))).length,
    avgScore: (() => { const v = scored.map((i) => i.score ?? i.quantityScore).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })(),
  };
  await db.set(PK.images(id), { evaluatedAt: new Date().toISOString(), summary, items });
  return summary;
}

export default async (req) => {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id) return new Response("id em falta", { status: 400 });
  try { console.log("[pim-images]", id, JSON.stringify(await evaluateImages(id))); } catch (e) { console.error("[pim-images] falhou", e.message); }
};
