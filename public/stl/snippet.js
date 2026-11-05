/* hôma · Shop the Look — export helpers (FeedForge editor + tests).
   hstlSnippet: embed code for an SFCC Page Designer HTML/Custom block.
   hstlValidate: checks run before export. */
(function (g) {
  "use strict";
  const safeJson = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

  // config = hydrated config (products already carry name/price/image/url from the feed)
  function hstlSnippet({ css, js, config, name = "", includeAssets = true }) {
    const id = String(config.id || "stl");
    const clean = { ...config, products: (config.products || []).filter((p) => !p.missing) };
    const head = `<!-- hôma · Shop the Look · ${String(name || id).replace(/--/g, "-")} · gerado pelo FeedForge em ${new Date().toISOString().slice(0, 16).replace("T", " ")} -->`;
    const assets = includeAssets
      ? `\n<!-- CSS + JS do widget: basta uma vez por página (se houver vários Shop the Look na mesma página, os seguintes podem ficar só com a <section> e o JSON) -->\n<style>\n${css.trim()}\n</style>\n<script>\n${js.trim()}\n</script>`
      : "";
    return `${head}${assets}
<section class="hstl" data-stl-id="${id.replace(/"/g, "")}" aria-label="Shop the Look"></section>
<script type="application/json" data-stl-config="${id.replace(/"/g, "")}">${safeJson(clean)}</script>
<script>window.HomaShopTheLook && window.HomaShopTheLook.autoMount();</script>
`;
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
    return { ok: errors.length === 0, errors, warnings };
  }

  g.hstlSnippet = hstlSnippet;
  g.hstlValidate = hstlValidate;
})(typeof window !== "undefined" ? window : globalThis);
