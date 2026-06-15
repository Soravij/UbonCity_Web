import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");

function extractFunctionSource(source, functionName) {
  const asyncMarker = `async function ${functionName}`;
  const marker = `function ${functionName}`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf("(", start);
  assert.notEqual(paramsStart, -1, `${functionName} should have params`);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") paramsDepth += 1;
    if (char === ")") {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf("{", index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${functionName}`);
}

function loadNamedFunction(sourceText, functionName, dependencies = {}) {
  const source = extractFunctionSource(sourceText, functionName);
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  return Function(...dependencyNames, `${source}; return ${functionName};`)(...dependencyValues);
}

function loadNamedAsyncFunction(sourceText, functionName, dependencies = {}) {
  const source = extractFunctionSource(sourceText, functionName);
  const dependencyNames = Object.keys(dependencies);
  const dependencyValues = Object.values(dependencies);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return AsyncFunction(...dependencyNames, `${source}; return ${functionName};`)(...dependencyValues);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseJson(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function normalizeStringListInput(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeOptionalUrlValue(value) {
  return String(value || "").trim() || null;
}

function normalizePrimaryCtaValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["map", "phone", "line"].includes(normalized) ? normalized : null;
}

function normalizeJsonSafeValue(value) {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value));
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return String(value || "").trim().length > 0;
}

function normalizeFieldReturnEvidence(rawValue) {
  const row = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : {};
  return {
    evidence_deliverable_id: row.evidence_deliverable_id == null || row.evidence_deliverable_id === ""
      ? null
      : Number(row.evidence_deliverable_id || 0) || null,
    evidence_source_url: String(row.evidence_source_url || "").trim() || null,
  };
}

const normalizeAssignmentRequestedCheckKeyPart = loadNamedFunction(appJs, "normalizeAssignmentRequestedCheckKeyPart");
const buildAssignmentRequestedCheckReturnKey = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnKey", {
  normalizeAssignmentRequestedCheckKeyPart,
});
const formatRequestedCheckSuggestedValue = loadNamedFunction(appJs, "formatRequestedCheckSuggestedValue");
const getAssignmentRequestedCheckGroupsFromHandoffPackage = loadNamedFunction(appJs, "getAssignmentRequestedCheckGroupsFromHandoffPackage", {
  normalizeAssignmentRequestedCheckKeyPart,
  buildAssignmentRequestedCheckReturnKey,
});
const getAssignmentRequestedCheckDefaultValue = loadNamedFunction(appJs, "getAssignmentRequestedCheckDefaultValue");
const buildAssignmentRequestedCheckReturnDraftFromHandoffPackage = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnDraftFromHandoffPackage", {
  getAssignmentRequestedCheckGroupsFromHandoffPackage,
  getAssignmentRequestedCheckDefaultValue,
});
const normalizeAssignmentRequestedCheckReturnDraft = loadNamedFunction(appJs, "normalizeAssignmentRequestedCheckReturnDraft", {
  buildAssignmentRequestedCheckReturnDraftFromHandoffPackage,
});
const buildAssignmentRequestedCheckReturnPayloadFromDraft = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnPayloadFromDraft", {
  normalizeAssignmentRequestedCheckReturnDraft,
});
const buildAssignmentRequestedCheckReturnValueInputHtml = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnValueInputHtml", {
  escapeHtml,
});
const buildAssignmentRequestedCheckReturnSectionHtml = loadNamedFunction(appJs, "buildAssignmentRequestedCheckReturnSectionHtml", {
  getAssignmentRequestedCheckGroupsFromHandoffPackage,
  normalizeAssignmentRequestedCheckReturnDraft,
  buildAssignmentRequestedCheckReturnValueInputHtml,
  formatRequestedCheckSuggestedValue,
  escapeHtml,
});
const rerenderAssignmentRequestedCheckSurfaces = loadNamedFunction(appJs, "rerenderAssignmentRequestedCheckSurfaces", {
  state: { assignments: { selectedId: 0 } },
  renderAssignmentHandoffBrief: () => {},
  renderAssignmentSubmissionForm: () => {},
  getAssignmentSubmissionFormAssignment: () => null,
  getAssignmentById: () => null,
  getAssignmentPageMode: () => "work",
});

const normalizeRequestedCheckAnswerType = loadNamedFunction(repositoryJs, "normalizeRequestedCheckAnswerType");
const normalizeRequestedCheckReturnKey = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnKey");
const inferRequestedCheckAnswerTypeFromReturnRow = loadNamedFunction(repositoryJs, "inferRequestedCheckAnswerTypeFromReturnRow", {
  normalizeRequestedCheckAnswerType,
  hasMeaningfulValue,
});
const normalizeRequestedCheckReturnValue = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnValue", {
  normalizeOptionalUrlValue,
  normalizeStringListInput,
  normalizeJsonSafeValue,
});
const normalizeRequestedCheckReturnEntry = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturnEntry", {
  inferRequestedCheckAnswerTypeFromReturnRow,
  normalizeFieldReturnEvidence,
  normalizeRequestedCheckReturnValue,
  hasMeaningfulValue,
});
const normalizeRequestedCheckReturns = loadNamedFunction(repositoryJs, "normalizeRequestedCheckReturns", {
  normalizeRequestedCheckReturnKey,
  normalizeRequestedCheckReturnEntry,
  parseJson,
});

test("requested-check section uses namespaced keys and keeps requested groups only", () => {
  const handoffPackage = {
    requested_checks: {
      version: 1,
      groups: [
        {
          group_key: "cta_contact",
          group_label: "CTA/ติดต่อ",
          checks: [
            {
              key: "phone",
              requested: true,
              label: "เบอร์โทร",
              instruction: "ให้ใส่เบอร์ที่ติดต่อได้จริง",
              answer_type: "phone",
              suggested_value: "0812345678",
              evidence_required: true,
            },
            {
              key: "line_url",
              requested: false,
              label: "LINE",
              instruction: "ไม่ควรถูกเรนเดอร์",
              answer_type: "url",
            },
          ],
        },
        {
          group_key: "taxonomy",
          group_label: "หมวดหมู่",
          checks: [
            {
              key: "phone",
              requested: true,
              label: "เบอร์สำรอง",
              instruction: "ต้องไม่ชนกับอีกกลุ่ม",
              answer_type: "text",
            },
          ],
        },
      ],
    },
  };

  const groups = getAssignmentRequestedCheckGroupsFromHandoffPackage(handoffPackage);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].checks[0].return_key, "cta_contact.phone");
  assert.equal(groups[1].checks[0].return_key, "taxonomy.phone");
  assert.deepEqual(
    [...new Set(groups.flatMap((group) => group.checks.map((check) => check.return_key)))].sort(),
    ["cta_contact.phone", "taxonomy.phone"]
  );

  const draft = buildAssignmentRequestedCheckReturnDraftFromHandoffPackage(handoffPackage);
  assert.deepEqual(draft.requested_check_returns["cta_contact.phone"].value, "");
  assert.deepEqual(draft.requested_check_returns["taxonomy.phone"].value, "");
  assert.equal(getAssignmentRequestedCheckDefaultValue("boolean"), null);
  assert.deepEqual(getAssignmentRequestedCheckDefaultValue("multi_select"), []);
  assert.deepEqual(getAssignmentRequestedCheckDefaultValue("number_with_unit"), { number: "", unit: "" });

  const sectionHtml = buildAssignmentRequestedCheckReturnSectionHtml(null, handoffPackage, draft);
  assert.ok(sectionHtml.includes('data-requested-check-return-key="cta_contact.phone"'));
  assert.ok(sectionHtml.includes('data-requested-check-return-key="taxonomy.phone"'));
  assert.ok(sectionHtml.includes("ข้อมูลที่ระบบแนะนำให้ตรวจ"));
  assert.equal(sectionHtml.includes("line_url"), false);
});

test("requested-check payload builder keeps field_return_payload_json separate and strips internal metadata", () => {
  const payload = buildAssignmentRequestedCheckReturnPayloadFromDraft({
    requested_check_returns: {
      "cta_contact.phone": {
        checked: true,
        value: "0812345678",
        condition_note: "โทรได้เฉพาะช่วงเย็น",
        evidence: "https://example.com/evidence",
        note: "ตรวจด้วยตา",
        answer_type: "phone",
        label: "เบอร์โทร",
        group_key: "cta_contact",
      },
      "taxonomy.tags": {
        checked: false,
        value: ["cafe", "family"],
        answer_type: "multi_select",
      },
    },
  });

  assert.deepEqual(payload, {
    requested_check_returns: {
      "cta_contact.phone": {
        checked: true,
        value: "0812345678",
        condition_note: "โทรได้เฉพาะช่วงเย็น",
        evidence: "https://example.com/evidence",
        note: "ตรวจด้วยตา",
      },
      "taxonomy.tags": {
        checked: false,
        value: ["cafe", "family"],
        condition_note: null,
        evidence: null,
        note: null,
      },
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload.requested_check_returns["cta_contact.phone"], "answer_type"), false);
});

test("requested-check return normalization infers runtime types from payload shape", () => {
  const normalized = normalizeRequestedCheckReturns({
    " CTA Contact . Phone ": { checked: true, value: "0812345678" },
    "taxonomy.tags": { checked: true, value: ["cafe", "family", "cafe"] },
    "custom.count": { checked: true, value: { number: 5, unit: "คน" } },
    "custom.flag": { checked: true, value: true, condition_note: "เฉพาะชั้นล่าง" },
    "custom.note": { checked: true, note: "มีบันได", value: null },
  });

  assert.ok(normalized["cta_contact.phone"]);
  assert.ok(normalized["taxonomy.tags"]);
  assert.ok(normalized["custom.count"]);
  assert.ok(normalized["custom.flag"]);
  assert.ok(normalized["custom.note"]);
  assert.equal(normalized["cta_contact.phone"].answer_type, "text");
  assert.equal(normalized["taxonomy.tags"].answer_type, "multi_select");
  assert.equal(normalized["custom.count"].answer_type, "number_with_unit");
  assert.equal(normalized["custom.flag"].answer_type, "boolean_with_conditions");
  assert.equal(normalized["custom.note"].answer_type, "note_only");
  assert.deepEqual(normalized["taxonomy.tags"].value, ["cafe", "family"]);
  assert.deepEqual(normalized["custom.count"].value, { number: 5, unit: "คน" });
  assert.equal(normalized["custom.flag"].condition_note, "เฉพาะชั้นล่าง");
  assert.equal(normalized["custom.note"].note, "มีบันได");
});

test("requested-check evidence free text persists through normalizer", () => {
  const normalized = normalizeRequestedCheckReturnEntry({
    checked: true,
    answer_type: "note_only",
    condition_note: "กลางแจ้งเท่านั้น",
    evidence: "ดูพื้นที่จริง",
    note: "มีป้ายชัดเจน",
  }, "field_return_payload_json.requested_check_returns.custom.parking");

  assert.equal(normalized.found, true);
  assert.equal(normalized.evidence, "ดูพื้นที่จริง");
  assert.equal(normalized.condition_note, "กลางแจ้งเท่านั้น");
  assert.equal(normalized.note, "มีป้ายชัดเจน");
});

test("requested-check evidence free text does not force found when unchecked", () => {
  const normalized = normalizeRequestedCheckReturnEntry({
    checked: false,
    answer_type: "note_only",
    evidence: "ดูพื้นที่จริง",
    note: "ignored while unchecked",
  }, "field_return_payload_json.requested_check_returns.custom.parking");

  assert.equal(normalized.found, false);
  assert.equal(normalized.evidence, null);
  assert.equal(normalized.value, null);
});

test("suggested value formatter from app.js renders without injected stub", () => {
  assert.equal(formatRequestedCheckSuggestedValue(["cafe", "family"], "multi_select"), "cafe\nfamily");
  assert.equal(formatRequestedCheckSuggestedValue(true, "boolean"), "true");
  assert.equal(formatRequestedCheckSuggestedValue({ number: 5, unit: "คัน" }, "number_with_unit"), JSON.stringify({ number: 5, unit: "คัน" }));
});

test("handoff source load rerenders brief and submission surfaces after async fetch", async () => {
  const calls = [];
  const state = {
    assignments: {
      selectedId: 12,
      handoffSourcePackages: {},
      handoffSourceLoaded: {},
    },
  };
  const renderAssignmentHandoffBriefSpy = () => {
    calls.push("brief");
  };
  const renderAssignmentSubmissionFormSpy = (value) => {
    calls.push(`submission:${value}`);
  };
  const loadAssignmentRequestedCheckHandoffSource = await loadNamedAsyncFunction(appJs, "loadAssignmentRequestedCheckHandoffSource", {
    state,
    isEditorUser: () => false,
    api: async () => ({
      handoff: {
        handoff_package_json: {
          requested_checks: {
            version: 1,
            groups: [
              {
                group_key: "cta_contact",
                group_label: "CTA/ติดต่อ",
                checks: [{ key: "phone", requested: true, label: "เบอร์โทร", answer_type: "phone" }],
              },
            ],
          },
        },
      },
    }),
    rerenderAssignmentRequestedCheckSurfaces: loadNamedFunction(appJs, "rerenderAssignmentRequestedCheckSurfaces", {
      state,
      renderAssignmentHandoffBrief: renderAssignmentHandoffBriefSpy,
      renderAssignmentSubmissionForm: renderAssignmentSubmissionFormSpy,
      getAssignmentSubmissionFormAssignment: (assignment, mode) => `${assignment?.id || 0}:${mode}`,
      getAssignmentById: (id) => ({ id }),
      getAssignmentPageMode: () => "work",
    }),
  });

  const result = await loadAssignmentRequestedCheckHandoffSource({ id: 12 });

  assert.ok(result?.requested_checks);
  assert.deepEqual(calls, ["brief", "submission:12:work"]);
  assert.equal(state.assignments.handoffSourceLoaded[12], true);
});
