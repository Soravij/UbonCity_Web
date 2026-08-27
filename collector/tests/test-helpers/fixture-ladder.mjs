const PLACE_LADDER_PATH = Object.freeze({
  collected: ["analyzed", "generated", "ready_for_content", "field_working", "field_review", "ready_for_writer", "writing_assigned", "writing", "in_review"],
  analyzed: ["generated", "ready_for_content", "field_working", "field_review", "ready_for_writer", "writing_assigned", "writing", "in_review"],
  generated: ["ready_for_content", "field_working", "field_review", "ready_for_writer", "writing_assigned", "writing", "in_review"],
  ready_for_content: ["field_working", "field_review", "ready_for_writer", "writing_assigned", "writing", "in_review"],
  field_working: ["field_review", "ready_for_writer", "writing_assigned", "writing", "in_review"],
  field_review: ["ready_for_writer", "writing_assigned", "writing", "in_review"],
  ready_for_writer: ["writing_assigned", "writing", "in_review"],
  writing_assigned: ["writing", "in_review"],
  writing: ["in_review"],
  in_review: [],
});

const PLACE_PRODUCTION_LADDER = [
  "collected", "analyzed", "generated", "ready_for_content",
  "field_working", "field_review", "ready_for_writer",
  "writing_assigned", "writing", "in_review",
  "ready_for_publish", "submitted_for_admin_review", "completed",
];

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
    const currentRung = PLACE_PRODUCTION_LADDER.indexOf(current);
    const targetRung = PLACE_PRODUCTION_LADDER.indexOf(targetState);
    if (targetRung === -1) {
      throw new Error(`advancePlaceProductionState: "${targetState}" is not a known production state`);
    }
    if (targetRung <= currentRung) {
      return; // ผ่านขั้นนี้มาแล้ว — no-op โดยตั้งใจ
    }
    throw new Error(`advancePlaceProductionState: "${targetState}" is not reachable from "${current}"`);
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
