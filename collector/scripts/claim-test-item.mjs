import "dotenv/config";
import { ensureItemClaimed, releaseItemClaim } from "./lib/test-fixtures.mjs";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const contentItemId = Number(readCliOption("--item") || process.env.COLLECTOR_TEST_ITEM_ID || 0) || 0;
  if (!contentItemId) {
    throw new Error("Set --item <id> or COLLECTOR_TEST_ITEM_ID");
  }

  const result = hasFlag("--release")
    ? await releaseItemClaim(contentItemId)
    : await ensureItemClaimed(contentItemId, {
      claimNote: readCliOption("--note") || "claim for test path",
    });

  console.log(JSON.stringify({
    ok: true,
    action: hasFlag("--release") ? "released" : result.action,
    content_item_id: contentItemId,
    claim_status: result.item?.claim_status || null,
    claimed_by_user_id: Number(result.item?.claimed_by_user_id || 0) || null,
    claimed_by_user: result.item?.claimed_by_user || null,
  }, null, 2));
}

main().catch((err) => {
  console.error(`claim-test-item: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
