// Rules engine: ordered IF/THEN rules applied to every product.
//
// rule = {
//   id, name, enabled: true, match: "all" | "any",
//   conditions: [{ field, op, value }],         // empty = applies to all products
//   actions:    [{ type, field, value, find, replace, regex, flags, mode, length, channel, map, buckets, source }]
// }
import { renderTemplate, applyCase, parsePrice } from "./util.mjs";

export const OPS = {
  equals: (a, b) => norm(a) === norm(b),
  not_equals: (a, b) => norm(a) !== norm(b),
  contains: (a, b) => norm(a).includes(norm(b)),
  not_contains: (a, b) => !norm(a).includes(norm(b)),
  starts_with: (a, b) => norm(a).startsWith(norm(b)),
  ends_with: (a, b) => norm(a).endsWith(norm(b)),
  in: (a, b) => list(b).includes(norm(a)),
  not_in: (a, b) => !list(b).includes(norm(a)),
  regex: (a, b) => safeRegex(b, "i")?.test(String(a ?? "")) ?? false,
  empty: (a) => String(a ?? "").trim() === "",
  not_empty: (a) => String(a ?? "").trim() !== "",
  gt: (a, b) => num(a) !== null && num(a) > Number(b),
  gte: (a, b) => num(a) !== null && num(a) >= Number(b),
  lt: (a, b) => num(a) !== null && num(a) < Number(b),
  lte: (a, b) => num(a) !== null && num(a) <= Number(b),
};

// ---- scheduling -----------------------------------------------------------
// rule.schedule = { mode: "always" | "from" | "range", start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
// "always" and "from" run until the rule is removed/disabled.
export function ruleStatus(rule, today) {
  if (rule.enabled === false) return "off";
  const s = rule.schedule || { mode: "always" };
  if (s.mode === "always" || !s.mode) return "active";
  if (s.start && today < s.start) return "scheduled";
  if (s.mode === "range" && s.end && today > s.end) return "expired";
  return "active";
}

export function activeRules(rules, today) {
  return (rules || []).filter((r) => ruleStatus(r, today) === "active");
}

// Rules whose result depends on the date (re-evaluated per product each day)
const DYNAMIC = new Set(["_is_new", "_days_since_first_seen"]);
export function usesDateFields(rules) {
  return (rules || []).some((r) =>
    (r.conditions || []).some((c) => DYNAMIC.has(c.field)) ||
    (r.actions || []).some((a) => DYNAMIC.has(a.source) || /\{\{\s*_(is_new|days_since_first_seen)/.test(a.value || "")));
}

export const ACTIONS = [
  "set", "append", "prepend", "replace", "remove", "case", "truncate",
  "strip_html", "clean", "map_values", "price_bucket", "copy", "exclude",
];

function norm(v) { return String(v ?? "").trim().toLowerCase(); }
function list(v) { return String(v ?? "").split(/[,\n]/).map(norm).filter(Boolean); }
function num(v) { return parsePrice(v); }
function safeRegex(src, flags) {
  try { return new RegExp(src, flags); } catch { return null; }
}

// Virtual (read-only) fields usable in conditions and templates.
export function withVirtuals(row, meta = {}) {
  const price = parsePrice(row.price);
  const sale = parsePrice(row.sale_price);
  return {
    ...row,
    _is_new: meta.isNew ? "true" : "false",
    _days_since_first_seen: meta.daysSinceFirstSeen ?? "",
    _price: price ?? "",
    _sale_price: sale ?? "",
    _effective_price: sale && sale < (price ?? Infinity) ? sale : (price ?? ""),
    _discount_pct: price && sale && sale < price ? Math.round((1 - sale / price) * 100) : 0,
    _title_length: String(row.title ?? "").length,
    _description_length: String(row.description ?? "").length,
  };
}

export function matches(rule, row) {
  const conds = (rule.conditions || []).filter((c) => c.field && c.op && OPS[c.op]);
  if (!conds.length) return true;
  const test = (c) => OPS[c.op](row[c.field], c.value);
  return rule.match === "any" ? conds.some(test) : conds.every(test);
}

function truncateWords(s, n) {
  s = String(s ?? "");
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1);
  const i = cut.lastIndexOf(" ");
  return (i > n * 0.6 ? cut.slice(0, i) : s.slice(0, n)).replace(/[\s,;:\-–|]+$/, "");
}

function bucketFor(value, spec) {
  // spec: "0-25,25-50,50-100,100+"
  const v = parsePrice(value);
  if (v === null) return "";
  for (const raw of String(spec).split(",").map((s) => s.trim()).filter(Boolean)) {
    const plus = raw.match(/^(\d+(?:\.\d+)?)\+$/);
    if (plus && v >= Number(plus[1])) return raw;
    const m = raw.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (m && v >= Number(m[1]) && v < Number(m[2])) return raw;
  }
  return "";
}

/**
 * Apply rules to one product.
 * @returns {{ row, excluded: {meta:boolean,gmc:boolean}, applied: string[], blocked: string[] }}
 */
export function applyRules(rules, baseRow, { locked = [], meta = {} } = {}) {
  const lockedSet = new Set(locked);
  let row = { ...baseRow };
  const excluded = { meta: false, gmc: false };
  const applied = [];
  const blocked = [];

  for (const rule of rules || []) {
    if (rule.enabled === false) continue; // callers pass activeRules(); this is a safety net
    const ctx = withVirtuals(row, meta);
    if (!matches(rule, ctx)) continue;
    applied.push(rule.id);

    for (const a of rule.actions || []) {
      if (a.type === "exclude") {
        const ch = a.channel || "all";
        if (ch === "all" || ch === "meta") excluded.meta = true;
        if (ch === "all" || ch === "gmc") excluded.gmc = true;
        continue;
      }
      const f = a.field;
      if (!f) continue;
      if (lockedSet.has(f)) { blocked.push(`${rule.name || rule.id}: ${f}`); continue; }
      const cur = String(row[f] ?? "");
      const live = withVirtuals(row, meta);
      let next = cur;
      switch (a.type) {
        case "set": next = renderTemplate(a.value ?? "", live); break;
        case "copy": next = String(live[a.source] ?? ""); break;
        case "append": next = (cur + renderTemplate(a.value ?? "", live)).replace(/\s{2,}/g, " "); break;
        case "prepend": next = (renderTemplate(a.value ?? "", live) + cur).replace(/\s{2,}/g, " "); break;
        case "replace":
          if (a.regex) { const re = safeRegex(a.find ?? "", a.flags || "gi"); if (re) next = cur.replace(re, a.replace ?? ""); }
          else if (a.find) next = cur.split(a.find).join(renderTemplate(a.replace ?? "", live));
          break;
        case "remove":
          if (a.find) next = cur.split(a.find).join("").replace(/\s{2,}/g, " ").trim();
          break;
        case "case": next = applyCase(cur, a.mode || "sentence"); break;
        case "truncate": next = truncateWords(cur, Number(a.length) || 150); break;
        case "strip_html":
          next = cur.replace(/<br\s*\/?>/gi, " ").replace(/<\/(p|li|div)>/gi, ". ").replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\s*\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
          break;
        case "clean": next = cur.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim(); break;
        case "map_values": {
          const m = a.map || {};
          const hit = Object.keys(m).find((k) => norm(k) === norm(cur));
          if (hit !== undefined) next = m[hit];
          else if (a.value != null && a.value !== "") next = renderTemplate(a.value, live); // fallback
          break;
        }
        case "price_bucket": next = bucketFor(live[a.source || "_effective_price"], a.buckets || "0-25,25-50,50-100,100-250,250+"); break;
        default: break;
      }
      row[f] = next;
    }
  }
  return { row, excluded, applied, blocked };
}
