// RSS 2.0 + Google namespace (g:) — the XML format accepted by both Google Merchant Center and Meta catalogs.
const NS = "http://base.google.com/ns/1.0";
const MULTI = new Set(["additional_image_link", "product_highlight", "included_destination", "excluded_destination", "shopping_ads_excluded_country"]);

// strip characters XML 1.0 forbids, then escape
export function esc(v) {
  return String(v ?? "")
    .replace(/[^\u0009\u000A\u000D -퟿-�]/gu, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const tagOk = (h) => /^[a-z][a-z0-9_]*$/i.test(h) && !h.startsWith("_");

// "PT:Lisboa:Standard:4.99 EUR" → <g:shipping><g:country>PT</g:country>…</g:shipping>
function shipping(v) {
  return String(v).split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [country, region, service, price] = s.split(":");
    if (price === undefined) return `<g:shipping><g:price>${esc(s)}</g:price></g:shipping>`;
    return `<g:shipping>${country ? `<g:country>${esc(country)}</g:country>` : ""}${region ? `<g:region>${esc(region)}</g:region>` : ""}${service ? `<g:service>${esc(service)}</g:service>` : ""}<g:price>${esc(price)}</g:price></g:shipping>`;
  }).join("");
}

export function itemXml(headers, row) {
  let out = "<item>";
  for (const h of headers) {
    if (!tagOk(h)) continue;
    const v = row[h];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    if (h === "shipping") { out += shipping(v); continue; }
    if (MULTI.has(h)) { for (const part of String(v).split(/\s*,\s*/).filter(Boolean)) out += `<g:${h}>${esc(part)}</g:${h}>`; continue; }
    out += `<g:${h}>${esc(v)}</g:${h}>`;
  }
  return out + "</item>\n";
}

export function head({ title, link, description }) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="${NS}">\n<channel>\n<title>${esc(title)}</title>\n<link>${esc(link)}</link>\n<description>${esc(description)}</description>\n`;
}
export const TAIL = "</channel>\n</rss>\n";

// streamed so a 10k+ product feed never has to sit in one string
export function xmlStream(data, meta, { gzip = false } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  const CHUNK = 250;
  const stream = new ReadableStream({
    start(c) { c.enqueue(enc.encode(head(meta))); },
    pull(c) {
      if (i >= data.rows.length) { c.enqueue(enc.encode(TAIL)); c.close(); return; }
      let s = "";
      for (const end = Math.min(i + CHUNK, data.rows.length); i < end; i++) s += itemXml(data.headers, data.rows[i]);
      c.enqueue(enc.encode(s));
    },
  });
  return gzip ? stream.pipeThrough(new CompressionStream("gzip")) : stream;
}

export function toXml(data, meta) {
  return head(meta) + data.rows.map((r) => itemXml(data.headers, r)).join("") + TAIL;
}
