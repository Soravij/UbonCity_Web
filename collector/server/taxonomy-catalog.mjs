export const TAXONOMY_CATALOG_VERSION = "taxonomy_catalog_v1";

const CATEGORY_ALIAS_MAP = Object.freeze({
  cafe: "cafes",
  cafes: "cafes",
  coffee: "cafes",
  coffee_shop: "cafes",
  restaurant: "restaurants",
  restaurants: "restaurants",
  dining: "restaurants",
  food: "restaurants",
});

const BASE_PLACE_ENTRIES = Object.freeze([
  {
    category_key: "place",
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: "waterfront",
    label: "Waterfront",
    instruction: "Confirm whether the place has a real waterfront setting visible to visitors.",
    answer_type: "boolean_with_conditions",
    condition_prompt: "If only some zones are waterfront, describe the limitation.",
    evidence_required: false,
    required: true,
    item_types: ["place"],
    categories: [],
  },
  {
    category_key: "place",
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: "price_level",
    label: "Price level",
    instruction: "Confirm the practical price level for a normal visitor.",
    answer_type: "select",
    condition_prompt: "If price varies a lot by time or menu, note the condition.",
    evidence_required: false,
    required: true,
    item_types: ["place"],
    categories: ["cafes", "restaurants"],
  },
  {
    category_key: "place",
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: "average_price_per_person",
    label: "Average price per person",
    instruction: "Confirm the realistic average spend per person.",
    answer_type: "number_with_unit",
    condition_prompt: "If the estimate only applies to a specific menu or time, note the condition.",
    evidence_required: false,
    required: true,
    item_types: ["place"],
    categories: ["cafes", "restaurants"],
  },
  {
    category_key: "place",
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: "air_conditioning",
    label: "Air conditioning",
    instruction: "Confirm whether customer seating areas actually have air conditioning.",
    answer_type: "boolean_with_conditions",
    condition_prompt: "If only some rooms or zones have air conditioning, note the condition.",
    evidence_required: false,
    required: true,
    item_types: ["place"],
    categories: [],
  },
  {
    category_key: "place",
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: "parking",
    label: "Parking",
    instruction: "Confirm whether visitor parking is available on-site or nearby.",
    answer_type: "boolean_with_conditions",
    condition_prompt: "If parking is limited, paid, shared, or street-only, note the condition.",
    evidence_required: false,
    required: true,
    item_types: ["place"],
    categories: [],
  },
  {
    category_key: "place",
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: "outdoor_seating",
    label: "Outdoor seating",
    instruction: "Confirm whether customers can actually sit in an outdoor seating area.",
    answer_type: "boolean_with_conditions",
    condition_prompt: "If outdoor seating is seasonal or only partial, note the condition.",
    evidence_required: false,
    required: true,
    item_types: ["place"],
    categories: ["cafes", "restaurants"],
  },
  {
    category_key: "place",
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: "pet_friendly",
    label: "Pet friendly",
    instruction: "Confirm whether visitors can bring pets and under what practical limits.",
    answer_type: "boolean_with_conditions",
    condition_prompt: "If pets are allowed only in some areas or with restrictions, note the condition.",
    evidence_required: false,
    required: true,
    item_types: ["place"],
    categories: [],
  },
  {
    category_key: "place",
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: "work_power_outlets",
    label: "Work power outlets",
    instruction: "Confirm whether guests can realistically access power outlets for laptop or work use.",
    answer_type: "boolean_with_conditions",
    condition_prompt: "If outlets exist only at some seats or times, note the condition.",
    evidence_required: false,
    required: true,
    item_types: ["place"],
    categories: ["cafes"],
  },
]);

const TAXONOMY_CATALOG_KEY_SET = new Set(BASE_PLACE_ENTRIES.map((entry) => String(entry?.taxonomy_key || "").trim().toLowerCase()).filter(Boolean));

export function normalizeTaxonomyCatalogCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CATEGORY_ALIAS_MAP[normalized] || normalized || "";
}

export function getTaxonomyCatalogEntriesForItem(item = {}) {
  const itemType = String(item?.type || "").trim().toLowerCase();
  if (itemType !== "place") return [];
  const category = normalizeTaxonomyCatalogCategory(item?.category || item?.niche || "");
  return BASE_PLACE_ENTRIES
    .filter((entry) => {
      const categories = Array.isArray(entry?.categories) ? entry.categories.map(normalizeTaxonomyCatalogCategory).filter(Boolean) : [];
      return categories.length === 0 || categories.includes(category);
    })
    .map((entry) => ({ ...entry }));
}

export function getTaxonomyCatalogEntryMapForItem(item = {}) {
  return new Map(
    getTaxonomyCatalogEntriesForItem(item).map((entry) => [entry.taxonomy_key, entry])
  );
}

export function isKnownTaxonomyCatalogKey(value) {
  return TAXONOMY_CATALOG_KEY_SET.has(String(value || "").trim().toLowerCase());
}
