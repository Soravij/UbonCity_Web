import "dotenv/config";
import { getTestAuthToken } from "./test-auth.mjs";
import { createTestClient } from "./test-client.mjs";
import { ensureItemClaimed, releaseItemClaim } from "./test-fixtures.mjs";

export const AI_DRAFT_ALLOWED_STATUSES = ["cleaned", "generated", "needs_revision", "content_in_progress"];

export function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

export function hasFlag(flag) {
  return process.argv.includes(flag);
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function formatAiDraftEligibilityFailure(contentItemId, workflowStatus) {
  const normalizedStatus = String(workflowStatus || "").trim().toLowerCase() || "unknown";
  return [
    `item ${contentItemId} is not eligible for ai-draft yet: workflow_status=${normalizedStatus}`,
    `allowed_statuses=${AI_DRAFT_ALLOWED_STATUSES.join(",")}`,
    `hint=run "npm run smoke:find-item" to discover a route-eligible item`,
  ].join(" ");
}

export function resolveSmokeItemId({ envKey = "COLLECTOR_TEST_ITEM_ID" } = {}) {
  const contentItemId = Number(readCliOption("--item") || process.env[envKey] || 0) || 0;
  if (!contentItemId) {
    throw new Error(`Set --item <id> or ${envKey}`);
  }
  return contentItemId;
}

export async function loadSmokeAuthContext() {
  const client = createTestClient();
  const auth = await getTestAuthToken();
  const me = await client.get("/api/auth/me");
  assert(me.ok, `GET /api/auth/me failed: ${JSON.stringify(me.body)}`);
  const authUser = me.body?.user || {};
  const actorUserId = Number(authUser?.id || auth?.user?.id || process.env.COLLECTOR_TEST_USER_ID || 0) || 0;
  const actorEmail = String(authUser?.email || auth?.user?.email || "").trim().toLowerCase();
  const actorRole = String(authUser?.role || auth?.user?.role || "").trim().toLowerCase() || null;
  return {
    client,
    auth,
    auth_user: {
      id: actorUserId,
      email: actorEmail,
      role: actorRole,
    },
  };
}

export async function loadSmokeItem(client, contentItemId) {
  const itemResponse = await client.get(`/api/items/${contentItemId}`);
  assert(itemResponse.ok, `GET /api/items/${contentItemId} failed: ${JSON.stringify(itemResponse.body)}`);
  return itemResponse.body;
}

export async function ensureSmokeItemOwnership(client, contentItemId, authUser, { claimNote = "claim for smoke test" } = {}) {
  const beforeItem = await loadSmokeItem(client, contentItemId);
  const beforeClaimedByUserId = Number(beforeItem?.claimed_by_user_id || 0) || 0;
  if (beforeClaimedByUserId > 0 && beforeClaimedByUserId !== Number(authUser?.id || 0)) {
    throw new Error(
      `item ${contentItemId} is claimed by another collector user. auth_user_id=${Number(authUser?.id || 0) || 0} auth_email=${String(authUser?.email || "").trim().toLowerCase()} item_claimed_by_user_id=${beforeClaimedByUserId}`
    );
  }
  const claimResult = await ensureItemClaimed(contentItemId, { claimNote });
  const claimedThisRun = beforeClaimedByUserId === 0
    && Number(claimResult.item?.claimed_by_user_id || 0) === Number(authUser?.id || 0);
  return {
    before_item: beforeItem,
    before_claimed_by_user_id: beforeClaimedByUserId,
    claim_result: claimResult,
    claimed_this_run: claimedThisRun,
  };
}

export async function assertAiDraftReady(client, contentItemId) {
  const item = await loadSmokeItem(client, contentItemId);
  const workflowStatus = String(item?.workflow_status || "").trim().toLowerCase();
  const allowedStatuses = new Set(AI_DRAFT_ALLOWED_STATUSES);
  assert(
    allowedStatuses.has(workflowStatus),
    formatAiDraftEligibilityFailure(contentItemId, workflowStatus)
  );
  const imageWorkflow = await client.get(`/api/items/${contentItemId}/image-workflow`);
  assert(imageWorkflow.ok, `GET /api/items/${contentItemId}/image-workflow failed: ${JSON.stringify(imageWorkflow.body)}`);
  assert(
    imageWorkflow.body?.status?.is_ready_for_ai_draft === true,
    `item ${contentItemId} is not ready for ai-draft: selected_count=${Number(imageWorkflow.body?.status?.selected_count || 0) || 0} cover_count=${Number(imageWorkflow.body?.status?.cover_count || 0) || 0} hint=run "npm run smoke:find-item" to discover a route-eligible item`
  );
  return {
    item,
    image_workflow: imageWorkflow.body,
  };
}

export async function finalizeSmokeClaimCleanup(contentItemId, {
  claimedThisRun = false,
  keepClaimed = false,
} = {}) {
  if (!claimedThisRun || keepClaimed) {
    return null;
  }
  return releaseItemClaim(contentItemId);
}
