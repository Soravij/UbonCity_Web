function toStr(value) {
  return String(value ?? "").trim();
}

function countMatches(text, regex) {
  const m = String(text || "").match(regex);
  return m ? m.length : 0;
}

function isDebugDiagnosticsEnabled() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
}

function previewText(value, limit = 240) {
  return String(value || "").trim().slice(0, limit);
}

function stripHtmlTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function classifyScriptUsage(text) {
  const value = String(text || "");
  const total = value.length || 1;

  const thai = countMatches(value, /[\u0E00-\u0E7F]/g);
  const lao = countMatches(value, /[\u0E80-\u0EFF]/g);
  const cjk = countMatches(value, /[\u4E00-\u9FFF]/g);
  const latin = countMatches(value, /[A-Za-z]/g);

  return {
    thai_ratio: thai / total,
    lao_ratio: lao / total,
    cjk_ratio: cjk / total,
    latin_ratio: latin / total,
  };
}

function questionMarkRatio(value) {
  const text = String(value || "");
  if (!text.length) return 0;
  const q = (text.match(/\?/g) || []).length;
  return q / text.length;
}

function hasMojibake(value) {
  const text = String(value || "");
  return /�|Ã|Ð|Ñ|\?{3,}/.test(text) || questionMarkRatio(text) >= 0.35;
}

function hasUnresolvedPlaceholders(value) {
  return /\{\{[^}]+\}\}|__[^_]+__|\[\[.+?\]\]/.test(String(value || ""));
}

function isLanguageShapeLikely(lang, text) {
  const usage = classifyScriptUsage(text);
  if (lang === "en") return usage.latin_ratio >= 0.2 && usage.thai_ratio < 0.2 && usage.lao_ratio < 0.2;
  if (lang === "zh") return usage.cjk_ratio >= 0.1;
  if (lang === "lo") return usage.lao_ratio >= 0.1;
  if (lang === "th") return usage.thai_ratio >= 0.1;
  return true;
}

function leakageTooHigh(targetLang, text) {
  const usage = classifyScriptUsage(text);
  if (targetLang === "en") return usage.thai_ratio > 0.35 || usage.lao_ratio > 0.35;
  if (targetLang === "zh") return usage.thai_ratio > 0.4 || usage.lao_ratio > 0.4;
  if (targetLang === "lo") return usage.thai_ratio > 0.45;
  return false;
}

export function runAutomaticTranslationChecks(input) {
  const issues = [];

  const targetLang = String(input?.target_lang || "").trim().toLowerCase();
  const sourceFingerprint = toStr(input?.source_fingerprint);
  const expectedFingerprint = toStr(input?.expected_source_fingerprint);

  const translatedTitle = toStr(input?.translated_title);
  const translatedExcerpt = toStr(input?.translated_excerpt);
  const translatedBody = toStr(input?.translated_body);
  const translatedMetaTitle = toStr(input?.translated_meta_title);
  const translatedMetaDescription = toStr(input?.translated_meta_description);
  const strippedBody = stripHtmlTags(translatedBody);

  if (!translatedTitle) issues.push("missing translated_title");
  if (!translatedBody) issues.push("missing translated_body");
  if (!translatedMetaTitle) issues.push("missing translated_meta_title");
  if (!translatedMetaDescription) issues.push("missing translated_meta_description");

  const fields = [translatedTitle, translatedExcerpt, translatedBody, translatedMetaTitle, translatedMetaDescription];
  for (const field of fields) {
    if (hasMojibake(field)) {
      issues.push("mojibake detected");
      break;
    }
  }

  for (const field of fields) {
    if (hasUnresolvedPlaceholders(field)) {
      issues.push("unresolved placeholders detected");
      break;
    }
  }

  const langSample = [translatedTitle, translatedMetaTitle, strippedBody.slice(0, 1000)].join("\n");
  if (!isLanguageShapeLikely(targetLang, langSample)) {
    issues.push("target language shape mismatch");
  }

  if (leakageTooHigh(targetLang, strippedBody)) {
    issues.push("source language leakage too high");
  }

  if (translatedTitle.length < 4 || translatedTitle.length > 200) {
    issues.push("translated_title length out of range");
  }

  const minMetaTitleLength = targetLang === "zh" ? 0 : 8;
  if (translatedMetaTitle.length < minMetaTitleLength || translatedMetaTitle.length > 90) {
    issues.push("translated_meta_title length out of range");
  }

  if (translatedMetaDescription.length > 220) {
    issues.push("translated_meta_description length out of range");
  }

  if (!sourceFingerprint || sourceFingerprint !== expectedFingerprint) {
    issues.push("translation is not tied to latest source fingerprint");
  }

  const report = {
    status: issues.length ? "failed" : "passed",
    issues,
  };
  if (isDebugDiagnosticsEnabled()) {
    report.debug = {
      lang: targetLang,
      translated_title_preview: previewText(translatedTitle),
      translated_excerpt_preview: previewText(translatedExcerpt),
      translated_body_preview: previewText(translatedBody, 1000),
      body_length: translatedBody.length,
      detected_script_counts: {
        lang_sample: classifyScriptUsage(langSample),
        stripped_body: classifyScriptUsage(strippedBody),
      },
      automatic_check_reason_codes: issues.slice(),
      thresholds: {
        language_shape: {
          en: { latin_ratio_min: 0.2, thai_ratio_max: 0.2, lao_ratio_max: 0.2 },
          zh: { cjk_ratio_min: 0.1 },
          lo: { lao_ratio_min: 0.1 },
          th: { thai_ratio_min: 0.1 },
        },
        leakage: {
          en: { thai_ratio_max: 0.35, lao_ratio_max: 0.35 },
          zh: { thai_ratio_max: 0.4, lao_ratio_max: 0.4 },
          lo: { thai_ratio_max: 0.45 },
        },
        lengths: {
          translated_title_min: 4,
          translated_title_max: 200,
          translated_meta_title_min: targetLang === "zh" ? 0 : 8,
          translated_meta_title_max: 90,
          translated_meta_description_max: 220,
        },
      },
      html_tags_stripped_before_check: true,
    };
  }
  return report;
}
