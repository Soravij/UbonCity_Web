import { REFERENCE_HARD_BLOCKER_DEFS } from "../db/repository.mjs";

// Soft-delete is reversible: the row stays in content_items with is_deleted=1 and the full
// dependency gate still runs at merge and at purge. Only blockers that can never be overridden by
// re-deleting later belong here — an item under an open assignment is still soft-deletable, a
// published one is not.
//
// The keys and their SQL come from REFERENCE_HARD_BLOCKER_DEFS in db/repository.mjs so this gate
// cannot drift from the purge classification. Only the soft-delete-specific remediation text —
// what the user must do to make the delete possible — is stated here. translations_published is
// already per-row in the def (source_published_article_id IS NOT NULL); no special case needed.
//
// This map currently names every hard blocker, but the filter below is NOT redundant: it is what
// keeps the NEVER set opt-in. A future hard blocker with no entry here stays out of the soft-delete
// gate by default, which is the safe direction — soft delete is reversible, so a new permanent
// purge blocker must not silently start barring it too. The lock test asserts the resulting set.
const NEVER_OVERRIDE_REMEDIATION = Object.freeze({
  published_articles: "ต้อง unpublish จาก main-site ก่อนจึงจะลบได้",
  review_actions: "ประวัติรีวิวลบไม่ได้ — ต้องให้ owner purge รายการนี้แทน",
  translations_published: "ต้องถอนงานแปลหรือ unpublish บทความต้นทางก่อน",
});

const NEVER_OVERRIDE_CHECKS = REFERENCE_HARD_BLOCKER_DEFS.filter((def) =>
  Object.prototype.hasOwnProperty.call(NEVER_OVERRIDE_REMEDIATION, def.key)
).map((def) => ({
  key: def.key,
  label: def.label_th,
  remediation: NEVER_OVERRIDE_REMEDIATION[def.key],
  sql: def.sql,
}));

export function getNeverOverrideBlockersForItem(db, itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id || !db) return [];
  const blockers = [];
  for (const check of NEVER_OVERRIDE_CHECKS) {
    const count = Number(db.prepare(check.sql).get(id)?.c || 0);
    if (count > 0) {
      blockers.push({ key: check.key, label: check.label, remediation: check.remediation, count });
    }
  }
  return blockers;
}

export function toCleanupBlockerEntry(group) {
  return {
    key: group.key,
    label: group.label_th || group.key,
    count: Number(group.count || 0) || 0,
    category: group.category,
    resolution_hint: group.resolution_hint || null,
    confirm_reason_th: group.confirm_reason_th || null,
  };
}

function normalizeConfirmedOverrideKeys(confirmedOverrides) {
  return new Set(
    (Array.isArray(confirmedOverrides) ? confirmedOverrides : [])
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

// Splits the reference groups of one deleted item into the three purge tiers.
export function classifyPurgeGroups(groups = []) {
  const rows = Array.isArray(groups) ? groups : [];
  return {
    groups: rows,
    hard_blockers: rows.filter((entry) => entry.category === "hard_blocker"),
    cleanup_candidates: rows.filter((entry) => entry.category === "cleanup_candidate"),
    confirm_required: rows.filter((entry) => entry.category === "confirm_required"),
  };
}

// The purge gate, separated from the transaction so it can be tested without an HTTP server.
// Returns what the caller should do; it neither throws nor touches the database.
export function planDeletedItemPurge(classified, confirmedOverrides = []) {
  const hardBlockers = Array.isArray(classified?.hard_blockers) ? classified.hard_blockers : [];
  const cleanupCandidates = Array.isArray(classified?.cleanup_candidates) ? classified.cleanup_candidates : [];
  const confirmRequired = Array.isArray(classified?.confirm_required) ? classified.confirm_required : [];

  // hard_blocker and cleanup_candidate are never overridable here: the first is permanent, the
  // second must go through the reference-cleanup endpoint first. No confirmation can bypass either.
  const blockingGroups = [...hardBlockers, ...cleanupCandidates];
  if (blockingGroups.length) {
    return {
      ok: false,
      status: 409,
      error: "deleted item has purge blockers",
      blockers: blockingGroups.map(toCleanupBlockerEntry),
      missing_confirmations: [],
      confirmed_overrides: [],
    };
  }

  const confirmedKeys = normalizeConfirmedOverrideKeys(confirmedOverrides);
  const missingConfirmations = confirmRequired.filter((group) => !confirmedKeys.has(group.key));
  if (missingConfirmations.length) {
    return {
      ok: false,
      status: 400,
      error: "purge requires confirmation for curated groups",
      blockers: [],
      missing_confirmations: missingConfirmations.map(toCleanupBlockerEntry),
      confirmed_overrides: [],
    };
  }

  return {
    ok: true,
    status: 200,
    error: "",
    blockers: [],
    missing_confirmations: [],
    confirmed_overrides: confirmRequired.map((group) => ({
      key: group.key,
      label: group.label_th || group.key,
      count: Number(group.count || 0) || 0,
      confirm_reason_th: group.confirm_reason_th || null,
      confirm_details: Array.isArray(group.confirm_details) ? group.confirm_details : [],
    })),
  };
}

export function planBulkItemDelete(rows = [], dependencies = {}) {
  const getRawOnlyHardDeleteEligibility =
    typeof dependencies.getRawOnlyHardDeleteEligibility === "function"
      ? dependencies.getRawOnlyHardDeleteEligibility
      : () => ({ eligible: false });
  const getNeverOverrideBlockers =
    typeof dependencies.getNeverOverrideBlockersForItem === "function"
      ? dependencies.getNeverOverrideBlockersForItem
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
    const maybeBlockers = getNeverOverrideBlockers(itemId);
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

  // Partial success: blocked rows are skipped and reported, the rest still proceed.
  return {
    ok: blockedRows.length === 0,
    actions,
    blocked_rows: blockedRows,
  };
}
