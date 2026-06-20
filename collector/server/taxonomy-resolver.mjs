import {
  getTaxonomyCatalogEntriesForItem,
  getTaxonomyCatalogEntryMapForItem,
  isKnownTaxonomyCatalogKey,
  isTaxonomyCatalogKeyApplicableToItem,
} from "./taxonomy-catalog.mjs";

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function hasMeaningfulValue(value) {
  if (value === false) return true;
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
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

function findAiTaxonomySuggestionRow(aiTaxonomy = {}, taxonomyKey = "") {
  const key = normalizeKey(taxonomyKey);
  const suggestedChecks = Array.isArray(aiTaxonomy?.suggested_checks) ? aiTaxonomy.suggested_checks : [];
  for (const row of suggestedChecks) {
    if (normalizeKey(row?.taxonomy_key) !== key) continue;
    return row;
  }
  if (Object.prototype.hasOwnProperty.call(aiTaxonomy || {}, key)) {
    return { taxonomy_key: key, suggested_value: aiTaxonomy[key] };
  }
  return null;
}

export function getAiTaxonomySuggestedValue(aiTaxonomy = {}, taxonomyKey = "") {
  const row = findAiTaxonomySuggestionRow(aiTaxonomy, taxonomyKey);
  if (!row) return null;
  if (Object.prototype.hasOwnProperty.call(row, "suggested_value")) {
    return row.suggested_value;
  }
  return null;
}

function hasExplicitRequestedDecision(savedCheck = {}) {
  return Object.prototype.hasOwnProperty.call(savedCheck || {}, "requested");
}

function resolveRequestedFlag(entry, savedCheck = {}, aiSuggestionRow = null) {
  if (entry.activation_mode === "required") return true;
  if (hasExplicitRequestedDecision(savedCheck)) return savedCheck.requested === true;
  if (aiSuggestionRow && Object.prototype.hasOwnProperty.call(aiSuggestionRow, "suggested_value")) return true;
  return false;
}

function buildCatalogCheck(entry, savedCheck = {}, aiTaxonomy = {}) {
  const aiSuggestionRow = findAiTaxonomySuggestionRow(aiTaxonomy, entry.taxonomy_key);
  const hasAiSuggestedValue = aiSuggestionRow && Object.prototype.hasOwnProperty.call(aiSuggestionRow, "suggested_value");
  const savedHasSuggestedValue = Object.prototype.hasOwnProperty.call(savedCheck || {}, "suggested_value");
  const suggestedValue = hasAiSuggestedValue
    ? cloneValue(aiSuggestionRow.suggested_value)
    : (savedHasSuggestedValue ? cloneValue(savedCheck.suggested_value) : null);
  const aiConfidence = normalizeKey(aiTaxonomy?.confidence) || "unknown";
  return {
    key: entry.taxonomy_key,
    requested: resolveRequestedFlag(entry, savedCheck, aiSuggestionRow),
    label: entry.label,
    instruction: entry.instruction,
    answer_type: entry.answer_type,
    activation_mode: entry.activation_mode,
    required: entry.required === true,
    categories: cloneValue(entry.categories),
    item_types: cloneValue(entry.item_types),
    condition_prompt: entry.condition_prompt || null,
    evidence_required: entry.evidence_required === true,
    allowed_values: Array.isArray(entry.allowed_values) ? cloneValue(entry.allowed_values) : null,
    unit_options: Array.isArray(entry.unit_options) ? cloneValue(entry.unit_options) : null,
    downstream_consumers: cloneValue(entry.downstream_consumers),
    suggested_value: suggestedValue,
    source: hasAiSuggestedValue
      ? { kind: "ai", confidence: aiConfidence }
      : (savedCheck.source != null ? cloneValue(savedCheck.source) : null),
  };
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
  const checks = catalogEntries.map((entry) => buildCatalogCheck(entry, savedChecks.get(entry.taxonomy_key) || {}, aiTaxonomy));
  const preservedLegacy = preserveUnknownTaxonomyChecks(existingGroup?.checks, catalogMap);
  return {
    group_key: "taxonomy",
    group_label: String(existingGroup?.group_label || "Taxonomy").trim() || "Taxonomy",
    checks: [...checks, ...preservedLegacy],
  };
}

function buildResolvedCtaGroup(existingGroup = null, item = {}, aiCtaContact = {}) {
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
      const hasAiSuggestedValue = Object.prototype.hasOwnProperty.call(aiCtaContact || {}, check.key);
      const suggestedValue = hasAiSuggestedValue
        ? cloneValue(aiCtaContact[check.key])
        : (Object.prototype.hasOwnProperty.call(saved, "suggested_value") ? cloneValue(saved.suggested_value) : null);
      return {
        key: check.key,
        requested: saved.requested === true,
        label: check.label,
        instruction: check.instruction,
        answer_type: check.answer_type,
        condition_prompt: check.condition_prompt,
        evidence_required: check.evidence_required === true,
        suggested_value: suggestedValue,
        source: hasAiSuggestedValue
          ? { kind: "ai", confidence: normalizeKey(aiCtaContact?.confidence) || "unknown" }
          : (saved.source != null ? cloneValue(saved.source) : null),
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

export function filterRequestedChecksForNewHandoff(resolvedRequestedChecks = { version: 1, groups: [] }, item = {}) {
  const groups = Array.isArray(resolvedRequestedChecks?.groups) ? resolvedRequestedChecks.groups : [];
  const filteredGroups = groups
    .flatMap((group) => {
      const groupKey = normalizeKey(group?.group_key);
      if (groupKey === "cta_contact") {
        if (!isPlaceItem(item)) return [];
        const checks = (Array.isArray(group?.checks) ? group.checks : []).filter((check) => check?.requested === true);
        return checks.length ? [{ group_key: "cta_contact", group_label: group.group_label, checks }] : [];
      }
      if (groupKey !== "taxonomy") return [];
      const checks = (Array.isArray(group?.checks) ? group.checks : []).filter((check) => {
        const key = normalizeKey(check?.key);
        return check?.requested === true
          && isKnownTaxonomyCatalogKey(key)
          && !isReservedLegacyTaxonomyKey(key)
          && isTaxonomyCatalogKeyApplicableToItem(key, item);
      });
      return checks.length ? [{ group_key: "taxonomy", group_label: group.group_label, checks }] : [];
    });
  if (!filteredGroups.length) return null;
  return {
    version: 1,
    groups: filteredGroups,
  };
}
