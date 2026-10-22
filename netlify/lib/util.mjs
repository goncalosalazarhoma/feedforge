import crypto from "node:crypto";
import Papa from "papaparse";

export function hash(obj) {
  return crypto.createHash("sha1").update(typeof obj === "string" ? obj : JSON.stringify(obj)).digest("hex").slice(0, 16);
}

// Hash a row restricted to (or excluding) a set of fields, with stable key order.
export function hashFields(row, fields, { exclude = false } = {}) {
  const set = new Set(fields);
  const keys = Object.keys(row).filter((k) => (exclude ? !set.has(k) : set.has(k))).sort();
  return hash(keys.map((k) => [k, row[k] ?? ""]));
}

export function todayLisbon(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function hourLisbon(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", hour12: false }).format(date)) % 24;
}

export function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function parsePrice(v) {
  if (v == null || v === "") return null;
  const m = String(v).replace(/\s/g, "").match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}

// "{{brand}} {{title}}" templates; supports {{field|upper}}, {{field|lower}}, {{field|title}}
export function renderTemplate(tpl, row) {
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+))?\s*\}\}/g, (_, f, fn) => {
    let v = row[f] == null ? "" : String(row[f]);
    if (fn) v = applyCase(v, fn);
    return v;
  }).replace(/\s{2,}/g, " ").trim();
}

export function applyCase(v, mode) {
  v = String(v ?? "");
  if (mode === "upper") return v.toUpperCase();
  if (mode === "lower") return v.toLowerCase();
  if (mode === "title") return v.toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
  if (mode === "sentence") { const s = v.toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
  return v;
}

export async function fetchCsv(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "FeedForge/1.0", "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`Falha ao descarregar o feed (${res.status} ${res.statusText})`);
  const text = await res.text();
  return parseCsv(text);
}

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const out = Papa.parse(text, { header: true, skipEmptyLines: "greedy", delimitersToGuess: [",", ";", "\t", "|"], transformHeader: (h) => h.trim() });
  const headers = (out.meta.fields || []).filter(Boolean);
  const rows = out.data.map((r) => {
    const o = {};
    for (const h of headers) o[h] = r[h] == null ? "" : String(r[h]);
    return o;
  });
  const fatal = out.errors.filter((e) => e.type === "Delimiter");
  if (!headers.length || fatal.length) throw new Error("Não foi possível interpretar o CSV (headers em falta)");
  return { headers, rows, warnings: out.errors.slice(0, 20).map((e) => `linha ${e.row}: ${e.message}`) };
}

export function toCsv(headers, rows) {
  return Papa.unparse({ fields: headers, data: rows.map((r) => headers.map((h) => r[h] ?? "")) });
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
