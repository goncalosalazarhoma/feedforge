// Public XML feeds for Meta / Google Merchant Center, generated from the last run's output.
// URL: /xml/<feed>/<token>/meta.xml | gmc.xml   (add .gz for a gzip-compressed file)
// The token (per feed, in Definições) keeps the URL unguessable without exposing the app.
import crypto from "node:crypto";
import { db, K } from "../lib/store.mjs";
import { xmlStream } from "../lib/xmlfeed.mjs";

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export default async (req) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean); // ["xml", feed, token, file]
  const [, feedId, token, file = ""] = parts;
  const m = /^(meta|gmc)\.xml(\.gz)?$/.exec(file);
  if (!feedId || !token || !m) return new Response("not found", { status: 404 });
  const cfg = await db.get(K.config(feedId));
  if (!cfg?.xmlToken || !same(token, cfg.xmlToken)) return new Response("not found", { status: 404 });
  const out = await db.get(K.output(feedId));
  if (!out) return new Response("feed ainda não gerado", { status: 503 });
  const channel = m[1];
  if (channel === "gmc" && cfg.gmc?.enabled === false) return new Response("not found", { status: 404 });
  const data = channel === "gmc" ? out.gmc : out.meta;
  const gzip = !!m[2];
  const body = xmlStream(data, { title: `${cfg.name || feedId} · ${channel === "gmc" ? "Google Merchant Center" : "Meta"}`, link: cfg.siteUrl || "https://www.homa.pt", description: `Gerado pelo FeedForge em ${out.generatedAt}` }, { gzip });
  return new Response(body, {
    headers: {
      "content-type": gzip ? "application/gzip" : "application/xml; charset=utf-8",
      ...(gzip ? { "content-disposition": `attachment; filename="${channel}.xml.gz"` } : {}),
      "last-modified": new Date(out.generatedAt || Date.now()).toUTCString(),
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, max-age=900, stale-while-revalidate=300", // CDN keeps it 15 min
      "x-robots-tag": "noindex",
    },
  });
};

export const config = { path: "/xml/*" };
