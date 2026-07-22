import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = "D:\\UbonCity_Web\\collector";
const source = fs.readFileSync(path.join(root, "server", "index.mjs"), "utf8");

function extractFunctionBlock(name) {
  const signature = `function ${name}`;
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const paramsStart = source.indexOf("(", start);
  if (paramsStart < 0) throw new Error(`Missing parameter list: ${name}`);
  let parenDepth = 0;
  let open = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(") parenDepth += 1;
    if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        open = source.indexOf("{", i);
        break;
      }
    }
  }
  if (open < 0) throw new Error(`Missing function body: ${name}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function block: ${name}`);
}

function loadTranslationGateHelper(rows, options = {}) {
  const targetLangs = options.targetLangs || ["en", "lo", "zh"];
  const itemLang = options.itemLang || "th";
  const currentSourceFingerprint = options.currentSourceFingerprint || "current-fingerprint";
  const context = {
    process: {
      env: {
        TRANSLATION_TARGET_LANGS: targetLangs.join(","),
      },
    },
    repo: {
      getItem() {
        return { id: 48, lang: itemLang };
      },
      listTranslations() {
        return rows;
      },
    },
    buildExportReadiness() {
      throw new Error("buildExportReadiness should not be called when readiness is provided");
    },
    getCurrentTranslationSourceFingerprint() {
      return currentSourceFingerprint;
    },
    isWorkflowTranslationRowStale(row, fingerprint) {
      return String(row?.source_fingerprint || "") !== String(fingerprint || "")
        || Number(row?.stale_flag || 0) === 1
        || String(row?.translation_status || "").trim().toLowerCase() === "stale";
    },
    isWorkflowTranslationTechnicalReady(row, fingerprint) {
      return String(row?.translation_status || "").trim().toLowerCase() === "ready"
        && String(row?.automatic_check_status || "").trim().toLowerCase() === "passed"
        && !context.isWorkflowTranslationRowStale(row, fingerprint);
    },
    isWorkflowTranslationRecheckPassed(row, fingerprint) {
      return context.isWorkflowTranslationTechnicalReady(row, fingerprint)
        && String(row?.translation_recheck_status || "").trim().toLowerCase() === "passed";
    },
    console,
  };
  const helperSource = `
${extractFunctionBlock("isTranslationTechnicalReady")}
${extractFunctionBlock("isTranslationRecheckPassed")}
${extractFunctionBlock("parseTargetLangs")}
${extractFunctionBlock("getRequiredTranslationRecheckBlockers")}
globalThis.__translationGateHooks = {
  getRequiredTranslationRecheckBlockers,
};
`;
  context.globalThis = context;
  vm.runInNewContext(helperSource, context, { filename: "translation-recheck-gate.js" });
  return context.__translationGateHooks.getRequiredTranslationRecheckBlockers;
}

function loadBackendSyncPayloadBuilder(options = {}) {
  const translations = options.translations || [];
  const published = options.published || [];
  const fingerprintByItemId = new Map(Object.entries(options.fingerprintByItemId || {}).map(([key, value]) => [Number(key), value]));
  const context = {
    hasExplicitCollectorPublicBaseUrl() {
      return true;
    },
    resolveCollectorPublicBaseUrl() {
      return "https://collector.example";
    },
    repo: {
      listPublishedArticles() {
        return published;
      },
      getItem(id) {
        return { id };
      },
      listTranslations(requestedId) {
        if (requestedId) {
          return translations.filter((row) => Number(row.source_content_item_id || 0) === Number(requestedId));
        }
        return translations;
      },
    },
    getCurrentTranslationSourceFingerprint(_repo, id) {
      return fingerprintByItemId.get(Number(id)) || "";
    },
    isTranslationRecheckPassed(row, fingerprint) {
      return String(row?.translation_status || "").trim().toLowerCase() === "ready"
        && String(row?.automatic_check_status || "").trim().toLowerCase() === "passed"
        && String(row?.translation_recheck_status || "").trim().toLowerCase() === "passed"
        && Number(row?.stale_flag || 0) === 0
        && String(row?.source_fingerprint || "") === String(fingerprint || "");
    },
    isOtherTransportItem() {
      return false;
    },
    getOtherTransportMetadata() {
      return null;
    },
    toPublishedMediaManifest() {
      return {};
    },
    toBackendSafeSlug(value, fallback) {
      return String(value || "").trim() || fallback;
    },
    console,
  };
  const helperSource = `
${extractFunctionBlock("parseReleaseSnapshotManifest")}
${extractFunctionBlock("projectMediaManifestForBackend")}
${extractFunctionBlock("buildBackendSyncPayload")}
globalThis.__backendSyncHooks = {
  buildBackendSyncPayload,
};
`;
  context.globalThis = context;
  vm.runInNewContext(helperSource, context, { filename: "backend-sync-payload.js" });
  return context.__backendSyncHooks.buildBackendSyncPayload;
}

function loadReleaseManifestHasher() {
  const context = { crypto };
  const helperSource = `
${extractFunctionBlock("manifestEntriesForReleaseHash")}
${extractFunctionBlock("hashReleaseManifest")}
globalThis.__releaseSnapshotHooks = { hashReleaseManifest };
`;
  context.globalThis = context;
  vm.runInNewContext(helperSource, context, { filename: "release-manifest-hash.js" });
  return context.__releaseSnapshotHooks.hashReleaseManifest;
}

test("article process routes exist with dedicated surface area", () => {
  assert.match(source, /app\.get\("\/api\/items\/:id\/article-process", requireRole\("owner", "admin", "editor", "user"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/article-process\/transition", requireRole\("owner", "admin", "editor", "user"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/article-editorial-assignments", requireRole\("owner", "admin", "user"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/article-editorial-assignments\/:assignmentId\/request-revision", requireRole\("owner", "admin", "user"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/recheck-export-readiness", requireRole\("admin", "owner"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/recover-problem-translations", requireRole\("admin", "owner"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/generate-translations", requireRole\("admin", "owner"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/translations\/:lang\/recheck", requireRole\("admin", "owner"\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/translations\/:lang\/repair", requireRole\("admin", "owner"\)/);
  assert.match(source, /app\.get\("\/api\/translations", requireRole\("owner", "admin", "editor", "user"\)/);
  assert.match(source, /content_item_id is required/);
  assert.match(source, /app\.get\("\/api\/translation-runs", requireRole\("owner", "admin"\)/);
  assert.match(source, /workflow_transitions:\s*workflowTransitions/);
  assert.match(source, /assignee_user_id or assignee_name is required/);
  assert.match(source, /assignee_name: isExternalAssignee \? externalAssigneeName : null/);
  assert.match(source, /assignee_contact: isExternalAssignee \? externalAssigneeContact : null/);
  assert.match(source, /per_language_status:/);
  assert.match(source, /generated_count:/);
  assert.match(source, /failed_count:/);
});

test("article process uses semantic status helpers without mutating legacy assignment routes", () => {
  assert.match(source, /function normalizeArticleProcessStatus\(value, fallback = ""\)/);
  assert.match(source, /function deriveArticleProcessStatus\(item, workflowModel = null, publishableSource = null\)/);
  assert.match(source, /function mapArticleProcessStatusToWorkflowPatch\(status\)/);
  assert.match(source, /function buildArticleProcessPayload\(req, item\)/);
  assert.match(source, /app\.post\("\/api\/items\/:id\/assignments", requireRole\("admin", "user"\),/);
});

test("release-main and admin-review use required locale translation recheck gate", () => {
  assert.match(source, /function getRequiredTranslationRecheckBlockers\(contentItemId, readiness = null\)/);
  assert.match(source, /const translationRecheckGate = getRequiredTranslationRecheckBlockers\(id, readiness\);/);
  assert.match(source, /if \(translationRecheckGate\.blocking\) \{\s*res\.status\(409\)\.json\(\{\s*error: "คำแปลยังไม่ผ่าน translation recheck สำหรับส่งออก",/);
  assert.match(source, /if \(translationRecheckGate\.blocking\) \{\s*res\.status\(409\)\.json\(\{\s*error: "คำแปลยังไม่ผ่าน translation recheck สำหรับส่งเข้า admin review",/);
  assert.match(source, /missing translation/);
  assert.match(source, /technical QA must pass first/);
  assert.match(source, /translation recheck is not passed/);
});

test("outbound payload builders use fingerprint-aware translation recheck filtering", () => {
  assert.match(source, /\.filter\(\(t\) => isTranslationRecheckPassed\(t, currentSourceFingerprint\)\)/);
  assert.doesNotMatch(source, /\.filter\(\(t\) => isTranslationRecheckPassed\(t\)\)/);
  assert.match(source, /const currentSourceFingerprint = contentItemId \? getCurrentTranslationSourceFingerprint\(repo, contentItemId\) : "";/);
});

test("bulk backend sync excludes passed translations whose source fingerprint mismatches current live source", () => {
  const buildBackendSyncPayload = loadBackendSyncPayloadBuilder({
    translations: [
      {
        source_content_item_id: 101,
        lang: "en",
        translated_title: "Keep me",
        translated_excerpt: "Keep me",
        translated_body: "Keep me",
        translated_meta_title: "Keep me",
        translated_meta_description: "Keep me",
        translation_status: "ready",
        automatic_check_status: "passed",
        translation_recheck_status: "passed",
        stale_flag: 0,
        source_fingerprint: "fp-101-current",
      },
      {
        source_content_item_id: 202,
        lang: "lo",
        translated_title: "Drop me",
        translated_excerpt: "Drop me",
        translated_body: "Drop me",
        translated_meta_title: "Drop me",
        translated_meta_description: "Drop me",
        translation_status: "ready",
        automatic_check_status: "passed",
        translation_recheck_status: "passed",
        stale_flag: 0,
        source_fingerprint: "fp-202-old",
      },
    ],
    published: [
      { content_item_id: 101, slug: "item-101" },
      { content_item_id: 202, slug: "item-202" },
    ],
    fingerprintByItemId: {
      101: "fp-101-current",
      202: "fp-202-current",
    },
  });

  const payload = buildBackendSyncPayload({});

  assert.deepEqual(
    payload.translations.map((row) => ({ id: row.source_content_item_id, lang: row.lang })),
    [{ id: 101, lang: "en" }],
  );
});

test("item-scoped backend sync uses the release snapshot instead of live selected assets", () => {
  const buildBackendSyncPayload = loadBackendSyncPayloadBuilder({
    published: [{ content_item_id: 101, slug: "snapshot-item", title: "Snapshot item" }],
    fingerprintByItemId: { 101: "fp-101-current" },
  });
  const snapshot = {
    release_id: "release-101",
    manifest_hash: "a".repeat(64),
    manifest: { authority: "release_main_selected_assets", cover: null, gallery: [], inline: [], video: [] },
  };
  const payload = buildBackendSyncPayload({ contentItemId: 101, releaseSnapshot: snapshot });

  assert.equal(payload.published[0].release_id, "release-101");
  assert.equal(payload.published[0].manifest_hash, "a".repeat(64));
  assert.equal(JSON.stringify(payload.published[0].media_manifest), JSON.stringify({ cover: null, gallery: [], inline: [] }));
  assert.equal("image" in payload.published[0], false);
  assert.equal("authority" in payload.published[0].media_manifest, false);
  assert.equal("video" in payload.published[0].media_manifest, false);
  assert.equal(
    JSON.stringify(snapshot.manifest),
    JSON.stringify({ authority: "release_main_selected_assets", cover: null, gallery: [], inline: [], video: [] }),
  );
  assert.throws(() => buildBackendSyncPayload({ contentItemId: 101 }), /release snapshot is required/);
});

test("release manifest hash tracks asset identity, checksum, role, position, and source URL", () => {
  const hashReleaseManifest = loadReleaseManifestHasher();
  const emptyManifest = { authority: "release_main_selected_assets", cover: null, gallery: [], inline: [], video: [] };
  const original = {
    ...emptyManifest,
    cover: { source_asset_id: 7, source_checksum: "checksum-a", source_url: "/media/a.jpg" },
  };
  const changedRole = { ...emptyManifest, gallery: [{ source_asset_id: 7, source_checksum: "checksum-a", source_url: "/media/a.jpg" }] };
  const changedChecksum = { ...original, cover: { ...original.cover, source_checksum: "checksum-b" } };

  assert.match(hashReleaseManifest(emptyManifest), /^[a-f0-9]{64}$/);
  assert.notEqual(hashReleaseManifest(original), hashReleaseManifest(changedRole));
  assert.notEqual(hashReleaseManifest(original), hashReleaseManifest(changedChecksum));
  assert.equal(
    hashReleaseManifest(original),
    hashReleaseManifest({ ...original, authority: "different-authority", video: [] }),
  );
});

test("required locale translation recheck gate allows release only when all required locales passed", () => {
  const getRequiredTranslationRecheckBlockers = loadTranslationGateHelper([
    {
      lang: "en",
      source_fingerprint: "current-fingerprint",
      translation_status: "ready",
      automatic_check_status: "passed",
      translation_recheck_status: "passed",
      stale_flag: 0,
    },
    {
      lang: "lo",
      source_fingerprint: "current-fingerprint",
      translation_status: "ready",
      automatic_check_status: "passed",
      translation_recheck_status: "passed",
      stale_flag: 0,
    },
    {
      lang: "zh",
      source_fingerprint: "current-fingerprint",
      translation_status: "ready",
      automatic_check_status: "passed",
      translation_recheck_status: "passed",
      stale_flag: 0,
    },
  ]);

  const readiness = {
    translations: [
      { lang: "en", status: "passed" },
      { lang: "lo", status: "passed" },
      { lang: "zh", status: "passed" },
    ],
  };

  const result = getRequiredTranslationRecheckBlockers(48, readiness);
  assert.equal(result.blocking, false);
  assert.deepEqual([...result.required_locales], ["en", "lo", "zh"]);
  assert.deepEqual([...result.blockers], []);
  assert.deepEqual([...result.blocking_langs], []);
});

test("required locale translation recheck gate reports missing translation from full required locale list", () => {
  const getRequiredTranslationRecheckBlockers = loadTranslationGateHelper([
    {
      lang: "en",
      source_fingerprint: "current-fingerprint",
      translation_status: "ready",
      automatic_check_status: "passed",
      translation_recheck_status: "passed",
      stale_flag: 0,
    },
    {
      lang: "lo",
      source_fingerprint: "current-fingerprint",
      translation_status: "ready",
      automatic_check_status: "passed",
      translation_recheck_status: "passed",
      stale_flag: 0,
    },
  ], { targetLangs: ["en", "lo", "zh"] });

  const result = getRequiredTranslationRecheckBlockers(48, {
    translations: [
      { lang: "en", status: "passed" },
      { lang: "lo", status: "passed" },
    ],
  });

  assert.equal(result.blocking, true);
  assert.deepEqual([...result.blocking_langs], ["ZH"]);
  assert.equal(result.blockers[0]?.reason, "missing translation");
});

test("required locale translation recheck gate still blocks when readiness translations omit a required locale entry", () => {
  const getRequiredTranslationRecheckBlockers = loadTranslationGateHelper([
    {
      lang: "en",
      source_fingerprint: "current-fingerprint",
      translation_status: "ready",
      automatic_check_status: "passed",
      translation_recheck_status: "passed",
      stale_flag: 0,
    },
    {
      lang: "lo",
      source_fingerprint: "current-fingerprint",
      translation_status: "ready",
      automatic_check_status: "passed",
      translation_recheck_status: "passed",
      stale_flag: 0,
    },
  ], { targetLangs: ["en", "lo", "zh"] });

  const result = getRequiredTranslationRecheckBlockers(48, {
    translations: [
      { lang: "en", status: "passed" },
      { lang: "lo", status: "passed" },
    ],
  });

  assert.equal(result.blocking, true);
  assert.deepEqual([...result.blocking_langs], ["ZH"]);
  assert.equal(result.blockers[0]?.reason, "missing translation");
});

test("required locale translation recheck gate reports not_checked warning failed stale and technical QA blockers", () => {
  const cases = [
    {
      name: "not_checked",
      row: {
        lang: "en",
        source_fingerprint: "current-fingerprint",
        translation_status: "ready",
        automatic_check_status: "passed",
        translation_recheck_status: "not_checked",
        stale_flag: 0,
      },
      expected: "translation recheck is not passed (not_checked)",
    },
    {
      name: "warning",
      row: {
        lang: "en",
        source_fingerprint: "current-fingerprint",
        translation_status: "ready",
        automatic_check_status: "passed",
        translation_recheck_status: "warning",
        stale_flag: 0,
      },
      expected: "translation recheck is not passed (warning)",
    },
    {
      name: "failed",
      row: {
        lang: "en",
        source_fingerprint: "current-fingerprint",
        translation_status: "ready",
        automatic_check_status: "passed",
        translation_recheck_status: "failed",
        stale_flag: 0,
      },
      expected: "translation recheck is not passed (failed)",
    },
    {
      name: "stale",
      row: {
        lang: "en",
        source_fingerprint: "current-fingerprint",
        translation_status: "ready",
        automatic_check_status: "passed",
        translation_recheck_status: "passed",
        stale_flag: 1,
      },
      expected: "translation is stale",
    },
    {
      name: "not ready",
      row: {
        lang: "en",
        source_fingerprint: "current-fingerprint",
        translation_status: "draft",
        automatic_check_status: "passed",
        translation_recheck_status: "passed",
        stale_flag: 0,
      },
      expected: "translation is missing or not ready",
    },
    {
      name: "technical QA failed",
      row: {
        lang: "en",
        source_fingerprint: "current-fingerprint",
        translation_status: "ready",
        automatic_check_status: "failed",
        translation_recheck_status: "passed",
        stale_flag: 0,
      },
      expected: "technical QA must pass first",
    },
  ];

  for (const entry of cases) {
    const getRequiredTranslationRecheckBlockers = loadTranslationGateHelper([entry.row], { targetLangs: ["en"] });
    const result = getRequiredTranslationRecheckBlockers(48, {
      translations: [{ lang: "en", status: "passed" }],
    });
    assert.equal(result.blocking, true, entry.name);
    assert.deepEqual([...result.blocking_langs], ["EN"], entry.name);
    assert.equal(result.blockers[0]?.reason, entry.expected, entry.name);
  }
});

test("required locale translation recheck gate blocks fingerprint mismatch even when stale_flag is 0", () => {
  const getRequiredTranslationRecheckBlockers = loadTranslationGateHelper([
    {
      lang: "en",
      source_fingerprint: "old-fingerprint",
      translation_status: "ready",
      automatic_check_status: "passed",
      translation_recheck_status: "passed",
      stale_flag: 0,
    },
  ], { targetLangs: ["en"], currentSourceFingerprint: "current-fingerprint" });

  const result = getRequiredTranslationRecheckBlockers(48, {
    current_source_fingerprint: "current-fingerprint",
    translations: [{ lang: "en", status: "passed" }],
  });

  assert.equal(result.blocking, true);
  assert.deepEqual([...result.blocking_langs], ["EN"]);
  assert.equal(result.blockers[0]?.reason, "translation is stale");
});

test("composer media helper no longer emits prep-claim errors before article access fallback", () => {
  assert.match(source, /function hasPrepItemEditAccess\(req, item\)/);
  assert.match(source, /function ensureComposerMediaEditAccess\(req, res, item\) \{\s*if \(hasPrepItemEditAccess\(req, item\)\) \{\s*return true;\s*\}\s*return ensureArticleComposerEditAccess\(req, res, item\);\s*\}/);
  assert.doesNotMatch(source, /function ensureComposerMediaEditAccess\(req, res, item\) \{\s*if \(ensurePrepItemEditAccess\(req, res, item\)\)/);
});

test("collector cors always allows exact same-origin requests before cross-origin allowlist checks", () => {
  assert.match(source, /const forwardedHost = String\(req\.header\("x-forwarded-host"\) \|\| req\.header\("host"\) \|\| ""\)\.trim\(\);/);
  assert.match(source, /const requestOrigin = forwardedHost[\s\S]*normalizeOrigin\(/);
  assert.match(source, /const sameOrigin = origin && requestOrigin && origin === requestOrigin;/);
  assert.match(source, /const ok = sameOrigin \|\| \(allowed\.length \? allowed\.includes\(origin\) : \/\^https\?:\\\/\\\/\(localhost\|127\\\.0\\\.0\\\.1\)\(:\\d\+\)\?\$\/i\.test\(origin\)\);/);
});
