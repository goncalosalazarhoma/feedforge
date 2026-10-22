// Meta catalog -> Google Merchant Center conversion.
import { META_TO_GMC, GMC_ATTRIBUTES, META_ONLY } from "./defaults.mjs";
import { renderTemplate } from "./util.mjs";

export const TRANSFORMS = ["copy", "availability", "condition", "age_group", "gender", "list", "template", "constant", "identifier_exists", "price"];

const AVAILABILITY = {
  "in stock": "in_stock", in_stock: "in_stock", available: "in_stock",
  "out of stock": "out_of_stock", out_of_stock: "out_of_stock", discontinued: "out_of_stock", "available for order": "backorder",
  backorder: "backorder", preorder: "preorder", "pre-order": "preorder",
};
const CONDITION = { new: "new", refurbished: "refurbished", used: "used", used_like_new: "used", used_good: "used", used_fair: "used", "cpo": "refurbished", open_box_new: "new" };
const AGE = { adult: "adult", "all ages": "adult", teen: "adult", kids: "kids", toddler: "toddler", infant: "infant", newborn: "newborn" };
const GENDER = { female: "female", male: "male", unisex: "unisex", women: "female", men: "male" };

export function autoMapping(metaHeaders) {
  const mapping = [];
  for (const h of metaHeaders) {
    if (META_ONLY.has(h)) continue;
    if (META_TO_GMC[h]) mapping.push({ target: META_TO_GMC[h].target, source: h, transform: META_TO_GMC[h].transform });
    else if (GMC_ATTRIBUTES.has(h)) mapping.push({ target: h, source: h, transform: h === "price" || h === "sale_price" ? "price" : "copy" });
  }
  if (!metaHeaders.includes("identifier_exists")) mapping.push({ target: "identifier_exists", source: "", transform: "identifier_exists" });
  return mapping;
}

function lookup(map, v) {
  const k = String(v ?? "").trim().toLowerCase();
  return map[k] ?? (k ? k : "");
}

function fmtPrice(v, currency) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/(-?\d+(?:[.,]\d+)?)\s*([A-Z]{3})?/);
  if (!m) return s;
  return `${Number(m[1].replace(",", ".")).toFixed(2)} ${m[2] || currency}`;
}

export function convertRow(row, mapping, { currency = "EUR" } = {}) {
  const out = {};
  for (const m of mapping) {
    if (!m.target) continue;
    const v = m.source ? row[m.source] : "";
    switch (m.transform) {
      case "availability": out[m.target] = lookup(AVAILABILITY, v); break;
      case "condition": out[m.target] = lookup(CONDITION, v) || "new"; break;
      case "age_group": out[m.target] = lookup(AGE, v); break;
      case "gender": out[m.target] = lookup(GENDER, v); break;
      case "list": out[m.target] = String(v ?? "").split(/[,|;]\s*/).filter(Boolean).slice(0, 10).join(","); break;
      case "template": out[m.target] = renderTemplate(m.value || "", row); break;
      case "constant": out[m.target] = m.value ?? ""; break;
      case "price": out[m.target] = fmtPrice(v, currency); break;
      case "identifier_exists": {
        const has = String(row.gtin ?? "").trim() || (String(row.mpn ?? "").trim() && String(row.brand ?? "").trim());
        out[m.target] = has ? "yes" : "no";
        break;
      }
      default: out[m.target] = v ?? "";
    }
  }
  return out;
}

export function gmcHeaders(mapping) {
  return [...new Set(mapping.filter((m) => m.target).map((m) => m.target))];
}
