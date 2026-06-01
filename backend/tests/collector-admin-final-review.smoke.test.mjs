import test from "node:test";

import { runCollectorAdminFinalReviewSmoke } from "../scripts/smoke-collector-admin-final-review.mjs";

test("collector admin final review smoke", async () => {
  await runCollectorAdminFinalReviewSmoke();
});
