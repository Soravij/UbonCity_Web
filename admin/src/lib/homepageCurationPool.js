// Pure Content Pool helpers extracted from HomepageCuration.jsx so the request/state contract can be
// tested without a React DOM harness. No React, no network, no side effects.

export const HERO_BLOCK_KEY = "hero";
export const EVENT_BLOCK_KEY = "featured_events";

export function isHeroBlock(block) {
  return String(block?.key || "").trim().toLowerCase() === HERO_BLOCK_KEY;
}

export function isEventBlock(block) {
  return String(block?.key || "").trim().toLowerCase() === EVENT_BLOCK_KEY;
}

export function canUseCandidateInBlock(block, entityType) {
  if (!block || isHeroBlock(block) || !block.enabled) return false;
  if (String(entityType || "").trim().toLowerCase() === "event") {
    return isEventBlock(block);
  }
  return !isEventBlock(block);
}

export const TAXONOMY_LOOKUP_SLOT_COUNT = 3;

export function createTaxonomyLookupSlots(value = []) {
  const slots = Array.from({ length: TAXONOMY_LOOKUP_SLOT_COUNT }, (_, index) => String(value?.[index] || "").trim());
  return slots.map((key, index) => (key && slots.indexOf(key) !== index ? "" : key));
}

export function selectedTaxonomyLookupKeys(value = []) {
  return Array.from(new Set(createTaxonomyLookupSlots(value).filter(Boolean)));
}

export function updateTaxonomyLookupSlot(slots, index, value) {
  const next = createTaxonomyLookupSlots(slots);
  const key = String(value || "").trim();
  if (key && next.some((entry, entryIndex) => entryIndex !== index && entry === key)) return next;
  next[index] = key;
  return next;
}

// taxonomy_true only travels with place searches, and only when the user can actually see and
// remove the selection — an invisible filter silently shrinking results is a bug, not a filter.
export function buildPoolCandidateParams({ entityType, lang, q, limit = 20, taxonomyTrue = [] } = {}) {
  const normalizedType = String(entityType || "").trim().toLowerCase();
  const selected = normalizedType === "place" ? selectedTaxonomyLookupKeys(taxonomyTrue) : [];

  return {
    entity_type: entityType,
    lang,
    q,
    limit,
    ...(selected.length ? { taxonomy_true: selected.join(",") } : {}),
  };
}

export function applyPoolEntityTypeChange(poolState, nextEntityType) {
  const normalizedType = String(nextEntityType || "").trim().toLowerCase();
  return {
    ...poolState,
    entity_type: nextEntityType,
    taxonomy_true: normalizedType === "place" ? createTaxonomyLookupSlots(poolState?.taxonomy_true) : createTaxonomyLookupSlots(),
    items: [],
    error: "",
  };
}

export function clearPoolTaxonomySelection(poolState) {
  return {
    ...poolState,
    taxonomy_true: createTaxonomyLookupSlots(),
    items: [],
    error: "",
  };
}

export function candidateSelectionKey(candidate) {
  return `${String(candidate?.entity_type || "").trim().toLowerCase()}:${Number(candidate?.id || 0) || 0}`;
}

export function toggleCandidateSelection(selectedKeys, candidate) {
  const key = candidateSelectionKey(candidate);
  if (key.endsWith(":0")) return Array.from(selectedKeys || []);
  const next = new Set(selectedKeys || []);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return Array.from(next);
}

export function selectCurrentCandidateRows(items, selected) {
  const rows = Array.isArray(items) ? items : [];
  const keys = rows.map(candidateSelectionKey).filter((key) => !key.endsWith(":0"));
  const current = new Set(selected || []);
  const allSelected = keys.length > 0 && keys.every((key) => current.has(key));
  if (allSelected) keys.forEach((key) => current.delete(key));
  else keys.forEach((key) => current.add(key));
  return Array.from(current);
}

export function addCandidateToBlocks(blocks, poolTargetBlockKey, candidate) {
  const targetBlockKey = String(poolTargetBlockKey || "").trim().toLowerCase();
  const current = Array.isArray(blocks) ? blocks : [];
  if (!targetBlockKey) return current;

  return current.map((block) => {
    if (String(block?.key || "").trim().toLowerCase() !== targetBlockKey) return block;
    if (!canUseCandidateInBlock(block, candidate?.entity_type)) return block;

    const candidateId = Number(candidate?.id || 0) || null;
    if (!candidateId) return block;

    const candidateType = String(candidate?.entity_type || "").trim().toLowerCase();
    const dup = (Array.isArray(block.manual_items) ? block.manual_items : []).some(
      (item) => Number(item?.entity_id || 0) === candidateId && String(item?.entity_type || "").trim().toLowerCase() === candidateType
    );
    if (dup) return block;

    return {
      ...block,
      manual_items: [
        ...(Array.isArray(block.manual_items) ? block.manual_items : []),
        {
          entity_type: candidateType,
          entity_id: String(candidateId),
          category: String(candidate?.category || "").trim(),
          slug: String(candidate?.slug || "").trim(),
          label: String(candidate?.title || "").trim(),
          note: "",
        },
      ],
    };
  });
}

export function addCandidatesToBlocks(blocks, poolTargetBlockKey, candidates) {
  return (Array.isArray(candidates) ? candidates : []).reduce(
    (nextBlocks, candidate) => addCandidateToBlocks(nextBlocks, poolTargetBlockKey, candidate),
    Array.isArray(blocks) ? blocks : []
  );
}
