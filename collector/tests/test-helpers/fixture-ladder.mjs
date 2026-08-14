const PLACE_LADDER_PATH = Object.freeze({
  collected: ["analyzed", "generated", "ready_for_content", "field_working", "field_review"],
  analyzed: ["generated", "ready_for_content", "field_working", "field_review"],
  generated: ["ready_for_content", "field_working", "field_review"],
  ready_for_content: ["field_working", "field_review"],
  field_working: ["field_review"],
  field_review: [],
});

export function advancePlaceProductionState(repo, itemId, targetState, actorEmail = "test@local") {
  const item = repo.getItem(itemId);
  const itemType = String(item?.type || "").trim().toLowerCase();
  if (itemType !== "place") return;

  const head = repo.ensureWorkflowModel(itemId);
  const current = String(head?.production_state || "collected").trim().toLowerCase();
  if (current === targetState) return;

  const path = PLACE_LADDER_PATH[current];
  if (!path) {
    throw new Error(`advancePlaceProductionState: no ladder path from "${current}"`);
  }

  const targetIndex = path.indexOf(targetState);
  if (targetIndex === -1) {
    if (path.length > 0 && path[path.length - 1] !== targetState) {
      throw new Error(`advancePlaceProductionState: "${targetState}" is not reachable from "${current}"`);
    }
    return;
  }

  for (let i = 0; i <= targetIndex; i++) {
    const nextState = path[i];
    repo.upsertWorkflowModel(
      itemId,
      { production_state: nextState, publication_state: "draft" },
      actorEmail,
      { actor_role: "system", reason_code: "test_fixture_advance" }
    );
  }
}
