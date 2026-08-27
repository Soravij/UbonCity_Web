export {
  loadWorkflowBackwardTransitions,
  renderWorkflowBackwardTransitionControls,
  resolveBackwardResumePath,
} from "./workflow-backward-transitions.js";

function normalizedValue(value) {
  return String(value || "").trim().toLowerCase();
}

export function isUsableWorkflowStateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return false;
  return ["production_states", "publication_states", "assignment_states", "place_review_flags"].every((key) => (
    Array.isArray(catalog[key])
    && catalog[key].length > 0
    && catalog[key].every((value) => Boolean(normalizedValue(value)))
  ));
}

export function reportUnknownWorkflowState(item, catalog, logKeys, surface) {
  if (!isUsableWorkflowStateCatalog(catalog)) return null;
  const itemId = Number(item?.id || 0) || 0;
  const candidates = [
    ["production", item?.production_state ?? item?.productionState, catalog.production_states],
    ["publication", item?.publication_state ?? item?.publicationState, catalog.publication_states],
    ["place_review_flag", item?.place_review_flag ?? item?.placeReviewFlag, catalog.place_review_flags],
  ];
  for (const [kind, value, knownStates] of candidates) {
    const state = normalizedValue(value);
    if (!state || knownStates.map(normalizedValue).includes(state)) continue;
    const key = `${itemId}:${kind}:${state}`;
    if (logKeys instanceof Set && !logKeys.has(key)) {
      logKeys.add(key);
      console.error("Unknown workflow state in UI", { item_id: itemId, state, kind, surface });
    }
    return { kind, state };
  }
  return null;
}
