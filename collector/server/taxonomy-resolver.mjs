import { getTaxonomyCatalogEntriesForItem, getTaxonomyCatalogEntryMapForItem, isKnownTaxonomyCatalogKey } from "./taxonomy-catalog.mjs";

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function hasMeaningfulValue(value) {
  if (value === false) return true;
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isReservedLegacyTaxonomyKey(value) {
  const key = normalizeKey(value);
  return key === "category" || key === "subtype" || key === "tags";
}

function isPlaceItem(item = {}) {
  return normalizeKey(item?.type) === "place";
}

function defaultCtaTemplateChecks() {
  return [
    { key: "phone", label: "Phone", instruction: "Confirm the real phone number people can use now.", answer_type: "phone", condition_prompt: null, evidence_required: true },
    { key: "line_url", label: "LINE URL", instruction: "Confirm the working LINE URL if available.", answer_type: "url", condition_prompt: null, evidence_required: false },
    { key: "facebook_url", label: "Facebook URL", instruction: "Confirm the correct Facebook page URL if available.", answer_type: "url", condition_prompt: null, evidence_required: false },
    { key: "website_url", label: "Website URL", instruction: "Confirm the main website URL if available.", answer_type: "url", condition_prompt: null, evidence_required: false },
    { key: "primary_cta", label: "Primary CTA", instruction: "Confirm the best primary CTA for the user journey.", answer_type: "select", condition_prompt: null, evidence_required: false },
  ];
}

export function getAiTaxonomySuggestedValue(aiTaxonomy = {}, taxonomyKey = "") {
  const key = normalizeKey(taxonomyKey);
  const suggestedChecks = Array.isArray(aiTaxonomy?.suggested_checks) ? aiTaxonomy.suggested_checks : [];
  for (const row of suggestedChecks) {
    if (normalizeKey(row?.taxonomy_key) !== key) continue;
    if (Object.prototype.hasOwnProperty.call(row || {}, "suggested_value")) {
      return row.suggested_value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(aiTaxonomy || {}, key)) return aiTaxonomy[key];
  return null;
}

function buildCatalogCheck(entry, aiTaxonomy = {}) {
  const suggestedValue = getAiTaxonomySuggestedValue(aiTaxonomy, entry.taxonomy_key);
  return {
    key: entry.taxonomy_key,
    requested: entry.required === true,
    label: entry.label,
    instruction: entry.instruction,
    answer_type: entry.answer_type,
    suggested_value: hasMeaningfulValue(suggestedValue) ? cloneValue(suggestedValue) : (suggestedValue === false ? false : null),
    condition_prompt: entry.condition_prompt || null,
    evidence_required: entry.evidence_required === true,
    source: hasMeaningfulValue(suggestedValue) || suggestedValue === false
      ? { kind: "ai", confidence: normalizeKey(aiTaxonomy?.confidence) || "unknown" }
      : null,
  };
}

function mergeCatalogCheck(autoCheck, savedCheck = {}) {
  const next = {
    ...autoCheck,
    key: autoCheck.key,
    label: autoCheck.label,
    instruction: autoCheck.instruction,
    answer_type: autoCheck.answer_type,
    condition_prompt: autoCheck.condition_prompt,
    evidence_required: autoCheck.evidence_required === true,
    requested: true,
  };
  if (savedCheck.requested === true) next.requested = true;
  if (Object.prototype.hasOwnProperty.call(savedCheck || {}, "suggested_value")) {
    next.suggested_value = autoCheck.suggested_value == null ? cloneValue(savedCheck.suggested_value) : autoCheck.suggested_value;
  }
  if (savedCheck.source != null && autoCheck.source == null) {
    next.source = cloneValue(savedCheck.source);
  }
  return next;
}

function preserveUnknownTaxonomyChecks(existingChecks = [], catalogMap) {
  return (Array.isArray(existingChecks) ? existingChecks : [])
    .filter((check) => {
      const key = normalizeKey(check?.key);
      if (!key || catalogMap.has(key)) return false;
      if (isReservedLegacyTaxonomyKey(key)) return true;
      return !isKnownTaxonomyCatalogKey(key);
    })
    .map((check) => ({ ...cloneValue(check), key: normalizeKey(check?.key) }));
}

function buildResolvedTaxonomyGroup(existingGroup = null, item = {}, aiTaxonomy = {}) {
  const catalogEntries = getTaxonomyCatalogEntriesForItem(item);
  if (!catalogEntries.length && !Array.isArray(existingGroup?.checks)) return null;
  const catalogMap = getTaxonomyCatalogEntryMapForItem(item);
  const savedChecks = new Map(
    (Array.isArray(existingGroup?.checks) ? existingGroup.checks : [])
      .map((check) => [normalizeKey(check?.key), check])
      .filter(([key]) => key)
  );
  const checks = catalogEntries.map((entry) => {
    const autoCheck = buildCatalogCheck(entry, aiTaxonomy);
    return mergeCatalogCheck(autoCheck, savedChecks.get(entry.taxonomy_key) || {});
  });
  const preservedLegacy = preserveUnknownTaxonomyChecks(existingGroup?.checks, catalogMap);
  return {
    group_key: "taxonomy",
    group_label: String(existingGroup?.group_label || "Taxonomy").trim() || "Taxonomy",
    checks: [...checks, ...preservedLegacy],
  };
}

function buildResolvedCtaGroup(existingGroup = null, item = {}, aiCtaContact = {}) {
  if (!isPlaceItem(item) && !Array.isArray(existingGroup?.checks)) return null;
  if (!isPlaceItem(item)) return null;
  const savedChecks = new Map(
    (Array.isArray(existingGroup?.checks) ? existingGroup.checks : [])
      .map((check) => [normalizeKey(check?.key), check])
      .filter(([key]) => key)
  );
  return {
    group_key: "cta_contact",
    group_label: String(existingGroup?.group_label || "CTA/contact").trim() || "CTA/contact",
    checks: defaultCtaTemplateChecks().map((check) => {
      const saved = savedChecks.get(check.key) || {};
      const suggestedValue = Object.prototype.hasOwnProperty.call(aiCtaContact || {}, check.key)
        ? aiCtaContact[check.key]
        : null;
      return {
        key: check.key,
        requested: saved.requested === true,
        label: String(saved.label || check.label || "").trim() || check.label,
        instruction: String(saved.instruction || check.instruction || "").trim() || check.instruction,
        answer_type: String(saved.answer_type || check.answer_type || "").trim() || check.answer_type,
        suggested_value: hasMeaningfulValue(suggestedValue) ? cloneValue(suggestedValue) : null,
        condition_prompt: saved.condition_prompt == null ? check.condition_prompt : String(saved.condition_prompt || "").trim() || null,
        evidence_required: check.evidence_required === true || saved.evidence_required === true,
        source: hasMeaningfulValue(suggestedValue)
          ? { kind: "ai", confidence: normalizeKey(aiCtaContact?.confidence) || "unknown" }
          : (saved.source ?? null),
      };
    }),
  };
}

export function resolveRequestedChecksWithCatalog({
  requestedChecks = { version: 1, groups: [] },
  item = {},
  aiCtaContact = {},
  aiTaxonomy = {},
} = {}) {
  const groups = Array.isArray(requestedChecks?.groups) ? requestedChecks.groups : [];
  const groupMap = new Map(
    groups
      .map((group) => [normalizeKey(group?.group_key), group])
      .filter(([key]) => key)
  );
  const resultGroups = [];
  const ctaGroup = buildResolvedCtaGroup(groupMap.get("cta_contact") || null, item, aiCtaContact);
  if (ctaGroup && ctaGroup.checks.length > 0) resultGroups.push(ctaGroup);
  const taxonomyGroup = buildResolvedTaxonomyGroup(groupMap.get("taxonomy") || null, item, aiTaxonomy);
  if (taxonomyGroup && taxonomyGroup.checks.length > 0) resultGroups.push(taxonomyGroup);
  for (const group of groups) {
    const groupKey = normalizeKey(group?.group_key);
    if (!groupKey || groupKey === "cta_contact" || groupKey === "taxonomy") continue;
    if (!Array.isArray(group?.checks) || group.checks.length === 0) continue;
    resultGroups.push({
      ...cloneValue(group),
      group_key: groupKey,
    });
  }
  return {
    version: 1,
    groups: resultGroups,
  };
}
