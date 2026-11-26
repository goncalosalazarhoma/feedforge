// Product references printed in a flyer PDF ("Ref.: 468536", "Ref. 468536", "REF: 468536") → SKUs, with the page,
// the position on the page (same % coordinates as the hotspots) and the printed price right after the reference.
// Input: the text layer read with pdf.js, one entry per page: { page, items: [{ str, x, y }] } (x / y in % from top-left).
// Pure function (no DOM, no pdf.js), shared by the editor and the tests.

// variants after a slash replace the end of the previous number: "476347/8/9/50" = 476347, 476348, 476349, 476350;
// "467872/474546" = two full SKUs
const REF = /\bRef\.?\s*:?\s*(\d{6})((?:\s*\/\s*\d{1,6}(?!\d))*)(?!\d)/gi;
export function expandVariants(first, rest) {
  const out = [first];
  for (const part of String(rest || "").split("/").map((x) => x.trim()).filter(Boolean)) {
    const prev = out[out.length - 1];
    const sku = prev.slice(0, 6 - part.length) + part;
    if (!out.includes(sku)) out.push(sku);
  }
  return out;
}
// price printed just after the reference: "49 €", "2 ,50 €", "12,99€", "1 , 30 €/un"; never the next product's name
const PRICE = /^\s*(\d{1,4}(?:\s*,\s*\d{1,2})?)\s*€/;

const clamp = (v) => Math.round(Math.max(1, Math.min(99, Number(v) || 0)) * 100) / 100;

export function refsFromPages(pages) {
  const refs = [];
  for (const { page, items = [] } of pages || []) {
    // page text in reading order of the text layer, remembering where each item starts
    let text = "";
    const starts = [];
    for (const it of items) {
      starts.push(text.length);
      text += String(it?.str ?? "") + " ";
    }
    const itemAt = (pos) => {
      let lo = 0, hi = starts.length - 1, k = 0;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= pos) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      return items[k];
    };
    for (const m of text.matchAll(REF)) {
      const variants = expandVariants(m[1], m[2]);
      const sku = variants[0];
      const it = itemAt(m.index) || {};
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
      const pm = after.match(PRICE);
      const price = pm ? Math.round(Number(pm[1].replace(/\s+/g, "").replace(",", ".")) * 100) / 100 : null;
      refs.push({ sku, variants, page: Number(page), x: clamp(it.x), y: clamp(it.y), price: Number.isFinite(price) ? price : null });
    }
  }
  // one row per SKU (variants included) for the list (first printed price found), in flyer order
  const bySku = new Map();
  for (const r of refs) for (const sku of r.variants) {
    const cur = bySku.get(sku);
    if (!cur) bySku.set(sku, { sku, printedPrice: r.price, pages: [r.page] });
    else { if (!cur.pages.includes(r.page)) cur.pages.push(r.page); if (cur.printedPrice == null && r.price != null) cur.printedPrice = r.price; }
  }
  return { refs, skus: [...bySku.values()] };
}

// pdf.js text items → { str, x, y } in % of the page (top-left origin), handling the page's viewBox / rotation
export function itemsFromTextContent(tc, viewport) {
  return (tc?.items || []).filter((it) => it && typeof it.str === "string").map((it) => {
    const [vx, vy] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
    return { str: it.str, x: (vx / viewport.width) * 100, y: (vy / viewport.height) * 100 };
  });
}
