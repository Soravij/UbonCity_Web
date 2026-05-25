function toStr(value) {
  return String(value ?? "").trim();
}

function countMatches(text, regex) {
  const m = String(text || "").match(regex);
  return m ? m.length : 0;
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

  const langSample = [translatedTitle, translatedMetaTitle, translatedBody.slice(0, 1000)].join("\n");
  if (!isLanguageShapeLikely(targetLang, langSample)) {
    issues.push("target language shape mismatch");
  }

  if (leakageTooHigh(targetLang, translatedBody)) {
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

  return {
    status: issues.length ? "failed" : "passed",
    issues,
  };
}
