import {
  getTaxonomyBaseDefinition,
  getTaxonomyCatalogEntriesForItem,
  getTaxonomyCatalogEntryMapForItem,
  isKnownTaxonomyCatalogKey,
  normalizeTaxonomyCatalogSuggestedValue,
} from "./taxonomy-catalog.mjs";

// §7A: taxonomy.category / taxonomy.subtype / taxonomy.tags are reserved metadata keys owned by Clean,
// not editable Curation questions. They must never be resolved into a Work Return row.
const RESERVED_TAXONOMY_CHECK_KEYS = Object.freeze(["category", "subtype", "tags"]);

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isReservedTaxonomyCheckKey(value) {
  return RESERVED_TAXONOMY_CHECK_KEYS.includes(normalizeKey(value));
}

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function hasTaxonomyCatalogForItem(item = {}) {
  return getTaxonomyCatalogEntriesForItem(item).length > 0;
}

export function getTaxonomyCheckLabel(checkKey = "") {
  return getTaxonomyBaseDefinition(checkKey)?.label || "";
}

// What the AI is allowed to activate and with what shape. §7A lets AI switch on approved
// agent-triggered catalog keys and suggest values, but never invent keys or override the schema, so
// the prompt gets the catalog itself rather than an open field.
export function getTaxonomyCatalogPromptChecks(item = {}) {
  return getTaxonomyCatalogEntriesForItem(item).map((entry) => ({
    taxonomy_key: entry.taxonomy_key,
    label: entry.label,
    instruction: entry.instruction,
    answer_type: entry.answer_type,
    activation_mode: entry.activation_mode,
    allowed_values: entry.allowed_values,
    unit_options: entry.unit_options,
  }));
}

// The AI's raw ai_taxonomy_json, reduced to what the catalog actually permits for THIS item: unknown
// keys, keys that do not apply to the item's category, reserved keys, and values that violate the
// key's answer contract are all dropped rather than trusted.
export function normalizeAiTaxonomySuggestions(rawAiTaxonomy = null, item = {}) {
  const raw = rawAiTaxonomy && typeof rawAiTaxonomy === "object" && !Array.isArray(rawAiTaxonomy)
    ? rawAiTaxonomy
    : {};
  const catalogMap = getTaxonomyCatalogEntryMapForItem(item);
  if (!catalogMap.size) return [];
  const rows = Array.isArray(raw.suggested_checks) ? raw.suggested_checks : [];
  const seen = new Set();
  const suggestions = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const taxonomyKey = normalizeKey(row.taxonomy_key);
    if (!taxonomyKey || seen.has(taxonomyKey)) continue;
    if (isReservedTaxonomyCheckKey(taxonomyKey) || !isKnownTaxonomyCatalogKey(taxonomyKey)) continue;
    const entry = catalogMap.get(taxonomyKey);
    if (!entry) continue;
    const suggestedValue = Object.prototype.hasOwnProperty.call(row, "suggested_value")
      ? normalizeTaxonomyCatalogSuggestedValue(entry, row.suggested_value)
      : null;
    const conditionNote = row.condition_note == null
      ? null
      : String(row.condition_note || "").trim() || null;
    // A row that activates a key but carries neither a value nor a condition note tells the field
    // worker nothing; it is noise, not a suggestion.
    if (suggestedValue == null && !conditionNote) continue;
    // "AI thinks this one is a no" is not a suggestion either: an unticked check already says ไม่มี, so
    // the row would arrive looking AI-assisted while showing the worker nothing. Only a qualifier note
    // ("ไม่มีที่จอด แต่จอดข้างทางได้") carries information worth surfacing.
    if (isYesNoAnswerType(entry.answer_type) && suggestedValue === false && !conditionNote) continue;
    seen.add(taxonomyKey);
    suggestions.push({
      taxonomy_key: taxonomyKey,
      ...(suggestedValue == null ? {} : { suggested_value: cloneValue(suggestedValue) }),
      ...(conditionNote == null ? {} : { condition_note: conditionNote }),
    });
  }
  return suggestions;
}

function findAiTaxonomySuggestion(aiTaxonomy = null, taxonomyKey = "") {
  const rows = Array.isArray(aiTaxonomy?.suggested_checks) ? aiTaxonomy.suggested_checks : [];
  const key = normalizeKey(taxonomyKey);
  return rows.find((row) => normalizeKey(row?.taxonomy_key) === key) || null;
}

function isYesNoAnswerType(answerType) {
  const normalized = normalizeKey(answerType);
  return normalized === "boolean" || normalized === "boolean_with_conditions";
}

function suggestionConditionNote(aiSuggestion) {
  return aiSuggestion?.condition_note == null
    ? null
    : String(aiSuggestion.condition_note || "").trim() || null;
}

// Whether a suggestion actually has something to say to the field worker. This is the last gate before
// the snapshot, so it re-checks rather than trusting whatever ended up in ai_taxonomy_json.
//
// On a yes/no check, "no" says nothing: the row starts unticked and not ticking IS the ไม่มี answer, so
// a bare `suggested_value: false` would only paint an "AI แนะนำ" badge on a row showing nothing. A
// qualifier note does say something ("ไม่มีที่จอด แต่จอดข้างทางได้"), and so does a plain "yes" — even
// with nothing to prefill, the badge tells the worker the AI already looked.
function isActionableSuggestion(entry, aiSuggestion) {
  if (!aiSuggestion) return false;
  if (suggestionConditionNote(aiSuggestion)) return true;
  const value = Object.prototype.hasOwnProperty.call(aiSuggestion, "suggested_value")
    ? normalizeTaxonomyCatalogSuggestedValue(entry, aiSuggestion.suggested_value)
    : null;
  if (isYesNoAnswerType(entry.answer_type)) return value === true;
  return value != null;
}

// What actually gets prefilled into the worker's input.
//
// A yes/no check is answered by the tick alone, and its input holds the qualifier text ("เฉพาะในร้าน"),
// so an AI `suggested_value: true` has nothing to put in the box — its condition note does. Every other
// answer type (select, multi_select, number_with_unit) prefills its value directly.
function resolveSuggestedValueForCheck(entry, aiSuggestion) {
  if (!aiSuggestion) return null;
  if (isYesNoAnswerType(entry.answer_type)) return suggestionConditionNote(aiSuggestion);
  return Object.prototype.hasOwnProperty.call(aiSuggestion, "suggested_value")
    ? normalizeTaxonomyCatalogSuggestedValue(entry, aiSuggestion.suggested_value)
    : null;
}

// A catalog key that is `required` for the item's category is always asked. An `agent_triggered` key is
// asked only when someone switched it on: the curator explicitly (a stored row), or the AI by
// suggesting something for it (§7A: "AI may activate approved Agent-triggered catalog keys").
function resolveRequestedFlag(entry, savedCheck, aiSuggestion) {
  if (entry.activation_mode === "required") return true;
  if (savedCheck) return savedCheck.requested === true;
  return Boolean(aiSuggestion);
}

// Curator-authored taxonomy rows the catalog does not know about. §7A forbids deleting legacy stored
// data, and the ban on carrying legacy rows into new snapshots is scoped to the `custom` group, not to
// taxonomy — so a hand-written taxonomy check keeps reaching the field worker exactly as before the
// catalog existed. (Reserved keys stay out: they are Clean-owned metadata, never Curation questions.)
function preserveLegacyTaxonomyChecks(existingGroup, catalogKeys) {
  return (Array.isArray(existingGroup?.checks) ? existingGroup.checks : [])
    .filter((check) => {
      const key = normalizeKey(check?.key);
      return key && !catalogKeys.has(key) && !isReservedTaxonomyCheckKey(key);
    })
    .map((check) => ({ ...cloneValue(check), key: normalizeKey(check.key) }));
}

// Builds the resolved taxonomy checklist for one item, from the catalog rather than from whatever the
// field pack happens to have stored. Stored requested_checks_json only supplies the curator's
// requested/rejected decision per catalog key; the catalog owns labels, instructions, answer types,
// allowed values and applicability, so a category change or a catalog fix flows into the next handoff
// instead of being frozen into a field pack forever.
//
// Returns null when there is nothing to ask at all — neither a catalog for this item's type/category
// nor a legacy row. §7A: with no resolved taxonomy checks, the Work Return Curation section stays hidden.
export function resolveTaxonomyRequestedChecksGroup({
  existingGroup = null,
  item = {},
  aiTaxonomy = null,
} = {}) {
  const entries = getTaxonomyCatalogEntriesForItem(item);
  const catalogKeys = new Set(entries.map((entry) => entry.taxonomy_key));
  const legacyChecks = preserveLegacyTaxonomyChecks(existingGroup, catalogKeys);
  if (!entries.length) {
    // No catalog for this item (a non-place item, or a category the catalog does not cover). Hand back
    // whatever the curator wrote by hand, unchanged, rather than resolving anything.
    return legacyChecks.length
      ? {
        group_key: "taxonomy",
        group_label: String(existingGroup?.group_label || "").trim() || "Curation",
        checks: legacyChecks,
      }
      : null;
  }

  const savedChecks = new Map(
    (Array.isArray(existingGroup?.checks) ? existingGroup.checks : [])
      .map((check) => [normalizeKey(check?.key), check])
      .filter(([key]) => key && !isReservedTaxonomyCheckKey(key))
  );

  const checks = entries.map((entry) => {
    const savedCheck = savedChecks.get(entry.taxonomy_key) || null;
    const rawSuggestion = findAiTaxonomySuggestion(aiTaxonomy, entry.taxonomy_key);
    // Suggestions come from this run's ai_taxonomy_json only, never from the stored requested check.
    // §7A: suggestions are a snapshot of the latest generation run, not an accumulator — a value the
    // approved context no longer supports has to be able to disappear.
    const aiSuggestion = isActionableSuggestion(entry, rawSuggestion) ? rawSuggestion : null;
    const suggestedValue = resolveSuggestedValueForCheck(entry, aiSuggestion);
    return {
      key: entry.taxonomy_key,
      requested: resolveRequestedFlag(entry, savedCheck, aiSuggestion),
      label: entry.label,
      instruction: entry.instruction,
      answer_type: entry.answer_type,
      activation_mode: entry.activation_mode,
      required: entry.required === true,
      condition_prompt: entry.condition_prompt || null,
      evidence_required: entry.evidence_required === true,
      allowed_values: Array.isArray(entry.allowed_values) ? cloneValue(entry.allowed_values) : null,
      unit_options: Array.isArray(entry.unit_options) ? cloneValue(entry.unit_options) : null,
      suggested_value: suggestedValue,
      // The badge, not the value, is what tells the worker the AI thinks this one is a yes — a yes/no
      // check the AI activated with no qualifier has nothing to prefill but still deserves the hint.
      source: aiSuggestion
        ? { kind: "ai", confidence: normalizeKey(aiTaxonomy?.confidence) || "unknown", note: null }
        : null,
    };
  });

  return {
    group_key: "taxonomy",
    group_label: String(existingGroup?.group_label || "").trim() || "Curation",
    checks: [...checks, ...legacyChecks],
  };
}
