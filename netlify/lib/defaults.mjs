// Default feed configuration + Meta/GMC field knowledge.

export const LABEL_FIELDS = ["custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"];

// Fields that only ever pass through from the source (never touched by rules / AI / edits).
export const DEFAULT_LOCKED = [
  "id",
  "availability",
  "price",
  "sale_price",
  "sale_price_effective_date",
  "inventory",
  "quantity_to_sell_on_facebook",
  "link",
  "image_link",
  "gtin",
];

export const AI_FIELD_PRESETS = {
  title: "Título de produto otimizado para pesquisa e shopping: [Tipo de produto] + [característica principal] + [material/cor/tamanho quando existirem]. Sem promoções, sem MAIÚSCULAS, sem emojis.",
  description: "Descrição clara e factual (300–900 caracteres): o que é, materiais, dimensões, utilização e cuidados, apenas com informação presente nos dados. Sem HTML, sem promoções, sem preços.",
  product_type: "Hierarquia de categoria interna separada por ' > ' (ex.: Casa > Têxteis > Almofadas).",
  color: "Cor principal do produto, apenas se explícita nos dados; caso contrário devolve string vazia.",
  material: "Material principal, apenas se explícito nos dados; caso contrário devolve string vazia.",
};

export function defaultConfig({ id, name, language = "pt-PT" }) {
  return {
    id,
    name,
    language,                      // pt-PT | es-ES
    sourceUrl: "",
    idField: "id",
    sheetId: "",                   // Google spreadsheet ID
    sheetTabs: { meta: "meta", gmc: "gmc" },
    runHour: 6,                    // Europe/Lisbon hour for the daily run
    scheduleEnabled: true,
    minRowRatio: 0.5,              // abort if today's feed has < 50% of yesterday's rows
    lockedFields: [...DEFAULT_LOCKED],
    rules: [],                     // see rules.mjs
    quality: {
      titleMin: 25,
      titleMax: 150,
      descMin: 120,
      requireFields: ["brand", "product_type", "google_product_category"],
    },
    ai: {
      enabled: true,
      model: "claude-haiku-4-5",
      mode: "flagged",             // flagged | all  (which NEW products go to AI)
      fields: ["title", "description"],
      fieldInstructions: { ...AI_FIELD_PRESETS },
      brandVoice: "hôma é uma marca portuguesa de casa e decoração: tom próximo, acolhedor e prático. Escreve sempre na língua do feed.",
      maxPerRun: 300,
      reoptimizeOnSourceChange: false,
    },
    gmc: {
      enabled: true,
      mapping: null,               // null = automatic (see gmc.mjs autoMapping)
      currency: "EUR",
    },
    createdAt: new Date().toISOString(),
  };
}

// Meta column -> GMC column (only where names differ or need transforms)
export const META_TO_GMC = {
  availability: { target: "availability", transform: "availability" },
  condition: { target: "condition", transform: "condition" },
  age_group: { target: "age_group", transform: "age_group" },
  gender: { target: "gender", transform: "gender" },
  additional_image_link: { target: "additional_image_link", transform: "list" },
};

// Columns GMC understands (copied as-is when present in the Meta feed)
export const GMC_ATTRIBUTES = new Set([
  "id", "title", "description", "link", "mobile_link", "image_link", "additional_image_link",
  "availability", "availability_date", "price", "sale_price", "sale_price_effective_date",
  "brand", "gtin", "mpn", "identifier_exists", "condition", "google_product_category",
  "product_type", "item_group_id", "color", "size", "size_type", "size_system", "material",
  "pattern", "gender", "age_group", "shipping", "shipping_weight", "shipping_label",
  "product_length", "product_width", "product_height", "product_weight",
  "product_highlight", "product_detail", "multipack", "is_bundle", "adult",
  "unit_pricing_measure", "unit_pricing_base_measure", "energy_efficiency_class",
  "excluded_destination", "included_destination", "ads_redirect", "lifestyle_image_link",
  "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4",
  "promotion_id", "tax", "expiration_date", "cost_of_goods_sold",
]);

// Meta-only columns that are dropped on the GMC side
export const META_ONLY = new Set([
  "fb_product_category", "quantity_to_sell_on_facebook", "inventory", "rich_text_description",
  "status", "visibility", "video", "short_description", "origin_country", "importer_name",
  "importer_address", "manufacturer_info", "return_policy_info", "applink", "commerce_tax_category",
  "marked_for_product_launch", "unit_price", "wa_compliance_category", "internal_label",
]);
