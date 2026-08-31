import test from "node:test";
import assert from "node:assert/strict";

import { computePending } from "../config/checkPendingMigrations.js";

const ALL_FILES = [
  "000_baseline_schema.sql",
  "023_drop_lifecycle_tables.sql",
  "024_ai_usage_log.sql",
  "025_align_category_translations.sql",
  "026_users_role_default.sql",
  "027_audit_probe.sql",
  "028_future.sql",
];

test("files already in ledger are not pending", () => {
  const ledger = ["000_baseline_schema.sql", "025_align_category_translations.sql"];
  const pending = computePending(ALL_FILES, ledger);
  assert.ok(!pending.includes("000_baseline_schema.sql"));
  assert.ok(!pending.includes("025_align_category_translations.sql"));
});

test("027 not in ledger is pending (runner)", () => {
  const ledger = [];
  const pending = computePending(ALL_FILES, ledger);
  assert.ok(pending.includes("027_audit_probe.sql"));
  assert.ok(pending.includes("028_future.sql"));
});

test("024/025/026 not in ledger are NOT pending (baseline/manual)", () => {
  const ledger = [];
  const pending = computePending(ALL_FILES, ledger);
  assert.ok(!pending.includes("024_ai_usage_log.sql"));
  assert.ok(!pending.includes("025_align_category_translations.sql"));
  assert.ok(!pending.includes("026_users_role_default.sql"));
});

test("023 not in ledger is NOT pending (baseline)", () => {
  const ledger = [];
  const pending = computePending(ALL_FILES, ledger);
  assert.ok(!pending.includes("023_drop_lifecycle_tables.sql"));
});

test("empty inputs return empty pending", () => {
  assert.deepEqual(computePending([], []), []);
});
