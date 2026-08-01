export function isAcceptedOrClosedAssignmentState(value) {
  const state = String(value || "").trim().toLowerCase();
  return state === "accepted" || state === "closed";
}

export function hasAcceptedOrClosedAssignment(assignments = []) {
  return (Array.isArray(assignments) ? assignments : [])
    .some((assignment) => isAcceptedOrClosedAssignmentState(assignment?.state));
}
