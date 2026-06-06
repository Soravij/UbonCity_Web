import test from "node:test";
import assert from "node:assert/strict";

import * as workflow from "../services/workflow.mjs";

const { rerunProblemTranslations, rerunTranslationRecheck, repairTranslationFromRecheckIssues } = workflow;

test("workflow module exports rerunTranslationRecheck", () => {
  assert.equal(typeof workflow.rerunTranslationRecheck, "function");
});

test("workflow module exports repairTranslationFromRecheckIssues", () => {
  assert.equal(typeof workflow.repairTranslationFromRecheckIssues, "function");
});

test("buildSourceFingerprint stays the same when live content is identical but draft/review ids change", () => {
  const base = {
    content_item_id: 88,
    draft_id: 1001,
    review_report_id: 2001,
    source_kind: "assignment_publishable_source",
    source_lang: "th",
    category: "cafes",
    slug: "same-slug",
    title: "Same title",
    excerpt: "Same excerpt",
    body: "Same body",
    meta_title: "Same meta title",
    meta_description: "Same meta description",
  };
  const changedIdsOnly = {
    ...base,
    draft_id: 1002,
    review_report_id: 2002,
  };

  assert.equal(
    workflow.buildSourceFingerprint(base),
    workflow.buildSourceFingerprint(changedIdsOnly),
  );
});

test("buildSourceFingerprint changes when live source content changes", () => {
  const base = {
    content_item_id: 89,
    source_kind: "assignment_publishable_source",
    source_lang: "th",
    category: "cafes",
    slug: "same-slug",
    title: "Same title",
    excerpt: "Same excerpt",
    body: "Same body",
    meta_title: "Same meta title",
    meta_description: "Same meta description",
  };
  const changed = {
    ...base,
    body: "Changed body content",
  };

  assert.notEqual(
    workflow.buildSourceFingerprint(base),
    workflow.buildSourceFingerprint(changed),
  );
});

function createRepo(itemId = 41) {
  const translations = new Map();
  return {
    listPublishedArticles() {
      return [];
    },
    getPublishedArticleByItem() {
      return null;
    },
    getItem(requestedItemId) {
      if (Number(requestedItemId) !== Number(itemId)) return null;
      return {
        id: itemId,
        title: "Sample translation source",
        summary: "Sample summary for translation recheck",
        description_clean: "Thai source body used for translation recheck workflow tests.",
        meta_title: "Sample translation source",
        meta_description: "Sample translation source meta description.",
        slug: "sample-translation-source",
        lang: "th",
        category: "cafes",
      };
    },
    buildPublishableSourceByItem() {
      return null;
    },
    latestDraftByItem(requestedItemId) {
      if (Number(requestedItemId) !== Number(itemId)) return null;
      return {
        id: 700 + Number(itemId),
        draft_title: "Sample translation source",
        excerpt: "Draft excerpt for translation recheck workflow tests.",
        body: "Draft body for translation recheck workflow tests with enough content to pass translation generation prerequisites.",
        meta_title: "Sample translation source | UbonCity",
        meta_description: "Draft meta description for translation recheck workflow tests.",
        slug: "sample-translation-source",
      };
    },
    latestApprovedReviewByItem() {
      return null;
    },
    startTranslationRun() {
      return `run-${itemId}`;
    },
    finishTranslationRun() {},
    markStaleTranslations(contentItemId, latestFingerprint) {
      for (const [key, row] of translations.entries()) {
        if (Number(row.source_content_item_id || 0) !== Number(contentItemId)) continue;
        if (String(row.source_fingerprint || "") === String(latestFingerprint || "")) {
          translations.set(key, { ...row, stale_flag: 0 });
          continue;
        }
        translations.set(key, {
          ...row,
          stale_flag: 1,
          translation_status: "stale",
          automatic_check_status: "failed",
          translation_recheck_status: "not_checked",
        });
      }
    },
    getTranslation(contentItemId, lang) {
      return translations.get(`${contentItemId}:${lang}`) || null;
    },
    upsertTranslation(payload) {
      const key = `${payload.source_content_item_id}:${payload.lang}`;
      const existing = translations.get(key) || {};
      translations.set(key, {
        ...existing,
        ...payload,
        stale_flag: payload.stale_flag ? 1 : 0,
        recheck_issues: Array.isArray(payload.recheck_issues) ? payload.recheck_issues : existing.recheck_issues || [],
      });
    },
    updateTranslationRecheck(contentItemId, lang, payload = {}) {
      const key = `${contentItemId}:${lang}`;
      const existing = translations.get(key) || {};
      const next = {
        ...existing,
        ...payload,
        lang,
        source_content_item_id: contentItemId,
        recheck_issues: Array.isArray(payload.recheck_issues) ? payload.recheck_issues : [],
      };
      translations.set(key, next);
      return next;
    },
    updateTranslationRepairResult(contentItemId, lang, payload = {}) {
      const key = `${contentItemId}:${lang}`;
      const existing = translations.get(key) || {};
      const next = {
        ...existing,
        ...payload,
        lang,
        source_content_item_id: contentItemId,
        translation_recheck_status: "not_checked",
        translation_recheck_score: null,
        accuracy_score: null,
        fluency_score: null,
        term_score: null,
        back_translation_th: null,
        recheck_summary_th: null,
        recheck_issues: [],
        recheck_model: null,
        rechecked_at: null,
      };
      translations.set(key, next);
      return next;
    },
    listTranslations(contentItemId = null) {
      const rows = Array.from(translations.values());
      if (!contentItemId) return rows;
      return rows.filter((row) => Number(row.source_content_item_id || 0) === Number(contentItemId));
    },
    logAudit() {},
  };
}

function createAiConfig() {
  return {
    enabled: true,
    backendApiBase: "https://backend.example/api",
    backendSyncToken: "sync-token",
    features: {
      translation: { provider: "openai", model: "gpt-5.4-mini", backendApiBase: "https://backend.example/api", backendSyncToken: "sync-token" },
      translationRecheck: { provider: "openai", model: "gpt-5.4-mini", backendApiBase: "https://backend.example/api", backendSyncToken: "sync-token" },
    },
  };
}

test("rerunProblemTranslations keeps regenerated rows at not_checked after technical QA passes", async () => {
  const repo = createRepo(41);
  const aiConfig = createAiConfig();
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push(JSON.parse(String(options.body || "{}")));
    const body = calls.at(-1);
    if (body.task === "translation_content") {
      const lang = String(body.prompt.match(/Target language code:\s*([a-z]+)/i)?.[1] || "").toLowerCase();
      if (lang === "zh") {
        return Response.json({ output_text: "{}" });
      }
      if (lang === "lo") {
        return Response.json({
          provider: "openai",
          model: "gpt-5.4-mini",
          output_text: JSON.stringify({
            translated_title: "ຫົວຂໍ້ພາສາລາວ",
            translated_excerpt: "ນີ້ແມ່ນຂໍ້ຄວາມສະຫຼຸບພາສາລາວທີ່ມີຄວາມຍາວພຽງພໍ",
            translated_body: "ນີ້ແມ່ນເນື້ອຫາພາສາລາວສໍາລັບທົດສອບການກວດຄຸນນະພາບຄໍາແປແລະຄວນຜ່ານການກວດເຕັກນິກ",
            translated_meta_title: "ຫົວຂໍ້ meta ພາສາລາວ",
            translated_meta_description: "ນີ້ແມ່ນ meta description ພາສາລາວທີ່ມີຄວາມຍາວພຽງພໍ",
          }),
        });
      }
      return Response.json({
        provider: "openai",
        model: "gpt-5.4-mini",
        output_text: JSON.stringify({
          translated_title: `title-${lang}`,
          translated_excerpt: `excerpt-${lang} with enough text`,
          translated_body: `body-${lang} with enough text for the automatic translation checks to pass cleanly.`,
          translated_meta_title: `meta-title-${lang}`,
          translated_meta_description: `meta-description-${lang} with enough text`,
        }),
      });
    }
    return Response.json({
      provider: "openai",
      model: "gpt-5.4-mini",
      output_text: JSON.stringify({
        status: "passed",
        overall_score: 8.6,
        accuracy_score: 8.5,
        fluency_score: 8.1,
        term_score: 8.7,
        back_translation_th: "แปลกลับเป็นไทยแบบตรงตัว",
        summary_th: "คุณภาพคำแปลโดยรวมดี",
        issues: [],
      }),
    });
  };

  try {
    await rerunProblemTranslations(repo, "admin@uboncity.local", {
      content_item_id: 41,
      aiConfig,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const rows = repo.listTranslations(41);
  const recheckCalls = calls.filter((entry) => entry.task === "translation_recheck");
  assert.equal(recheckCalls.length, 0);
  assert.equal(rows.find((row) => row.lang === "en")?.translation_recheck_status, "not_checked");
  assert.equal(rows.find((row) => row.lang === "lo")?.translation_recheck_status, "not_checked");
  assert.equal(rows.find((row) => row.lang === "zh")?.translation_recheck_status, "not_checked");
});

test("rerunTranslationRecheck normalizes stored result fields for an eligible locale", async () => {
  const repo = createRepo(55);
  const aiConfig = createAiConfig();
  const currentFingerprint = workflow.getCurrentTranslationSourceFingerprint(repo, 55);
  repo.upsertTranslation({
    source_content_item_id: 55,
    source_published_article_id: null,
    source_draft_id: 755,
    source_review_report_id: null,
    source_fingerprint: currentFingerprint,
    lang: "en",
    translated_title: "title-en",
    translated_excerpt: "excerpt-en with enough text",
    translated_body: "body-en with enough text for semantic recheck normalization.",
    translated_meta_title: "meta-title-en",
    translated_meta_description: "meta-description-en with enough text",
    translation_status: "ready",
    automatic_check_status: "passed",
    automatic_check_report: { status: "passed", issues: [] },
    translation_recheck_status: "not_checked",
    stale_flag: 0,
    translator_engine: "openai",
    translator_model: "gpt-5.4-mini",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || "{}"));
    assert.equal(body.task, "translation_recheck");
    return Response.json({
      provider: "openai",
      model: "gpt-5.4-mini",
      output_text: JSON.stringify({
        status: "passed",
        overall_score: 7.4,
        accuracy_score: 7.3,
        fluency_score: 7.8,
        term_score: 7.4,
        back_translation_th: "แปลกลับแบบไทย",
        summary_th: "มีจุดที่ควรเก็บรายละเอียดชื่อเฉพาะเพิ่ม",
        issues: [
          {
            type: "term",
            severity: "low",
            source_text: "อุบลราชธานี",
            target_text: "Ubon",
            problem_th: "ชื่อเฉพาะย่อเกินไป",
            suggestion_th: "ใช้ชื่อเต็มให้คงที่",
          },
        ],
      }),
    });
  };

  try {
    const result = await rerunTranslationRecheck(repo, "admin@uboncity.local", {
      content_item_id: 55,
      lang: "en",
      aiConfig,
    });
    assert.equal(result.completed_count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const row = repo.getTranslation(55, "en");
  assert.equal(row.translation_recheck_status, "warning");
  assert.equal(row.translation_recheck_score, 7.4);
  assert.equal(row.accuracy_score, 7.3);
  assert.equal(row.fluency_score, 7.8);
  assert.equal(row.term_score, 7.4);
  assert.equal(row.back_translation_th, "แปลกลับแบบไทย");
  assert.equal(Array.isArray(row.recheck_issues), true);
  assert.equal(row.recheck_issues[0]?.type, "term");
});

test("rerunTranslationRecheck rejects locales that did not pass technical QA", async () => {
  const repo = createRepo(56);
  const currentFingerprint = workflow.getCurrentTranslationSourceFingerprint(repo, 56);
  repo.upsertTranslation({
    source_content_item_id: 56,
    source_published_article_id: null,
    source_draft_id: 756,
    source_review_report_id: null,
    source_fingerprint: currentFingerprint,
    lang: "en",
    translated_title: "title-en",
    translated_excerpt: "excerpt-en",
    translated_body: "body-en",
    translated_meta_title: "meta-title-en",
    translated_meta_description: "meta-description-en",
    translation_status: "check_failed",
    automatic_check_status: "failed",
    automatic_check_report: { status: "failed", issues: ["technical QA failed"] },
    translation_recheck_status: "not_checked",
    stale_flag: 0,
    translator_engine: "openai",
    translator_model: "gpt-5.4-mini",
  });

  await assert.rejects(
    () => rerunTranslationRecheck(repo, "admin@uboncity.local", {
      content_item_id: 56,
      lang: "en",
      aiConfig: createAiConfig(),
    }),
    /not eligible for recheck/i,
  );
});

test("rerunTranslationRecheck rejects fingerprint-mismatched rows even when stale_flag is 0", async () => {
  const repo = createRepo(57);
  repo.upsertTranslation({
    source_content_item_id: 57,
    source_published_article_id: null,
    source_draft_id: 757,
    source_review_report_id: null,
    source_fingerprint: "v2:old-fingerprint",
    lang: "en",
    translated_title: "title-en",
    translated_excerpt: "excerpt-en",
    translated_body: "body-en",
    translated_meta_title: "meta-title-en",
    translated_meta_description: "meta-description-en",
    translation_status: "ready",
    automatic_check_status: "passed",
    automatic_check_report: { status: "passed", issues: [] },
    translation_recheck_status: "passed",
    stale_flag: 0,
    translator_engine: "openai",
    translator_model: "gpt-5.4-mini",
  });

  await assert.rejects(
    () => rerunTranslationRecheck(repo, "admin@uboncity.local", {
      content_item_id: 57,
      lang: "en",
      aiConfig: createAiConfig(),
    }),
    /not eligible for recheck/i,
  );
});

test("repairTranslationFromRecheckIssues rejects stale fingerprint mismatch", async () => {
  const repo = createRepo(58);
  repo.upsertTranslation({
    source_content_item_id: 58,
    source_published_article_id: null,
    source_draft_id: 758,
    source_review_report_id: null,
    source_fingerprint: "v2:old-fingerprint",
    lang: "en",
    translated_title: "title-en",
    translated_excerpt: "excerpt-en",
    translated_body: "body-en",
    translated_meta_title: "meta-title-en",
    translated_meta_description: "meta-description-en",
    translation_status: "ready",
    automatic_check_status: "passed",
    automatic_check_report: { status: "passed", issues: [] },
    translation_recheck_status: "warning",
    recheck_summary_th: "term issue",
    recheck_issues: [{ type: "term", severity: "medium", problem_th: "term mismatch", suggestion_th: "fix term" }],
    stale_flag: 0,
    repair_attempt_count: 0,
  });

  await assert.rejects(
    () => repairTranslationFromRecheckIssues(repo, 58, "en", createAiConfig(), "admin@uboncity.local"),
    /not eligible for repair/i,
  );
});

test("repairTranslationFromRecheckIssues rejects when no repairable recheck issues exist", async () => {
  const repo = createRepo(59);
  const currentFingerprint = workflow.getCurrentTranslationSourceFingerprint(repo, 59);
  repo.upsertTranslation({
    source_content_item_id: 59,
    source_published_article_id: null,
    source_draft_id: 759,
    source_review_report_id: null,
    source_fingerprint: currentFingerprint,
    lang: "en",
    translated_title: "title-en",
    translated_excerpt: "excerpt-en",
    translated_body: "body-en",
    translated_meta_title: "meta-title-en",
    translated_meta_description: "meta-description-en",
    translation_status: "ready",
    automatic_check_status: "passed",
    automatic_check_report: { status: "passed", issues: [] },
    translation_recheck_status: "warning",
    recheck_summary_th: "",
    recheck_issues: [],
    stale_flag: 0,
    repair_attempt_count: 0,
  });

  await assert.rejects(
    () => repairTranslationFromRecheckIssues(repo, 59, "en", createAiConfig(), "admin@uboncity.local"),
    /does not have repairable recheck issues/i,
  );
});

test("repairTranslationFromRecheckIssues updates translated fields and resets recheck to not_checked", async () => {
  const repo = createRepo(60);
  const aiConfig = createAiConfig();
  const currentFingerprint = workflow.getCurrentTranslationSourceFingerprint(repo, 60);
  repo.upsertTranslation({
    source_content_item_id: 60,
    source_published_article_id: null,
    source_draft_id: 760,
    source_review_report_id: null,
    source_fingerprint: currentFingerprint,
    lang: "en",
    translated_title: "old title",
    translated_excerpt: "old excerpt with enough text",
    translated_body: "old body with enough text for technical QA to pass before repair.",
    translated_meta_title: "old meta title",
    translated_meta_description: "old meta description with enough text",
    translation_status: "ready",
    automatic_check_status: "passed",
    automatic_check_report: { status: "passed", issues: [] },
    translation_recheck_status: "warning",
    translation_recheck_score: 7.1,
    accuracy_score: 7,
    fluency_score: 7.2,
    term_score: 7.1,
    back_translation_th: "back translation",
    recheck_summary_th: "fix term consistency",
    recheck_issues: [{ type: "term", severity: "medium", problem_th: "term mismatch", suggestion_th: "use full place name" }],
    rechecked_at: "2026-06-05T08:00:00.000Z",
    repair_attempt_count: 1,
    stale_flag: 0,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || "{}"));
    assert.equal(body.task, "translation_repair");
    return Response.json({
      provider: "openai",
      model: "gpt-5.4-mini",
      output_text: JSON.stringify({
        translated_title: "new repaired title",
        translated_excerpt: "new repaired excerpt with enough text",
        translated_body: "new repaired body with enough text for technical QA to pass cleanly after repair.",
        translated_meta_title: "new repaired meta title",
        translated_meta_description: "new repaired meta description with enough text",
      }),
    });
  };

  try {
    const saved = await repairTranslationFromRecheckIssues(repo, 60, "en", aiConfig, "admin@uboncity.local");
    assert.equal(saved.translated_title, "new repaired title");
    assert.equal(saved.translation_status, "ready");
    assert.equal(saved.automatic_check_status, "passed");
    assert.equal(saved.translation_recheck_status, "not_checked");
    assert.equal(saved.translation_recheck_score, null);
    assert.equal(saved.recheck_summary_th, null);
    assert.deepEqual(saved.recheck_issues, []);
    assert.equal(saved.repair_attempt_count, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
