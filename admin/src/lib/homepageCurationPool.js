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

function normalizeTaxonomySelection(value) {
  return (Array.isArray(value) ? value : []).map((key) => String(key || "").trim()).filter(Boolean);
}

// taxonomy_true only travels with place searches, and only when the user can actually see and
// remove the selection — an invisible filter silently shrinking results is a bug, not a filter.
export function buildPoolCandidateParams({ entityType, lang, q, limit = 20, taxonomyTrue = [] } = {}) {
  const normalizedType = String(entityType || "").trim().toLowerCase();
  const selected = normalizedType === "place" ? normalizeTaxonomySelection(taxonomyTrue) : [];

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
    taxonomy_true: normalizedType === "place" ? normalizeTaxonomySelection(poolState?.taxonomy_true) : [],
    items: [],
    error: "",
  };
}

export function removePoolTaxonomyKey(poolState, key) {
  return {
    ...poolState,
    taxonomy_true: normalizeTaxonomySelection(poolState?.taxonomy_true).filter((entry) => entry !== key),
    items: [],
    error: "",
  };
}

// When the catalog fails to load there is no UI left to render the chips, so the selection must go
// with it — otherwise the next search is filtered by keys the user can neither see nor clear.
export function clearPoolTaxonomySelection(poolState) {
  return {
    ...poolState,
    taxonomy_true: [],
    items: [],
  };
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
