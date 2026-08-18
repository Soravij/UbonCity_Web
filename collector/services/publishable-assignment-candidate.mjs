const ASSIGNMENT_STATE_RANK = new Map([
  ["accepted", 0],
  ["closed", 1],
  ["submitted", 2],
  ["resubmitted", 3],
  ["revision_requested", 4],
  ["in_progress", 5],
  ["assigned", 6],
]);

function hasNewerAssignmentRound(candidate, candidates = []) {
  const assignmentId = Number(candidate?.assignment_id || 0) || 0;
  const assignmentKind = String(candidate?.assignment_kind || "field").trim().toLowerCase() || "field";
  if (!assignmentId) return false;
  return (Array.isArray(candidates) ? candidates : [])
    .some((other) => {
      const otherKind = String(other?.assignment_kind || "field").trim().toLowerCase() || "field";
      return otherKind === assignmentKind && (Number(other?.assignment_id || 0) || 0) > assignmentId;
    });
}

// `selectBestPublishableAssignmentCandidate` receives candidates for one content item only.
// A larger content_assignments.id is a later-created round: the column is SQLite INTEGER PRIMARY
// KEY AUTOINCREMENT, unlike created_at which has second-level precision. A closed round remains
// eligible when it is the latest round of its kind; only a later same-kind assignment supersedes it.
export function isActiveAssignmentCandidate(candidate, candidates = []) {
  const state = String(candidate?.assignment_state || "").trim().toLowerCase();
  return state !== "closed" || !hasNewerAssignmentRound(candidate, candidates);
}

export function getPublishableAssignmentStateRank(value) {
  const state = String(value || "").trim().toLowerCase();
  return ASSIGNMENT_STATE_RANK.has(state) ? ASSIGNMENT_STATE_RANK.get(state) : 99;
}

export function selectBestPublishableAssignmentCandidate(candidates = []) {
  const candidateList = Array.isArray(candidates) ? candidates : [];
  return candidateList
    .filter((candidate) => isActiveAssignmentCandidate(candidate, candidateList))
    .slice()
    .sort((a, b) => {
      if (Number(b.ready_for_publish_source) !== Number(a.ready_for_publish_source)) {
        return Number(b.ready_for_publish_source) - Number(a.ready_for_publish_source);
      }
      if (Number(b.has_article_draft_content) !== Number(a.has_article_draft_content)) {
        return Number(b.has_article_draft_content) - Number(a.has_article_draft_content);
      }
      if (Number(b.has_article_draft_deliverable) !== Number(a.has_article_draft_deliverable)) {
        return Number(b.has_article_draft_deliverable) - Number(a.has_article_draft_deliverable);
      }
      if (Number(b.deliverables_utility?.review_usable) !== Number(a.deliverables_utility?.review_usable)) {
        return Number(b.deliverables_utility?.review_usable) - Number(a.deliverables_utility?.review_usable);
      }
      if (a.assignment_rank !== b.assignment_rank) return a.assignment_rank - b.assignment_rank;
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    })[0] || null;
}

export function isSelectedAssignmentAccepted(candidate) {
  const state = String(candidate?.assignment_state || "").trim().toLowerCase();
  return state === "accepted" || state === "closed";
}

const OPEN_ASSIGNMENT_STATES = Object.freeze(new Set([
  "assigned", "in_progress", "submitted", "resubmitted", "revision_requested", "accepted",
]));

export function hasOpenAssignment(assignment) {
  const state = String(assignment?.state || assignment?.assignment_state || "").trim().toLowerCase();
  return OPEN_ASSIGNMENT_STATES.has(state);
}
