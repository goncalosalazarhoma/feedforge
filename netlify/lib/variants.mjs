// Akeneo product models: hierarchy (root model → sub-model → product) and attribute ownership.
// An attribute can only be edited on the level that owns it (family variant); variant axes are never editable.
import { FAMILY_VARIANTS } from "./akeneo-family-variants.mjs";

export const isModelRow = (r) => !!r && (r._model || r.entity_type === "product_model");

// Normalise uploaded rows: product models get their `code` as key (stored in `sku`) and `_model`;
// parents referenced but missing from the file become virtual model rows (so edits can be routed to them).
export function normaliseRows(rows) {
  const out = [];
  const keys = new Set();
  for (const r of rows) {
    if (r.entity_type === "product_model" || (!r.sku && r.code)) {
      if (!r.code) continue;
      out.push({ ...r, sku: r.code, _model: "1" });
    } else if (r.sku) out.push(r);
    else continue;
    keys.add(out[out.length - 1].sku);
  }
  for (const r of [...out]) {
    if (r.parent && !keys.has(r.parent)) {
      keys.add(r.parent);
      out.push({ sku: r.parent, code: r.parent, entity_type: "product_model", _model: "1", _virtual: "1", ...(r.family ? { family: r.family } : {}) });
    }
  }
  return out;
}

export function buildHierarchy(rows, dict = {}) {
  const fvs = { ...FAMILY_VARIANTS, ...(dict.familyVariants || {}) };
  const byKey = new Map(rows.map((r) => [r.sku, r]));
  const children = new Map();
  for (const r of rows) if (r.parent) { if (!children.has(r.parent)) children.set(r.parent, []); children.get(r.parent).push(r); }
  const hasModels = rows.some((r) => isModelRow(r) || r.parent);

  const chainMemo = new Map();
  const chainOf = (r) => {
    if (chainMemo.has(r.sku)) return chainMemo.get(r.sku);
    const c = [r];
    const seen = new Set([r.sku]);
    let p = r.parent;
    while (p && !seen.has(p)) { seen.add(p); const pr = byKey.get(p) || { sku: p, _model: "1", _virtual: "1" }; c.unshift(pr); p = pr.parent; }
    chainMemo.set(r.sku, c);
    return c;
  };
  // a product below this model (to know the full depth)
  const leafOf = (r) => {
    let cur = r;
    for (let i = 0; i < 5 && isModelRow(cur); i++) { const k = children.get(cur.sku); if (!k?.length) return null; cur = k.find((x) => !isModelRow(x)) || k[0]; }
    return isModelRow(cur) ? null : cur;
  };
  const famOf = (chain, leaf) => [...chain, leaf].filter(Boolean).map((x) => x.family).find(Boolean) || null;
  const fvOf = (chain, leaf) => [...chain, leaf].filter(Boolean).map((x) => x.family_variant).find(Boolean);

  const variantMemo = new Map();
  // returns { variant, chain (top→product), candidates }
  const contextOf = (r) => {
    const leaf = isModelRow(r) ? leafOf(r) : r;
    const chain = leaf ? chainOf(leaf) : chainOf(r);
    const key = chain[chain.length - 1].sku;
    if (variantMemo.has(key)) return variantMemo.get(key);
    const depth = chain.length - 1; // levels below the top of the known chain
    const rootKnown = !chain[0]._virtual && !chain[0].parent; // top of the chain really is the root model
    const fits = (v) => (rootKnown ? v.levels.length === depth : v.levels.length >= depth);
    const code = fvOf(chain, leaf);
    let variant = code && fvs[code] ? fvs[code] : null;
    let candidates = [];
    if (!variant) {
      const fam = famOf(chain, leaf);
      candidates = Object.values(fvs).filter((v) => (!fam || v.family === fam) && fits(v));
      if (!candidates.length && fam) candidates = Object.values(fvs).filter(fits);
      if (fam && candidates.length === 1) variant = candidates[0];
    }
    const ctx = { variant, chain, candidates, depth, leaf: !!leaf };
    variantMemo.set(key, ctx);
    return ctx;
  };

  // distance from the product (0 = product, 1 = parent, …) of the level owning attr, for one variant
  const levelIn = (v, attr) => { const i = v.levels.findIndex((l) => l.attributes.includes(attr)); return v.levels.length - (i < 0 ? 0 : i + 1); };

  // { key, code, known } of the row that owns attr for row r
  function ownerOf(r, attr) {
    if (!r || attr === "sku" || attr === "categories") return { key: r?.sku, known: true };
    if (!r.parent && !isModelRow(r)) return { key: r.sku, known: true }; // simple product
    const { variant, chain, candidates, depth } = contextOf(r);
    let pos = null, known = true;
    if (variant) pos = levelIn(variant, attr);
    else if (candidates.length) {
      const ps = [...new Set(candidates.map((v) => levelIn(v, attr)))];
      if (ps.length === 1) pos = ps[0]; else known = false;
    } else known = false;
    if (pos == null) {
      // last resort: inherited values are identical to the parent's → owner is the highest ancestor with the same value
      // (no evidence at all → unknown owner: the field is locked rather than risk an edit Akeneo would reject)
      known = false;
      const myChain = chainOf(r);
      const cols = (x) => Object.keys(x).filter((col) => col.split("-")[0] === attr && x[col]);
      const mine = cols(r);
      const parent = myChain[myChain.length - 2];
      if (!mine.length || !parent || parent._virtual) return { key: null, known, unknown: true };
      let owner = r;
      for (let i = myChain.length - 2; i >= 0; i--) {
        const a = myChain[i];
        if (a._virtual) break;
        if (mine.some((col) => a[col] === r[col])) owner = a; else break;
      }
      if (owner === r && !mine.some((col) => parent[col] && parent[col] !== r[col])) return { key: null, known, unknown: true };
      return { key: owner.sku, known };
    }
    const idx = chain.length - 1 - pos;
    if (idx < 0) return { key: null, known, outside: true }; // owner is above what we know (e.g. root model not in the file)
    const owner = chain[idx];
    return { key: owner?.sku, known, virtual: !!owner?._virtual };
  }

  function isAxis(r, attr) {
    if (!r || (!r.parent && !isModelRow(r))) return false;
    const { variant, candidates } = contextOf(r);
    const vs = variant ? [variant] : candidates;
    return vs.length > 0 && vs.every((v) => v.levels.some((l) => l.axes.includes(attr)));
  }

  // what this row can be edited on: owner of attr is this row and it is not an axis
  const owns = (r, attr) => ownerOf(r, attr).key === r.sku && !isAxis(r, attr);

  // facts for a model row: its own values over those of a representative product below it
  function mergedRow(r) {
    if (!isModelRow(r)) return r;
    const leaf = leafOf(r);
    const base = leaf ? Object.fromEntries(chainOf(leaf).flatMap((x) => Object.entries(x))) : {};
    return { ...base, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "" && v != null)), sku: r.sku };
  }

  // variants covered by a model (for the AI: describe the group, not one variant)
  function variantsOf(r, labelOf = (a, v) => v) {
    const out = [];
    const walk = (x) => { for (const c of children.get(x.sku) || []) { if (isModelRow(c)) walk(c); else out.push(c); } };
    walk(r);
    const { variant } = contextOf(r);
    const axes = variant ? variant.levels.flatMap((l) => l.axes) : [];
    return out.slice(0, 12).map((p) => ({ sku: p.sku, ...Object.fromEntries(axes.filter((a) => p[a] || mergedRow(p)[a]).map((a) => [a, labelOf(a, p[a] ?? mergedRow(p)[a])])) }));
  }

  const parentOf = (r) => (r.parent ? byKey.get(r.parent) : null);
  return { hasModels, byKey, children, chainOf, contextOf, ownerOf, isAxis, owns, mergedRow, variantsOf, parentOf, isModel: isModelRow };
}
