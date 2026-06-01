import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import { resolvePaths } from "../config/paths.mjs";
import { openDatabase } from "../db/client.mjs";
import { resolveSmokeCredentials } from "./shared-smoke-auth.mjs";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

function parseOptionalPositiveInt(raw, fieldName) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${fieldName} must be a positive integer when provided`);
  }
  return n;
}

const PORT = Number(process.env.VERIFY_PORT || 5090);
const VERIFY_MODE = String(readCliOption("--mode") || process.env.VERIFY_MODE || "all").trim().toLowerCase() || "all";
const ASSIGNMENT_ID = parseOptionalPositiveInt(
  readCliOption("--assignment-id") || process.env.ASSIGNMENT_ID || "",
  "ASSIGNMENT_ID"
);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const BASE_URL = `http://127.0.0.1:${PORT}`;

if (!new Set(["all", "e2e", "comparator"]).has(VERIFY_MODE)) {
  throw new Error("VERIFY_MODE must be one of: all, e2e, comparator");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function resolveVerifyAuth() {
  return resolveSmokeCredentials({
    label: "verify e2e mode",
    emailEnvKeys: ["BACKEND_AUTH_EMAIL", "COLLECTOR_VERIFY_EMAIL"],
    passwordEnvKeys: ["BACKEND_AUTH_PASSWORD", "COLLECTOR_VERIFY_PASSWORD"],
  });
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeFieldList(values) {
  return (Array.isArray(values) ? values : [])
    .map((raw) => normalizeText(raw))
    .filter((value) => Boolean(value))
    .sort();
}

function listsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function parseJsonSafe(value, fallback = {}) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return fallback;
  }
}

function resolveAssignmentId(db, explicitAssignmentId = null) {
  try {
    if (Number.isInteger(explicitAssignmentId) && explicitAssignmentId > 0) {
      const row = db.prepare("SELECT id FROM content_assignments WHERE id = ? LIMIT 1").get(explicitAssignmentId);
      assert(row?.id, `ASSIGNMENT_ID ${explicitAssignmentId} not found`);
      return Number(row.id);
    }

    const fallback = db.prepare("SELECT id FROM content_assignments ORDER BY id DESC LIMIT 1").get();
    assert(fallback?.id, "No assignments found for verification. Provide ASSIGNMENT_ID explicitly.");
    return Number(fallback.id);
  } catch (err) {
    const message = String(err?.message || err);
    if (message.toLowerCase().includes("no such table: content_assignments")) {
      throw new Error(
        "content_assignments table not found. Verify DB path/schema for collector-app, then run npm run db:init if needed."
      );
    }
    throw err;
  }
}

async function waitForServerReady(server, timeoutMs = 30000) {
  const startAt = Date.now();
  let outTail = "";
  let errTail = "";
  let ready = false;

  server.stdout.on("data", (chunk) => {
    const text = String(chunk || "");
    outTail = `${outTail}${text}`.slice(-1600);
    const lower = text.toLowerCase();
    if (lower.includes("collector app listening") || lower.includes("collector app running on")) {
      ready = true;
    }
  });
  server.stderr.on("data", (chunk) => {
    const text = String(chunk || "");
    errTail = `${errTail}${text}`.slice(-1600);
  });

  while (!ready && Date.now() - startAt < timeoutMs) {
    if (server.exitCode != null) {
      throw new Error(`server exited early with code ${server.exitCode}. stderr tail: ${errTail}`);
    }
    await delay(200);
  }

  if (!ready) {
    throw new Error(`server not ready in ${timeoutMs}ms. stdout tail: ${outTail} stderr tail: ${errTail}`);
  }
}

async function loginToken() {
  const { email, password } = resolveVerifyAuth();
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json();
  assert(response.ok, `login failed: ${JSON.stringify(payload)}`);
  assert(payload?.token, "login response missing token");
  return payload.token;
}

function extractPayloadObject(routeCase, responseBody) {
  const payload = responseBody?.[routeCase.responsePayloadKey];
  assert(isObject(payload), `${routeCase.name} missing payload object '${routeCase.responsePayloadKey}'`);
  return payload;
}

function assertBaseContract(routeCase, scenario, responseBody) {
  const requiredFields = [
    "authoritative_summary_mode",
    "authoritative_summary",
    "raw_summary",
    "effective_summary",
    "raw_effective_diverged",
    "legacy_top_level_mode",
    "legacy_top_level_match_scope",
    "legacy_top_level_matches_authoritative",
    "legacy_top_level_mismatch_fields",
  ];
  for (const field of requiredFields) {
    assert(Object.prototype.hasOwnProperty.call(responseBody, field), `${routeCase.name}/${scenario.name} missing '${field}'`);
  }
  assert(responseBody.legacy_top_level_mode === "compatibility", `${routeCase.name}/${scenario.name} legacy_top_level_mode mismatch`);
  assert(responseBody.legacy_top_level_match_scope === "reason_semantic", `${routeCase.name}/${scenario.name} scope mismatch`);
  assert(Array.isArray(responseBody.legacy_top_level_mismatch_fields), `${routeCase.name}/${scenario.name} mismatch fields must be array`);

  if (scenario.expectMode) {
    assert(responseBody.authoritative_summary_mode === scenario.expectMode, `${routeCase.name}/${scenario.name} authoritative mode mismatch`);
  }

  const payload = extractPayloadObject(routeCase, responseBody);
  const decisionField = routeCase.decisionKey;
  const readyFlagField = routeCase.readyFlagKey;
  const responseDecision = normalizeText(payload?.[decisionField]);
  const authoritativeDecision = normalizeText(responseBody?.authoritative_summary?.[decisionField]);
  if (responseDecision && authoritativeDecision) {
    assert(responseDecision === authoritativeDecision, `${routeCase.name}/${scenario.name} payload decision drift from authoritative summary`);
  }
  if (readyFlagField) {
    assert(
      Object.prototype.hasOwnProperty.call(payload, readyFlagField),
      `${routeCase.name}/${scenario.name} missing payload ready flag '${readyFlagField}'`
    );
    const responseReady = Boolean(payload?.[readyFlagField]);
    const authoritativeReady = Boolean(responseBody?.authoritative_summary?.[readyFlagField]);
    assert(responseReady === authoritativeReady, `${routeCase.name}/${scenario.name} payload ready flag drift from authoritative summary`);
  }
}

function assertResponseAuditConsistency(routeCase, scenario, responseBody, auditDetails) {
  assert(
    normalizeText(auditDetails?.authoritative_summary_mode) === normalizeText(responseBody?.authoritative_summary_mode),
    `${routeCase.name}/${scenario.name} audit authoritative_summary_mode mismatch`
  );
  assert(
    normalizeText(auditDetails?.legacy_top_level_match_scope) === normalizeText(responseBody?.legacy_top_level_match_scope),
    `${routeCase.name}/${scenario.name} audit legacy_top_level_match_scope mismatch`
  );
  assert(
    Boolean(auditDetails?.legacy_top_level_matches_authoritative) === Boolean(responseBody?.legacy_top_level_matches_authoritative),
    `${routeCase.name}/${scenario.name} audit legacy_top_level_matches_authoritative mismatch`
  );
  const responseMismatch = normalizeFieldList(responseBody?.legacy_top_level_mismatch_fields);
  const auditMismatch = normalizeFieldList(auditDetails?.legacy_top_level_mismatch_fields);
  assert(
    listsEqual(responseMismatch, auditMismatch),
    `${routeCase.name}/${scenario.name} audit mismatch fields drift`
  );
}

function runComparatorTargetedChecks() {
  const source = fs.readFileSync(path.join(CWD, "server", "index.mjs"), "utf8");
  const start = source.indexOf("const ASSIGNMENT_EVALUATE_ROUTE_CONFIG");
  const end = source.indexOf("function createRateLimiter");
  assert(start >= 0 && end > start, "unable to isolate comparator snippet from server/index.mjs");
  const snippet = source.slice(start, end);
  const context = {};
  vm.runInNewContext(`${snippet}\nthis.__exports = { ASSIGNMENT_EVALUATE_ROUTE_CONFIG, buildEvaluateAuthoritativeContract };`, context);
  const routeConfigMap = context.__exports.ASSIGNMENT_EVALUATE_ROUTE_CONFIG;
  const buildContract = context.__exports.buildEvaluateAuthoritativeContract;

  const routeCases = [
    { name: "submission", config: routeConfigMap.submission, sampleDecision: "accept", alternateDecision: "block" },
    { name: "governance", config: routeConfigMap.governance, sampleDecision: "ready", alternateDecision: "hold" },
    { name: "handoff", config: routeConfigMap.handoff, sampleDecision: "ready", alternateDecision: "block" },
  ];

  function assertMismatchFields(result, expectedFields, message) {
    const actual = normalizeFieldList(result?.legacy_top_level_mismatch_fields);
    const expected = normalizeFieldList(expectedFields);
    assert(listsEqual(actual, expected), `${message} mismatch fields expected=${expected.join(",")} actual=${actual.join(",")}`);
  }

  function buildFixture({
    decisionKey,
    readyFlagKey,
    reasonCodesKey,
    legacyDecision,
    authoritativeDecision,
    legacyReady,
    authoritativeReady,
    legacyCodes,
    authoritativeCodes,
  }) {
    return {
      [decisionKey]: legacyDecision,
      [readyFlagKey]: legacyReady,
      [reasonCodesKey]: legacyCodes,
      raw_summary: {
        [decisionKey]: authoritativeDecision,
        [readyFlagKey]: authoritativeReady,
        [reasonCodesKey]: authoritativeCodes,
      },
      effective_summary: {
        [decisionKey]: authoritativeDecision,
        [readyFlagKey]: authoritativeReady,
        [reasonCodesKey]: authoritativeCodes,
      },
      raw_effective_diverged: true,
    };
  }

  for (const routeCase of routeCases) {
    const decisionKey = String(routeCase.config?.decisionKey || "").trim();
    const readyFlagKey = String(routeCase.config?.readyFlagKey || "").trim();
    const reasonCodesKey = String(routeCase.config?.reasonCodesKey || "reason_codes").trim() || "reason_codes";
    assert(decisionKey && readyFlagKey, `${routeCase.name}: decision/ready keys are required`);

    const decisionMismatchCase = buildFixture({
      decisionKey,
      readyFlagKey,
      reasonCodesKey,
      legacyDecision: routeCase.alternateDecision,
      authoritativeDecision: routeCase.sampleDecision,
      legacyReady: true,
      authoritativeReady: true,
      legacyCodes: ["r_one", "r_two"],
      authoritativeCodes: ["r_one", "r_two"],
    });
    const decisionMismatch = buildContract(decisionMismatchCase, routeCase.config, { hasOverrideInput: true });
    assert(decisionMismatch.legacy_top_level_match_scope === "reason_semantic", `${routeCase.name}: scope should be reason_semantic`);
    assert(decisionMismatch.legacy_top_level_matches_authoritative === false, `${routeCase.name}: decision mismatch should fail`);
    assertMismatchFields(decisionMismatch, [decisionKey], `${routeCase.name}: decision mismatch`);

    const readyMismatchCase = buildFixture({
      decisionKey,
      readyFlagKey,
      reasonCodesKey,
      legacyDecision: routeCase.sampleDecision,
      authoritativeDecision: routeCase.sampleDecision,
      legacyReady: false,
      authoritativeReady: true,
      legacyCodes: ["r_one", "r_two"],
      authoritativeCodes: ["r_one", "r_two"],
    });
    const readyMismatch = buildContract(readyMismatchCase, routeCase.config, { hasOverrideInput: true });
    assert(readyMismatch.legacy_top_level_matches_authoritative === false, `${routeCase.name}: ready mismatch should fail`);
    assertMismatchFields(readyMismatch, [readyFlagKey], `${routeCase.name}: ready mismatch`);

    const orderInsensitiveCase = buildFixture({
      decisionKey,
      readyFlagKey,
      reasonCodesKey,
      legacyDecision: routeCase.sampleDecision,
      authoritativeDecision: routeCase.sampleDecision,
      legacyReady: true,
      authoritativeReady: true,
      legacyCodes: ["r_two", "r_one"],
      authoritativeCodes: ["r_one", "r_two"],
    });
    const sameSetDifferentOrder = buildContract(orderInsensitiveCase, routeCase.config, { hasOverrideInput: true });
    assert(sameSetDifferentOrder.legacy_top_level_matches_authoritative === true, `${routeCase.name}: reason order should be ignored`);
    assertMismatchFields(sameSetDifferentOrder, [], `${routeCase.name}: reason same-set check`);

    const reasonMismatchCase = buildFixture({
      decisionKey,
      readyFlagKey,
      reasonCodesKey,
      legacyDecision: routeCase.sampleDecision,
      authoritativeDecision: routeCase.sampleDecision,
      legacyReady: true,
      authoritativeReady: true,
      legacyCodes: ["alpha"],
      authoritativeCodes: ["beta"],
    });
    const reasonMismatch = buildContract(reasonMismatchCase, routeCase.config, { hasOverrideInput: true });
    assert(reasonMismatch.legacy_top_level_matches_authoritative === false, `${routeCase.name}: reason mismatch should fail`);
    assertMismatchFields(reasonMismatch, [reasonCodesKey], `${routeCase.name}: reason mismatch`);
  }
}

async function main() {
  const runComparator = VERIFY_MODE === "all" || VERIFY_MODE === "comparator";
  const runE2E = VERIFY_MODE === "all" || VERIFY_MODE === "e2e";

  if (runComparator) {
    runComparatorTargetedChecks();
  }

  if (!runE2E) {
    console.log("verify-evaluate-contract: comparator checks passed");
    return;
  }

  resolveVerifyAuth();

  const dirs = resolvePaths(path.resolve(CWD));
  const db = openDatabase(dirs.dbPath, path.join(dirs.rootDir, "database", "schema.sql"));
  const resolvedAssignmentId = resolveAssignmentId(db, ASSIGNMENT_ID);

  const server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: CWD,
    env: {
      ...process.env,
      PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServerReady(server);
    const token = await loginToken();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };

    const routeCases = [
      {
        name: "submission",
        endpoint: `/api/assignments/${resolvedAssignmentId}/submission-decision/evaluate`,
        responsePayloadKey: "decision",
        decisionKey: "submission_decision",
        readyFlagKey: "ready_for_handoff",
        auditAction: "assignment_submission.decision_evaluate",
        scenarios: [
          { name: "no_override", body: {}, expectMode: "raw" },
          { name: "valid_override", body: { debug_overrides: { submission_decision: "accept" } }, expectMode: "effective" },
          { name: "noop_invalid_debug", body: { debug_overrides: { unknown_key: true } }, expectMode: "raw" },
          { name: "noop_expected_empty", body: { expected_deliverables: [] }, expectMode: "raw" },
        ],
      },
      {
        name: "governance",
        endpoint: `/api/assignments/${resolvedAssignmentId}/deliverables/governance-summary/evaluate`,
        responsePayloadKey: "summary",
        decisionKey: "governance_decision",
        readyFlagKey: "ready_for_review",
        auditAction: "assignment_deliverables.governance_summary_evaluate",
        scenarios: [
          { name: "no_override", body: {}, expectMode: "raw" },
          { name: "valid_override", body: { debug_overrides: { governance_decision: "request_more" } }, expectMode: "effective" },
          { name: "noop_invalid_debug", body: { debug_overrides: { unknown_key: true } }, expectMode: "raw" },
          { name: "noop_expected_empty", body: { expected_deliverables: [] }, expectMode: "raw" },
        ],
      },
      {
        name: "handoff",
        endpoint: `/api/assignments/${resolvedAssignmentId}/handoff-governance/evaluate`,
        responsePayloadKey: "summary",
        decisionKey: "handoff_governance_decision",
        readyFlagKey: "ready_for_handoff_governance",
        auditAction: "assignment_handoff.governance_evaluate",
        scenarios: [
          { name: "no_override", body: {}, expectMode: "raw" },
          { name: "valid_override", body: { debug_overrides: { handoff_governance_decision: "ready" } }, expectMode: "effective" },
          { name: "noop_invalid_debug", body: { debug_overrides: { unknown_key: true } }, expectMode: "raw" },
          { name: "noop_expected_empty", body: { expected_deliverables: [] }, expectMode: "raw" },
        ],
      },
    ];

    for (const routeCase of routeCases) {
      for (const scenario of routeCase.scenarios) {
        const response = await fetch(`${BASE_URL}${routeCase.endpoint}`, {
          method: "POST",
          headers,
          body: JSON.stringify(scenario.body),
        });
        const payload = await response.json();
        assert(response.ok, `${routeCase.name}/${scenario.name} HTTP failed: ${JSON.stringify(payload)}`);
        assertBaseContract(routeCase, scenario, payload);

        const row = db
          .prepare("SELECT details_json FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1")
          .get(routeCase.auditAction);
        assert(row, `${routeCase.name}/${scenario.name} missing audit row for ${routeCase.auditAction}`);
        const details = parseJsonSafe(row.details_json, {});
        assertResponseAuditConsistency(routeCase, scenario, payload, details);
      }
    }

    console.log(`verify-evaluate-contract: ${VERIFY_MODE} checks passed (assignment ${resolvedAssignmentId})`);
  } finally {
    if (!server.killed) {
      server.kill("SIGTERM");
      await delay(400);
      if (!server.killed) {
        server.kill("SIGKILL");
      }
    }
    if (typeof db?.close === "function") {
      db.close();
    }
  }
}

main().catch((err) => {
  console.error(`verify-evaluate-contract: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
