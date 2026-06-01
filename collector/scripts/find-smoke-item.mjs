import "dotenv/config";
import { openDatabase } from "../db/client.mjs";
import { createRepository } from "../db/repository.mjs";
import { resolvePaths } from "../config/paths.mjs";
import { AI_DRAFT_ALLOWED_STATUSES, readCliOption } from "./lib/smoke-helpers.mjs";

function toInt(value, fallback) {
  const n = Number(value || 0) || 0;
  return n > 0 ? n : fallback;
}

function summarizeCandidate(item, repo) {
  const imageStatus = repo.getImageWorkflowStatus(item.id) || {};
  const workflowStatus = String(item?.workflow_status || "").trim().toLowerCase();
  const selectedCount = Number(imageStatus?.selected_count || 0) || 0;
  const coverCount = Number(imageStatus?.cover_count || 0) || 0;
  const allowed = AI_DRAFT_ALLOWED_STATUSES.includes(workflowStatus);
  const imageReady = Boolean(imageStatus?.is_ready_for_ai_draft);
  const reasons = [];
  if (!allowed) {
    reasons.push(`workflow_status=${workflowStatus || "unknown"} is not in ${AI_DRAFT_ALLOWED_STATUSES.join(",")}`);
  }
  if (selectedCount <= 0) {
    reasons.push("selected_count=0");
  }
  if (coverCount <= 0) {
    reasons.push("cover_count=0");
  }
  return {
    id: Number(item?.id || 0) || null,
    title: String(item?.title || "").trim(),
    workflow_status: workflowStatus,
    claimed_by_user_id: Number(item?.claimed_by_user_id || 0) || null,
    selected_count: selectedCount,
    cover_count: coverCount,
    is_route_status_allowed: allowed,
    is_ready_for_ai_draft: imageReady,
    is_smoke_eligible: allowed && imageReady,
    blocked_reasons: reasons,
  };
}

function rankNearMiss(item) {
  let score = 0;
  if (item.is_route_status_allowed) score += 100;
  if (item.is_ready_for_ai_draft) score += 80;
  score += Math.min(item.selected_count, 20) * 2;
  score += Math.min(item.cover_count, 5) * 5;
  if (item.workflow_status === "content_in_progress") score += 20;
  return score;
}

function dedupeById(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const id = Number(item?.id || 0) || 0;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

async function main() {
  const route = String(readCliOption("--route") || process.env.COLLECTOR_SMOKE_ROUTE || "ai-draft").trim().toLowerCase();
  const limit = toInt(readCliOption("--limit") || process.env.COLLECTOR_SMOKE_FIND_LIMIT, 10);
  const paths = resolvePaths(process.cwd());
  const db = openDatabase(paths.dbPath);
  const repo = createRepository(db);

  if (route !== "ai-draft") {
    throw new Error(`unsupported route: ${route}`);
  }

  const eligible = repo
    .listItemsByStatus(AI_DRAFT_ALLOWED_STATUSES)
    .map((item) => summarizeCandidate(item, repo))
    .filter((item) => item.is_smoke_eligible)
    .slice(0, limit);

  const nearMisses = [
    ...repo.listItemsByStatus(["raw", "content_in_progress"]).map((item) => summarizeCandidate(item, repo)),
    ...repo.listItemsByStatus(AI_DRAFT_ALLOWED_STATUSES)
      .map((item) => summarizeCandidate(item, repo))
      .filter((item) => !item.is_smoke_eligible),
  ]
    .filter((item) => !item.is_smoke_eligible)
    .sort((a, b) => rankNearMiss(b) - rankNearMiss(a) || (b.id || 0) - (a.id || 0));

  const dedupedNearMisses = dedupeById(nearMisses)
    .sort((a, b) => rankNearMiss(b) - rankNearMiss(a) || (b.id || 0) - (a.id || 0))
    .slice(0, limit);

  const recommended = eligible[0] || null;

  console.log(JSON.stringify({
    ok: true,
    route,
    allowed_statuses: AI_DRAFT_ALLOWED_STATUSES,
    eligible_count: eligible.length,
    recommended_item_id: recommended?.id || null,
    eligible_items: eligible,
    near_miss_items: dedupedNearMisses,
  }, null, 2));
}

main().catch((err) => {
  console.error(`find-smoke-item: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
