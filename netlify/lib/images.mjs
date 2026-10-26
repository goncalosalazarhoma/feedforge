// Image evaluator: quantity (from Akeneo asset codes) + quality (resolution/format/weight from the public image URLs in the feed).

// --- read width/height from the first bytes of an image (JPEG, PNG, WebP, GIF) ---
export function imageSize(buf) {
  const b = buf;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), format: "png" };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), format: "gif" };
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const t = b.toString("ascii", 12, 16);
    if (t === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, format: "webp" };
    if (t === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, format: "webp" }; }
    if (t === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), format: "webp" };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), format: "jpeg" };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

export async function probe(url, { maxBytes = 262144, timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { range: `bytes=0-${maxBytes - 1}`, "user-agent": "FeedForge/1.0" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok && res.status !== 206) return { url, error: `HTTP ${res.status}` };
    const total = Number((res.headers.get("content-range") || "").split("/")[1]) || Number(res.headers.get("content-length")) || null;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    while (got < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
    try { await reader.cancel(); } catch {}
    const size = imageSize(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return { url, ...(size || { error: "formato desconhecido" }), kb: total ? Math.round(total / 1024) : null, type: res.headers.get("content-type") };
  } catch (e) {
    return { url, error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

// Akeneo asset codes appear in two naming schemes for the same photos (e.g. "16720_raspador_01" and "016720_1").
// Effective count = the largest of the schemes, not the sum.
export function assetCount(value, sku) {
  const codes = String(value || "").split(",").map((c) => c.trim()).filter(Boolean);
  const bySku = codes.filter((c) => new RegExp(`^0*${String(sku).replace(/^0+/, "")}(_\\d+)?$`).test(c));
  const descriptive = codes.filter((c) => !bySku.includes(c));
  return { raw: codes.length, effective: Math.max(bySku.length, descriptive.length), duplicated: bySku.length > 0 && descriptive.length > 0 };
}

export function scoreImages({ product, ambiance, probes }) {
  const issues = [];
  const n = product.effective;
  let score = [0, 15, 30, 40, 50][Math.min(n, 4)];
  if (n === 0) issues.push("Sem imagens de produto");
  else if (n < 3) issues.push(`Só ${n} imagem${n > 1 ? "s" : ""} de produto (recomendado ≥ 3)`);
  if (product.duplicated) issues.push(`Códigos duplicados: ${product.raw} códigos para ~${n} fotos`);
  if (ambiance.effective > 0) score += 15; else issues.push("Sem imagem de ambiente");
  const ok = probes.filter((p) => p.w && p.h);
  const main = ok[0];
  if (main) {
    const side = Math.min(main.w, main.h);
    score += side >= 1200 ? 25 : side >= 1000 ? 20 : side >= 800 ? 12 : 0;
    if (side < 800) issues.push(`Resolução baixa (${main.w}x${main.h}; recomendado ≥ 1000 px)`);
    else if (side < 1000) issues.push(`Resolução média (${main.w}x${main.h})`);
    const ratio = main.w / main.h;
    if (ratio > 0.9 && ratio < 1.12) score += 10; else issues.push(`Imagem principal não quadrada (${main.w}x${main.h})`);
    const heavy = ok.filter((p) => p.kb && p.kb > 1500);
    if (heavy.length) issues.push(`${heavy.length} imagem(ns) pesada(s) > 1,5 MB`);
    const small = ok.filter((p) => Math.min(p.w, p.h) < 500);
    if (small.length) issues.push(`${small.length} imagem(ns) adicional(is) abaixo de 500 px`);
  }
  const broken = probes.filter((p) => p.error);
  if (broken.length) issues.push(`${broken.length} link(s) de imagem com erro (${broken[0].error})`);
  return { score: main ? Math.min(100, score) : null, quantityScore: score, issues };
}
