import assert from "node:assert/strict";
import test from "node:test";

import { selectHistoryRows } from "../server/public/item-history.js";

test("filters out place_review_flag rows when showAll is false", () => {
  const rows = [
    { id: 1, state_group: "assignment", from_state: "assigned", to_state: "in_progress" },
    { id: 2, state_group: "place_review_flag", from_state: "none", to_state: "revision_requested" },
    { id: 3, state_group: "production", from_state: "collected", to_state: "generated" },
  ];
  const result = selectHistoryRows(rows, false);
  assert.equal(result.length, 2);
  assert.ok(result.every((r) => r.state_group !== "place_review_flag"));
});

test("sorts rows by id descending", () => {
  const rows = [
    { id: 5, state_group: "assignment", from_state: "a", to_state: "b" },
    { id: 1, state_group: "production", from_state: "c", to_state: "d" },
    { id: 10, state_group: "assignment", from_state: "e", to_state: "f" },
  ];
  const result = selectHistoryRows(rows, false);
  assert.deepEqual(result.map((r) => r.id), [10, 5, 1]);
});

test("showAll=true returns all groups without cutting at 20", () => {
  const rows = [];
  for (let i = 1; i <= 30; i++) {
    rows.push({ id: i, state_group: "place_review_flag", from_state: "a", to_state: "b" });
  }
  const result = selectHistoryRows(rows, true);
  assert.equal(result.length, 30);
  assert.equal(result[0].id, 30);
  assert.equal(result[result.length - 1].id, 1);
});
