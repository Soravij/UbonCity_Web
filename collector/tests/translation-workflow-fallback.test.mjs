import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import { rerunProblemTranslations } from "../services/workflow.mjs";
import { createTranslationGenerator } from "../translation/service.mjs";
import { runAutomaticTranslationChecks } from "../quality/translation-checks.mjs";

test("rerunProblemTranslations falls back to draft source before publish", async () => {
  const translations = new Map();
  const translationRuns = [];
  const staleMarks = [];
  const auditLogs = [];

  const repo = {
    listPublishedArticles() {
      return [];
    },
    getPublishedArticleByItem() {
      return null;
    },
    getItem(itemId) {
      if (Number(itemId) !== 27) return null;
      return {
        id: 27,
        title: "The bull and flower cafe and eatery",
        summary: "Cafe and eatery in Ubon Ratchathani",
        description_clean: "Thai source content placeholder for pre-sync translation fallback.",
        meta_title: "The bull and flower cafe and eatery",
        meta_description: "Item metadata used to verify translation fallback before publish.",
        slug: "the-bull-and-flower-cafe-and-eatery",
        lang: "th",
        category: "cafes",
      };
    },
    latestDraftByItem(itemId) {
      if (Number(itemId) !== 27) return null;
      return {
        id: 101,
        draft_title: "The bull and flower cafe and eatery",
        excerpt: "Draft excerpt used for translation workflow fallback test.",
        body: "Draft body used for translation workflow fallback test before publish. This source should allow item-scoped translation generation without depending on published_articles.",
        meta_title: "The bull and flower cafe and eatery | UbonCity",
        meta_description: "Draft meta description used to generate translations before publish.",
        slug: "the-bull-and-flower-cafe-and-eatery",
      };
    },
    latestApprovedReviewByItem(itemId) {
      if (Number(itemId) !== 27) return null;
      return { id: 501 };
    },
    startTranslationRun(stage, inputCount, message) {
      translationRuns.push({ stage, inputCount, message });
      return "run-pre-sync";
    },
    finishTranslationRun(runUid, status, outputCount, failedCount, message) {
      translationRuns.push({ runUid, status, outputCount, failedCount, message });
    },
    markStaleTranslations(contentItemId, fingerprint) {
      staleMarks.push({ contentItemId, fingerprint });
    },
    getTranslation(contentItemId, lang) {
      return translations.get(`${contentItemId}:${lang}`) || null;
    },
    upsertTranslation(payload) {
      translations.set(`${payload.source_content_item_id}:${payload.lang}`, {
        ...payload,
        stale_flag: payload.stale_flag ? 1 : 0,
      });
    },
    listTranslations(contentItemId = null) {
      const rows = Array.from(translations.values());
      if (!contentItemId) return rows;
      return rows.filter((row) => Number(row.source_content_item_id) === Number(contentItemId));
    },
    logAudit(actorEmail, action, entityType, entityId, payload) {
      auditLogs.push({ actorEmail, action, entityType, entityId, payload });
    },
  };

  const result = await rerunProblemTranslations(repo, "admin@uboncity.local", {
    content_item_id: 27,
    aiConfig: null,
  });

  assert.equal(result.content_item_id, 27);
  assert.equal(result.translation_run.run_uid, "run-pre-sync");
  assert.equal(translationRuns[0].stage, "pre-sync-item");
  assert.equal(translationRuns[0].inputCount, 1);
  assert.equal(staleMarks[0].contentItemId, 27);
  assert.equal(result.totals.total, 3);
  assert.ok(result.totals.passed >= 1);

  for (const row of repo.listTranslations(27)) {
    assert.equal(row.source_published_article_id, null);
    assert.equal(row.source_draft_id, 101);
  }

  assert.equal(auditLogs.at(-1).action, "translation.final_stage");
});

test("rerunProblemTranslations can force regenerate ready translations", async () => {
  const translations = new Map();
  const translationRuns = [];

  const repo = {
    listPublishedArticles() {
      return [];
    },
    getPublishedArticleByItem() {
      return null;
    },
    getItem(itemId) {
      if (Number(itemId) !== 31) return null;
      return {
        id: 31,
        title: "Sample place",
        summary: "Sample summary",
        description_clean: "Sample clean description for translation testing.",
        meta_title: "Sample place",
        meta_description: "Sample meta description.",
        slug: "sample-place",
        lang: "th",
        category: "attractions",
      };
    },
    latestDraftByItem(itemId) {
      if (Number(itemId) !== 31) return null;
      return {
        id: 301,
        draft_title: "Sample place",
        excerpt: "Draft excerpt for translation test.",
        body: "Draft body for translation test that is long enough to satisfy fallback generation.",
        meta_title: "Sample place | UbonCity",
        meta_description: "Draft meta description for translation test.",
        slug: "sample-place",
      };
    },
    latestApprovedReviewByItem() {
      return null;
    },
    startTranslationRun(stage, inputCount, message) {
      translationRuns.push({ stage, inputCount, message });
      return "run-force-regen";
    },
    finishTranslationRun(runUid, status, outputCount, failedCount, message) {
      translationRuns.push({ runUid, status, outputCount, failedCount, message });
    },
    markStaleTranslations() {},
    getTranslation(contentItemId, lang) {
      return translations.get(`${contentItemId}:${lang}`) || null;
    },
    upsertTranslation(payload) {
      translations.set(`${payload.source_content_item_id}:${payload.lang}`, {
        ...payload,
        stale_flag: payload.stale_flag ? 1 : 0,
      });
    },
    listTranslations(contentItemId = null) {
      const rows = Array.from(translations.values());
      if (!contentItemId) return rows;
      return rows.filter((row) => Number(row.source_content_item_id) === Number(contentItemId));
    },
    logAudit() {},
  };

  const baseFingerprint = "31:301:0";
  for (const lang of ["en", "zh", "lo"]) {
    repo.upsertTranslation({
      source_content_item_id: 31,
      source_published_article_id: null,
      source_draft_id: 301,
      source_review_report_id: null,
      source_fingerprint: baseFingerprint,
      lang,
      translated_title: `ready-${lang}`,
      translated_excerpt: `ready-${lang}`,
      translated_body: `ready-${lang}`,
      translated_meta_title: `ready-${lang}`,
      translated_meta_description: `ready-${lang}`,
      translation_status: "ready",
      automatic_check_status: "passed",
      automatic_check_report: { status: "passed", issues: [] },
      stale_flag: 0,
      translator_engine: "deterministic",
      translator_model: "deterministic-v2",
    });
  }

  const result = await rerunProblemTranslations(repo, "admin@uboncity.local", {
    content_item_id: 31,
    aiConfig: null,
    forceRegenerate: true,
  });

  assert.equal(result.translation_run.run_uid, "run-force-regen");
  assert.equal(result.translation_run.generated_count, 3);
  assert.equal(result.totals.passed, 3);
});

test("rerunProblemTranslations falls back when translation provider has no api key", async () => {
  const translations = new Map();

  const repo = {
    listPublishedArticles() {
      return [];
    },
    getPublishedArticleByItem() {
      return null;
    },
    getItem(itemId) {
      if (Number(itemId) !== 32) return null;
      return {
        id: 32,
        title: "Sample fallback place",
        summary: "Sample fallback summary",
        description_clean: "Sample clean description for translation fallback without provider api key.",
        meta_title: "Sample fallback place",
        meta_description: "Sample fallback meta description.",
        slug: "sample-fallback-place",
        lang: "th",
        category: "attractions",
      };
    },
    latestDraftByItem(itemId) {
      if (Number(itemId) !== 32) return null;
      return {
        id: 302,
        draft_title: "Sample fallback place",
        excerpt: "Draft excerpt for missing key fallback test.",
        body: "Draft body for missing key fallback test that is long enough to satisfy translation generation checks.",
        meta_title: "Sample fallback place | UbonCity",
        meta_description: "Draft meta description for missing key fallback test.",
        slug: "sample-fallback-place",
      };
    },
    latestApprovedReviewByItem() {
      return null;
    },
    startTranslationRun() {
      return "run-no-key-fallback";
    },
    finishTranslationRun() {},
    markStaleTranslations() {},
    getTranslation(contentItemId, lang) {
      return translations.get(`${contentItemId}:${lang}`) || null;
    },
    upsertTranslation(payload) {
      translations.set(`${payload.source_content_item_id}:${payload.lang}`, {
        ...payload,
        stale_flag: payload.stale_flag ? 1 : 0,
      });
    },
    listTranslations(contentItemId = null) {
      const rows = Array.from(translations.values());
      if (!contentItemId) return rows;
      return rows.filter((row) => Number(row.source_content_item_id) === Number(contentItemId));
    },
    logAudit() {},
  };

  const result = await rerunProblemTranslations(repo, "admin@uboncity.local", {
    content_item_id: 32,
    aiConfig: {
      provider: "google",
      googleApiKey: "",
      features: {
        translation: {
          provider: "google",
          model: "gemini-2.5-flash-lite",
          apiKey: "",
        },
      },
    },
  });

  assert.equal(result.translation_run.generated_count, 3);
  assert.equal(result.totals.passed, 3);
});

test("google translator accepts generic feature apiKey/baseUrl fields", async () => {
  let requestedUrl = "";
  const server = http.createServer((req, res) => {
    requestedUrl = String(req.url || "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  translated_title: "Ubon attraction guide",
                  translated_excerpt: "Overview of this attraction in Ubon Ratchathani for travelers planning a visit.",
                  translated_body: "This page provides practical visitor information about the attraction in Ubon Ratchathani, including highlights, atmosphere, and basic planning details before arrival.",
                  translated_meta_title: "Ubon attraction guide | UbonCity",
                  translated_meta_description: "Travel information for this attraction in Ubon Ratchathani with highlights and planning notes.",
                }),
              },
            ],
          },
        },
      ],
    }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const translator = createTranslationGenerator({
      features: {
        translation: {
          provider: "google",
          model: "gemini-2.5-flash-lite",
          apiKey: "test-google-key",
          baseUrl: `http://127.0.0.1:${port}/v1beta`,
        },
      },
    });

    const translated = await translator.translate(
      {
        title: "88 Coffee Bean",
        excerpt: "Cafe in Ubon Ratchathani",
        body: "Thai source content placeholder that is long enough for translation validation.",
        meta_title: "88 Coffee Bean",
        meta_description: "Travel information for 88 Coffee Bean.",
        category: "cafes",
        source_lang: "th",
        slug: "88-coffee-bean",
      },
      "en",
    );

    assert.equal(translated._engine, "google");
    assert.equal(translated.translated_title, "Ubon attraction guide");
    assert.match(requestedUrl, /models\/gemini-2\.5-flash-lite:generateContent\?key=test-google-key/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("deterministic english translation stays in english shape for thai source", async () => {
  const translator = createTranslationGenerator(null);
  const translated = await translator.translate(
    {
      title: "\u0E40\u0E14\u0E2D\u0E30\u0E1A\u0E39\u0E25\u0E41\u0E2D\u0E19\u0E14\u0E4C\u0E1F\u0E25\u0E32\u0E27\u0E40\u0E27\u0E2D\u0E23\u0E4C",
      excerpt: "\u0E04\u0E32\u0E40\u0E1F\u0E48\u0E1A\u0E23\u0E23\u0E22\u0E32\u0E01\u0E32\u0E28\u0E2A\u0E27\u0E19\u0E43\u0E19\u0E2D\u0E38\u0E1A\u0E25\u0E23\u0E32\u0E0A\u0E18\u0E32\u0E19\u0E35",
      body: "\u0E40\u0E19\u0E37\u0E49\u0E2D\u0E2B\u0E32\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E22\u0E32\u0E27\u0E1E\u0E2D\u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A\u0E1A\u0E17\u0E04\u0E27\u0E32\u0E21\u0E17\u0E14\u0E2A\u0E2D\u0E1A translation \u0E41\u0E15\u0E48\u0E44\u0E21\u0E48\u0E04\u0E27\u0E23\u0E16\u0E39\u0E01\u0E19\u0E33\u0E44\u0E1B\u0E43\u0E0A\u0E49\u0E15\u0E23\u0E07 \u0E46 \u0E43\u0E19 output \u0E20\u0E32\u0E29\u0E32\u0E2D\u0E31\u0E07\u0E01\u0E24\u0E29",
      meta_title: "\u0E40\u0E14\u0E2D\u0E30\u0E1A\u0E39\u0E25\u0E41\u0E2D\u0E19\u0E14\u0E4C\u0E1F\u0E25\u0E32\u0E27\u0E40\u0E27\u0E2D\u0E23\u0E4C",
      meta_description: "\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E23\u0E49\u0E32\u0E19\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22",
      category: "cafes",
      source_lang: "th",
      slug: "the-bull-and-flower-cafe-and-eatery",
    },
    "en",
  );

  const check = runAutomaticTranslationChecks({
    target_lang: "en",
    source_fingerprint: "27:101:501",
    expected_source_fingerprint: "27:101:501",
    translated_title: translated.translated_title,
    translated_excerpt: translated.translated_excerpt,
    translated_body: translated.translated_body,
    translated_meta_title: translated.translated_meta_title,
    translated_meta_description: translated.translated_meta_description,
  });

  assert.equal(check.status, "passed");
});

test("compact translations can pass without minimum-length checks", () => {
  const check = runAutomaticTranslationChecks({
    target_lang: "zh",
    source_fingerprint: "46:201:601",
    expected_source_fingerprint: "46:201:601",
    translated_title: "乌汶景点指南",
    translated_excerpt: "提供乌汶景点重点信息。",
    translated_body: "这是乌汶景点简介，帮助游客了解主要看点与出行准备。",
    translated_meta_title: "乌汶景点指南 | 乌汶旅游",
    translated_meta_description: "乌汶景点旅游信息与参观建议。",
  });

  assert.equal(check.status, "passed");
});

test("short chinese meta title is not blocked", () => {
  const check = runAutomaticTranslationChecks({
    target_lang: "zh",
    source_fingerprint: "30:1:0",
    expected_source_fingerprint: "30:1:0",
    translated_title: "88 咖啡豆",
    translated_excerpt: "测试信息 测试信息 测试信息 测试信息 测试信息 测试信息",
    translated_body: "测试信息 测试信息 测试信息 测试信息 测试信息 测试信息 测试信息 测试信息 测试信息 测试信息",
    translated_meta_title: "88 咖啡豆",
    translated_meta_description: "测试信息 测试信息 测试信息 测试信息",
  });

  assert.equal(check.status, "passed");
  assert.ok(!check.issues.includes("translated_meta_title length out of range"));
});
