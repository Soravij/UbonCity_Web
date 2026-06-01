import "dotenv/config";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  assert,
  assertAiDraftReady,
  finalizeSmokeClaimCleanup,
  hasFlag,
  loadSmokeAuthContext,
  resolveSmokeItemId,
  ensureSmokeItemOwnership,
} from "./lib/smoke-helpers.mjs";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

function logStep(step, detail = "") {
  const ts = new Date().toISOString();
  const suffix = String(detail || "").trim();
  console.error(`[${ts}] smoke-external-agent step=${step}${suffix ? ` ${suffix}` : ""}`);
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
    must_verify_fact_count: countChecklist(fieldPack, "must_verify_fact"),
    must_capture_shot_count: countChecklist(fieldPack, "must_capture_shot"),
    must_ask_question_count: countChecklist(fieldPack, "must_ask_question"),
  };
}

async function waitForMockAgent(url, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "health_check" }),
      });
      if (response.status === 400) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`mock external agent did not become reachable at ${url}`);
}

function startMockAgent({ port, logFile }) {
  const args = ["scripts/mock-external-agent.mjs", "--port", String(port)];
  if (logFile) args.push("--log-file", logFile);
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stderr.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (err) => {
    throw new Error(`mock external agent failed to start: ${String(err?.message || err)}`);
  });
  return child;
}

function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
}

async function main() {
  const contentItemId = resolveSmokeItemId();
  const keepClaimed = hasFlag("--keep-claimed");
  const keepMock = hasFlag("--keep-mock");
  const port = Number(readCliOption("--mock-port") || process.env.MOCK_EXTERNAL_AGENT_PORT || 7001) || 7001;
  const agentUrl = `http://127.0.0.1:${port}/run`;
  const expectedExternalUrl = String(process.env.COLLECTOR_EXTERNAL_AGENT_URL || "").trim().replace(/\/+$/, "");
  const logFile = String(readCliOption("--log-file") || process.env.MOCK_EXTERNAL_AGENT_LOG_FILE || "runtime/mock-external-agent-smoke.jsonl").trim();

  logStep("start", `content_item_id=${contentItemId} mock_url=${agentUrl}`);
  if (expectedExternalUrl && expectedExternalUrl !== agentUrl) {
    throw new Error(`COLLECTOR_EXTERNAL_AGENT_URL must match mock url for this smoke: expected ${agentUrl}, got ${expectedExternalUrl}`);
  }
  if (!expectedExternalUrl) {
    console.error(`smoke-external-agent: Collector must be running with COLLECTOR_AGENT_ENGINE=external and COLLECTOR_EXTERNAL_AGENT_URL=${agentUrl}`);
  }

  const mock = startMockAgent({ port, logFile });
  let releaseResult = null;
  let claimedThisRun = false;
  try {
    await waitForMockAgent(agentUrl);
    logStep("mock.ready");

    logStep("auth.load");
    const { client, auth_user: authUser } = await loadSmokeAuthContext();
    logStep("auth.ok", `user_id=${Number(authUser?.id || 0) || 0} email=${String(authUser?.email || "").trim().toLowerCase()}`);

    logStep("claim.ensure");
    const claimResult = await ensureSmokeItemOwnership(client, contentItemId, authUser, {
      claimNote: "claim for smoke-external-agent",
    });
    claimedThisRun = Boolean(claimResult?.claimed_this_run);
    logStep("claim.ok", `claimed_this_run=${claimedThisRun ? "true" : "false"}`);

    try {
      logStep("readiness.check");
      const readiness = await assertAiDraftReady(client, contentItemId);
      const imageWorkflow = readiness.image_workflow;
      logStep(
        "readiness.ok",
        `selected_count=${Number(imageWorkflow?.status?.selected_count || 0) || 0} cover_count=${Number(imageWorkflow?.status?.cover_count || 0) || 0}`
      );
      const before = await client.get(`/api/items/${contentItemId}`);
      assert(before.ok, `GET /api/items/${contentItemId} before external ai-draft failed: ${JSON.stringify(before.body)}`);
      const beforeDescriptionClean = String(before.body?.description_clean || "").trim();

      logStep("generate.run");
      const run = await client.post("/api/run/ai-draft", { content_item_id: contentItemId }, {
        timeoutMs: Number(process.env.COLLECTOR_TEST_REQUEST_TIMEOUT_MS || 90000) || 90000,
      });
      logStep("generate.response", `status=${Number(run.status || 0) || 0}`);
      assert(run.ok, `POST /api/run/ai-draft failed (${run.status}): ${JSON.stringify(run.body)}`);
      assert(Number(run.body?.count || 0) >= 1, `external ai-draft count mismatch: ${JSON.stringify(run.body)}`);
      assert(Number(run.body?.aiSuccessCount || 0) >= 1, `external aiSuccessCount mismatch: ${JSON.stringify(run.body)}`);
      assert(Number(run.body?.errorCount || 0) === 0, `external errorCount mismatch: ${JSON.stringify(run.body)}`);

      const after = await client.get(`/api/items/${contentItemId}`);
      assert(after.ok, `GET /api/items/${contentItemId} after external ai-draft failed: ${JSON.stringify(after.body)}`);
      const item = after.body || {};
      assert(String(item.workflow_status || "").trim() === "cleaned", `workflow_status should remain cleaned for handoff queue: ${JSON.stringify(item)}`);
      assert(
        String(item.description_clean || "").trim() === beforeDescriptionClean,
        "description_clean changed during external field-pack generation"
      );
      const fieldPackRes = await client.get(`/api/items/${contentItemId}/field-pack/current`);
      assert(fieldPackRes.ok, `GET /api/items/${contentItemId}/field-pack/current failed: ${JSON.stringify(fieldPackRes.body)}`);
      const fieldPackContract = summarizeFieldPack(fieldPackRes.body?.field_pack || {});
      assert(fieldPackContract.id, `field pack id missing: ${JSON.stringify(fieldPackContract)}`);
      assert(fieldPackContract.status === "ready_for_field", `field pack status mismatch: ${JSON.stringify(fieldPackContract)}`);
      assert(fieldPackContract.ai_summary.includes("mock external agent field pack"), `field pack summary does not look like mock external output: ${JSON.stringify(fieldPackContract)}`);
      assert(fieldPackContract.must_verify_fact_count > 0, `must_verify_fact checklist missing: ${JSON.stringify(fieldPackContract)}`);
      assert(fieldPackContract.must_capture_shot_count > 0, `must_capture_shot checklist missing: ${JSON.stringify(fieldPackContract)}`);
      assert(fieldPackContract.must_ask_question_count > 0, `must_ask_question checklist missing: ${JSON.stringify(fieldPackContract)}`);

      console.log(JSON.stringify({
        ok: true,
        content_item_id: contentItemId,
        mock_agent_url: agentUrl,
        mock_log_file: logFile,
        generation: {
          count: Number(run.body?.count || 0) || 0,
          mode: String(run.body?.mode || "").trim(),
          aiSuccessCount: Number(run.body?.aiSuccessCount || 0) || 0,
          errorCount: Number(run.body?.errorCount || 0) || 0,
          visualContextSuccessCount: Number(run.body?.visualContextSuccessCount || 0) || 0,
          visualContextErrorCount: Number(run.body?.visualContextErrorCount || 0) || 0,
        },
        saved_contract: {
          workflow_status: String(item.workflow_status || "").trim(),
          slug: String(item.slug || "").trim(),
          summary: String(item.summary || "").trim(),
          meta_title: String(item.meta_title || "").trim(),
          meta_description: String(item.meta_description || "").trim(),
        },
        field_pack_contract: fieldPackContract,
      }, null, 2));
    } finally {
      try {
        releaseResult = await finalizeSmokeClaimCleanup(contentItemId, {
          claimedThisRun,
          keepClaimed,
        });
        logStep("cleanup.done", releaseResult?.item ? "released=true" : "released=false");
      } catch (err) {
        console.error(`smoke-external-agent: release cleanup failed - ${String(err?.message || err)}`);
        process.exitCode = 1;
      }
    }
  } finally {
    if (!keepMock) stopChild(mock);
  }
}

main().catch((err) => {
  console.error(`smoke-external-agent: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
