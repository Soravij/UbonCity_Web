import assert from "node:assert/strict";
import test from "node:test";

import { planBulkItemDelete } from "../services/raw-delete.mjs";

test("planBulkItemDelete is all-or-nothing when any selected item is blocked", () => {
  const result = planBulkItemDelete(
    [
      { id: 11, title: "Safe Raw Item" },
      { id: 22, title: "Blocked Progressed Item" },
    ],
    {
      getRawOnlyHardDeleteEligibility(itemId) {
        if (Number(itemId) === 11) return { eligible: true };
        return { eligible: false };
      },
      getMergeBlockersForItem(itemId) {
        if (Number(itemId) === 22) {
          return [{ key: "published_articles", label: "เผยแพร่ขึ้นเว็บแล้ว", count: 1 }];
        }
        return [];
      },
    }
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.actions, []);
  assert.equal(result.blocked_rows.length, 1);
  assert.equal(result.blocked_rows[0].item_id, 22);
});

test("planBulkItemDelete plans hard delete for safe raw-only items and soft delete for non-blocked items", () => {
  const result = planBulkItemDelete(
    [
      { id: 11, title: "Safe Raw Item" },
      { id: 33, title: "Safe Non-Raw Item" },
    ],
    {
      getRawOnlyHardDeleteEligibility(itemId) {
        return { eligible: Number(itemId) === 11 };
      },
      getMergeBlockersForItem() {
        return [];
      },
    }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.blocked_rows, []);
  assert.deepEqual(result.actions, [
    { item_id: 11, mode: "hard" },
    { item_id: 33, mode: "soft" },
  ]);
});
