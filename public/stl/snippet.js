/* hôma · Shop the Look — export helpers (FeedForge editor + tests).
   hstlSnippet: embed code for an SFCC Page Designer Raw HTML component (static HTML + CSS).
   hstlValidate: checks run before export. */
(function (g) {
  "use strict";

  // html = output of renderStl (public/stl/render.mjs): static HTML + CSS, no <script> (Page Designer Raw HTML does not run JS)
  function hstlSnippet({ html, name = "" }) {
    const head = `<!-- hôma · Shop the Look · ${String(name || "").replace(/--/g, "-")} · gerado pelo FeedForge em ${new Date().toISOString().slice(0, 16).replace("T", " ")} · HTML + CSS, sem JavaScript; tracking pela tag FeedForge no GTM -->`;
    return `${head}\n${String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "")}\n`;
  }

  // module = editor state, hydrated = config returned by /api/stl/render
  function hstlValidate(module, hydrated) {
    const errors = [], warnings = [];
    if (!module.image || !module.image.src) errors.push("Falta a imagem principal.");
    const prods = (hydrated && hydrated.products) || [];
    if ((module.products || []).length < 2) errors.push("O look precisa de pelo menos 2 produtos.");
    const missing = prods.filter((p) => p.missing).map((p) => p.id);
    if (missing.length) errors.push(`Produtos que já não estão no feed: ${missing.join(", ")} — remove-os do look.`);
    const badPins = (module.products || []).filter((p) => p.pin && p.pin.show !== false && [p.pin.x, p.pin.y].some((v) => !(v >= 0 && v <= 100))).map((p) => p.id);
    if (badPins.length) errors.push(`Pins fora da imagem (0–100%): ${badPins.join(", ")}.`);
    const oos = prods.filter((p) => p.oos).map((p) => p.id);
    if (oos.length) warnings.push(`Sem stock (ficam escondidos no site): ${oos.join(", ")}.`);
    if (module.cta && module.cta.show && !module.cta.url) warnings.push("O CTA da imagem não tem link.");
    if (prods.filter((p) => !p.missing && !p.oos).length < 2 && !errors.length) warnings.push("Com os produtos sem stock escondidos, sobram menos de 2 no look.");
    if (module.layout === "moodboard") {
      const n = prods.filter((p) => !p.missing && !p.oos).length;
      if (n && n !== 4) warnings.push(`O moodboard foi desenhado para 4 produtos (2×2 no desktop, 4 numa linha no tablet); este tem ${n}${n % 2 ? ", e a grelha fica com um espaço vazio" : ""}.`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  g.hstlSnippet = hstlSnippet;
  g.hstlValidate = hstlValidate;
})(typeof window !== "undefined" ? window : globalThis);
