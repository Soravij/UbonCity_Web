import "dotenv/config";
import { createTestClient } from "./test-client.mjs";

export async function ensureItemClaimed(contentItemId, { claimNote = "test fixture claim" } = {}) {
  const id = Number(contentItemId || 0) || 0;
  if (!id) {
    throw new Error("contentItemId must be a positive integer");
  }
  const client = createTestClient();
  const response = await client.post(`/api/items/${id}/claim`, {
    claim_note: claimNote,
  });
  if (response.ok && response.body?.item) {
    return {
      ok: true,
      action: Number(response.body?.item?.claimed_by_user_id || 0) > 0 ? "claimed" : "noop",
      item: response.body.item,
      response,
    };
  }
  if (response.status === 409 && response.body?.item) {
    throw new Error(`item is already claimed by another user: ${JSON.stringify(response.body)}`);
  }
  throw new Error(`claim failed: ${JSON.stringify(response.body)}`);
}

export async function releaseItemClaim(contentItemId) {
  const id = Number(contentItemId || 0) || 0;
  if (!id) {
    throw new Error("contentItemId must be a positive integer");
  }
  const client = createTestClient();
  const response = await client.post(`/api/items/${id}/release`, {});
  if (response.ok && response.body?.item) {
    return {
      ok: true,
      item: response.body.item,
      response,
    };
  }
  throw new Error(`release failed: ${JSON.stringify(response.body)}`);
}
