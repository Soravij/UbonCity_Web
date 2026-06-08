export function planBulkItemDelete(rows = [], dependencies = {}) {
  const getRawOnlyHardDeleteEligibility =
    typeof dependencies.getRawOnlyHardDeleteEligibility === "function"
      ? dependencies.getRawOnlyHardDeleteEligibility
      : () => ({ eligible: false });
  const getMergeBlockersForItem =
    typeof dependencies.getMergeBlockersForItem === "function"
      ? dependencies.getMergeBlockersForItem
      : () => [];

  const actions = [];
  const blockedRows = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const itemId = Number(row?.id || 0) || 0;
    if (!itemId) continue;
    const rawOnlyEligibility = getRawOnlyHardDeleteEligibility(itemId);
    if (rawOnlyEligibility?.eligible) {
      actions.push({ item_id: itemId, mode: "hard" });
      continue;
    }
    const maybeBlockers = getMergeBlockersForItem(itemId);
    const itemBlockers = Array.isArray(maybeBlockers) ? maybeBlockers : [];
    if (itemBlockers.length > 0) {
      blockedRows.push({
        item_id: itemId,
        title: row?.title || "",
        blockers: itemBlockers,
      });
      continue;
    }
    actions.push({ item_id: itemId, mode: "soft" });
  }

  return {
    ok: blockedRows.length === 0,
    actions: blockedRows.length === 0 ? actions : [],
    blocked_rows: blockedRows,
  };
}
