import "dotenv/config";
import {
  assert,
  assertAiDraftReady,
  finalizeSmokeClaimCleanup,
  hasFlag,
  loadSmokeAuthContext,
  resolveSmokeItemId,
  ensureSmokeItemOwnership,
} from "./lib/smoke-helpers.mjs";

function summarizeItem(item = {}) {
  return {
    id: Number(item?.id || 0) || null,
    title: String(item?.title || "").trim(),
    slug: String(item?.slug || "").trim(),
    summary: String(item?.summary || "").trim(),
    meta_title: String(item?.meta_title || "").trim(),
    meta_description: String(item?.meta_description || "").trim(),
    description_clean: String(item?.description_clean || "").trim(),
    workflow_status: String(item?.workflow_status || "").trim(),
    claim_status: String(item?.claim_status || "").trim(),
    claimed_by_user_id: Number(item?.claimed_by_user_id || 0) || null,
  };
}

function countChecklist(fieldPack = {}, checklistType) {
  const rows = Array.isArray(fieldPack?.checklists) ? fieldPack.checklists : [];
  return rows.filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === checklistType && String(row?.item_text || "").trim()).length;
}

function summarizeFieldPack(fieldPack = {}) {
  return {
    id: Number(fieldPack?.id || 0) || null,
    status: String(fieldPack?.status || "").trim(),
    ai_summary: String(fieldPack?.ai_summary || "").trim(),
    story_angle: String(fieldPack?.story_angle || "").trim(),
    social_hook: String(fieldPack?.social_hook || "").trim(),
    must_verify_fact_count: countChecklist(fieldPack, "must_verify_fact"),
    must_capture_shot_count: countChecklist(fieldPack, "must_capture_shot"),
    must_ask_question_count: countChecklist(fieldPack, "must_ask_question"),
  };
}

function logStep(step, detail = "") {
  const ts = new Date().toISOString();
  const suffix = String(detail || "").trim();
  console.error(`[${ts}] smoke-ai-draft step=${step}${suffix ? ` ${suffix}` : ""}`);
}

async function main() {
  const contentItemId = resolveSmokeItemId();
  const keepClaimed = hasFlag("--keep-claimed");
  logStep("start", `content_item_id=${contentItemId}`);
  logStep("auth.load");
  const { client, auth_user: authUser } = await loadSmokeAuthContext();
  logStep("auth.ok", `user_id=${Number(authUser?.id || 0) || 0} email=${String(authUser?.email || "").trim().toLowerCase()}`);
  logStep("claim.ensure");
  const { claimed_this_run: claimedThisRun } = await ensureSmokeItemOwnership(client, contentItemId, authUser, {
    claimNote: "claim for smoke-ai-draft",
  });
  logStep("claim.ok", `claimed_this_run=${claimedThisRun ? "true" : "false"}`);

  let releaseResult = null;
  try {
    logStep("readiness.check");
    const readiness = await assertAiDraftReady(client, contentItemId);
    const imageWorkflow = readiness.image_workflow;
    const eligibleItem = readiness.item;
    logStep(
      "readiness.ok",
      `workflow_status=${String(eligibleItem?.workflow_status || "").trim().toLowerCase() || "unknown"} selected_count=${Number(imageWorkflow?.status?.selected_count || 0) || 0} cover_count=${Number(imageWorkflow?.status?.cover_count || 0) || 0}`
    );
    const before = await client.get(`/api/items/${contentItemId}`);
    assert(before.ok, `GET /api/items/${contentItemId} before ai-draft failed: ${JSON.stringify(before.body)}`);
    const beforeDescriptionClean = String(before.body?.description_clean || "").trim();
    const beforeWorkflowStatus = String(before.body?.workflow_status || "").trim();

    logStep("generate.run");
    const run = await client.post("/api/run/ai-draft", { content_item_id: contentItemId });
    logStep("generate.response", `status=${Number(run.status || 0) || 0}`);
    assert(run.ok, `POST /api/run/ai-draft failed (${run.status}): ${JSON.stringify(run.body)}`);
    assert(Number(run.body?.count || 0) >= 1, `ai-draft count mismatch: ${JSON.stringify(run.body)}`);
    assert(String(run.body?.mode || "").trim().length > 0, `ai-draft mode missing: ${JSON.stringify(run.body)}`);
    assert(String(run.body?.generationRunUid || "").trim().length > 0, `generationRunUid missing: ${JSON.stringify(run.body)}`);
    const selectedImageCount = Number(imageWorkflow?.status?.selected_count || 0) || 0;
    const visualContextSuccessCount = Number(run.body?.visualContextSuccessCount || 0) || 0;
    const visualContextErrorCount = Number(run.body?.visualContextErrorCount || 0) || 0;
    assert(
      selectedImageCount <= 0 || visualContextErrorCount === 0,
      `visual context failed with selected images: selected_count=${selectedImageCount} visualContextErrorCount=${visualContextErrorCount} ${JSON.stringify(run.body)}`
    );
    assert(
      selectedImageCount <= 0 || visualContextSuccessCount > 0,
      `visual context was not generated with selected images: selected_count=${selectedImageCount} visualContextSuccessCount=${visualContextSuccessCount} ${JSON.stringify(run.body)}`
    );

    logStep("item.reload");
    const after = await client.get(`/api/items/${contentItemId}`);
    assert(after.ok, `GET /api/items/${contentItemId} after ai-draft failed: ${JSON.stringify(after.body)}`);

    const afterItem = after.body;
    const contract = summarizeItem(afterItem);
    assert(contract.description_clean, `saved description_clean missing: ${JSON.stringify(contract)}`);
    assert(
      String(afterItem?.description_clean || "").trim() === beforeDescriptionClean,
      `description_clean changed during field-pack generation: ${JSON.stringify({ before: beforeDescriptionClean, after: afterItem?.description_clean })}`
    );
    assert(
      contract.workflow_status === beforeWorkflowStatus,
      `workflow_status changed during field-pack generation: ${JSON.stringify({ before: beforeWorkflowStatus, after: contract.workflow_status, contract })}`
    );

    logStep("field_pack.reload");
    const fieldPackRes = await client.get(`/api/items/${contentItemId}/field-pack/current`);
    assert(fieldPackRes.ok, `GET /api/items/${contentItemId}/field-pack/current failed: ${JSON.stringify(fieldPackRes.body)}`);
    const fieldPackContract = summarizeFieldPack(fieldPackRes.body?.field_pack || {});
    assert(fieldPackContract.id, `field pack id missing: ${JSON.stringify(fieldPackContract)}`);
    assert(fieldPackContract.status === "ready_for_field", `field pack status mismatch: ${JSON.stringify(fieldPackContract)}`);
    assert(fieldPackContract.ai_summary || fieldPackContract.story_angle || fieldPackContract.social_hook, `field pack summary/direction missing: ${JSON.stringify(fieldPackContract)}`);
    assert(fieldPackContract.must_verify_fact_count > 0, `must_verify_fact checklist missing: ${JSON.stringify(fieldPackContract)}`);
    assert(fieldPackContract.must_capture_shot_count > 0, `must_capture_shot checklist missing: ${JSON.stringify(fieldPackContract)}`);
    assert(fieldPackContract.must_ask_question_count > 0, `must_ask_question checklist missing: ${JSON.stringify(fieldPackContract)}`);

    console.log(JSON.stringify({
      ok: true,
      content_item_id: contentItemId,
      auth_user: authUser,
      claimed_this_run: claimedThisRun,
      keep_claimed: keepClaimed,
      item: {
        workflow_status: String(eligibleItem?.workflow_status || "").trim() || null,
      },
      image_workflow: {
        selected_count: Number(imageWorkflow?.status?.selected_count || 0) || 0,
        cover_count: Number(imageWorkflow?.status?.cover_count || 0) || 0,
        is_ready_for_ai_draft: Boolean(imageWorkflow?.status?.is_ready_for_ai_draft),
      },
      generation: {
        count: Number(run.body?.count || 0) || 0,
        mode: String(run.body?.mode || "").trim(),
        aiSuccessCount: Number(run.body?.aiSuccessCount || 0) || 0,
        fallbackCount: Number(run.body?.fallbackCount || 0) || 0,
        errorCount: Number(run.body?.errorCount || 0) || 0,
        visualContextSuccessCount,
        visualContextSkippedCount: Number(run.body?.visualContextSkippedCount || 0) || 0,
        visualContextErrorCount,
        generationRunUid: String(run.body?.generationRunUid || "").trim(),
      },
      saved_contract: contract,
      field_pack_contract: fieldPackContract,
    }, null, 2));
  } finally {
    try {
      logStep("cleanup.begin", `claimed_this_run=${claimedThisRun ? "true" : "false"} keep_claimed=${keepClaimed ? "true" : "false"}`);
      releaseResult = await finalizeSmokeClaimCleanup(contentItemId, {
        claimedThisRun,
        keepClaimed,
      });
      logStep("cleanup.done", releaseResult?.item ? "released=true" : "released=false");
    } catch (err) {
      console.error(`smoke-ai-draft: release cleanup failed - ${String(err?.message || err)}`);
      process.exitCode = 1;
    }
    if (releaseResult?.item) {
      try {
        console.error(JSON.stringify({
          cleanup: "released",
          content_item_id: contentItemId,
          claim_status: releaseResult.item?.claim_status || null,
          claimed_by_user_id: Number(releaseResult.item?.claimed_by_user_id || 0) || null,
        }, null, 2));
      } catch {}
      }
  }
}

main().catch((err) => {
  console.error(`smoke-ai-draft: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
