function normalizeUtf8Text(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonLike(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function questionMarkRatio(value) {
  const text = String(value || "");
  if (!text.length) return 0;
  const q = (text.match(/\?/g) || []).length;
  return q / text.length;
}

function hasMojibakeSignals(value) {
  const text = normalizeUtf8Text(value);
  return /�|Ã|Ð|Ñ/.test(text) || /\?{3,}/.test(text) || questionMarkRatio(text) >= 0.35;
}

function sanitizeField(value) {
  const text = normalizeUtf8Text(value);
  return text.replace(/\?{3,}/g, "").trim();
}

function normalizePayload(input) {
  if (!input || typeof input !== "object") return null;
  return {
    translated_title: sanitizeField(input.translated_title),
    translated_excerpt: sanitizeField(input.translated_excerpt),
    translated_body: sanitizeField(input.translated_body),
    translated_meta_title: sanitizeField(input.translated_meta_title),
    translated_meta_description: sanitizeField(input.translated_meta_description),
  };
}

function ensureMinLength(text, min, fallbackText) {
  const value = normalizeUtf8Text(text);
  if (value.length >= min) return value;
  return normalizeUtf8Text(fallbackText);
}

function mapCategory(sourceCategory) {
  const key = String(sourceCategory || "attractions").trim().toLowerCase();
  const names = {
    attractions: { en: "attraction", zh: "景点", lo: "ສະຖານທີ່ທ່ຽວ" },
    activities: { en: "activity", zh: "活动", lo: "ກິດຈະກໍາ" },
    hotels: { en: "hotel", zh: "酒店", lo: "ໂຮງແຮມ" },
    cafes: { en: "cafe", zh: "咖啡馆", lo: "ຄາເຟ" },
    restaurants: { en: "restaurant", zh: "餐厅", lo: "ຮ້ານອາຫານ" },
    transport: { en: "transport", zh: "交通", lo: "ການເດີນທາງ" },
  };
  return names[key] || names.attractions;
}

function scriptRatio(text, regex) {
  const value = String(text || "");
  const total = value.length || 1;
  const count = (value.match(regex) || []).length;
  return count / total;
}

function hasScriptForLang(lang, value) {
  const text = String(value || "");
  if (lang === "zh") return /[\u4E00-\u9FFF]/.test(text);
  if (lang === "lo") return /[\u0E80-\u0EFF]/.test(text);
  if (lang === "th") return /[\u0E00-\u0E7F]/.test(text);
  if (lang === "en") return /[A-Za-z]/.test(text);
  return Boolean(text.trim());
}

function canReuseSourceForLang(lang, value) {
  const text = sanitizeField(value);
  if (!text) return false;
  if (lang === "en") {
    const latinRatio = scriptRatio(text, /[A-Za-z]/g);
    const thaiRatio = scriptRatio(text, /[\u0E00-\u0E7F]/g);
    const laoRatio = scriptRatio(text, /[\u0E80-\u0EFF]/g);
    const cjkRatio = scriptRatio(text, /[\u4E00-\u9FFF]/g);
    return latinRatio >= 0.35 && thaiRatio < 0.15 && laoRatio < 0.15 && cjkRatio < 0.15;
  }
  return hasScriptForLang(lang, text);
}

function safeSourceTitle(source) {
  const title = sanitizeField(source?.title);
  if (!title || hasMojibakeSignals(title) || title.length < 2) return "";
  return title;
}

function fallbackEnglish(source, categoryNames, sourceTitle) {
  const localizedSourceTitle = canReuseSourceForLang("en", sourceTitle) ? sourceTitle : "";
  const title = localizedSourceTitle || `Ubon ${categoryNames.en} guide`;
  const sourceExcerpt = sanitizeField(source?.excerpt);
  const sourceBody = sanitizeField(source?.body);
  const excerpt = ensureMinLength(
    canReuseSourceForLang("en", sourceExcerpt) ? sourceExcerpt : "",
    50,
    `Overview of this ${categoryNames.en} in Ubon Ratchathani, including highlights and practical travel context.`
  );
  const body = ensureMinLength(
    canReuseSourceForLang("en", sourceBody) ? sourceBody : "",
    80,
    `This page provides practical information for travelers visiting this ${categoryNames.en} in Ubon Ratchathani. It summarizes atmosphere, location context, and visit planning notes in a concise format suitable for the public website.`
  );

  return {
    translated_title: title,
    translated_excerpt: excerpt,
    translated_body: body,
    translated_meta_title: ensureMinLength(`${title} | UbonCity`, 8, "Ubon travel guide | UbonCity"),
    translated_meta_description: ensureMinLength(
      `Travel guide for this ${categoryNames.en} in Ubon Ratchathani with clear highlights and basic planning details.`,
      60,
      "Travel guide for Ubon Ratchathani attractions with clear highlights and planning details."
    ),
  };
}

function fallbackChinese(source, categoryNames, sourceTitle) {
  const localizedSourceTitle = hasScriptForLang("zh", sourceTitle) ? sourceTitle : "";
  const title = localizedSourceTitle || `乌汶${categoryNames.zh}指南`;
  const sourceExcerpt = sanitizeField(source?.excerpt);
  const sourceBody = sanitizeField(source?.body);
  const excerpt = ensureMinLength(
    hasScriptForLang("zh", sourceExcerpt) ? sourceExcerpt : "",
    30,
    `本页面提供乌汶府${categoryNames.zh}的重点信息，帮助游客快速了解看点与出行准备。`
  );
  const body = ensureMinLength(
    hasScriptForLang("zh", sourceBody) ? sourceBody : "",
    80,
    `这是面向游客的乌汶府${categoryNames.zh}简介页面，内容包含地点特点、参观氛围与基本行程建议，便于在出发前快速掌握实用信息。`
  );

  return {
    translated_title: title,
    translated_excerpt: excerpt,
    translated_body: body,
    translated_meta_title: ensureMinLength(`${title} | 乌汶旅游`, 8, "乌汶旅游指南"),
    translated_meta_description: ensureMinLength(
      `乌汶府${categoryNames.zh}旅游信息，包含亮点与基础行程建议，帮助游客高效规划。`,
      40,
      "乌汶府旅游信息与实用规划建议。"
    ),
  };
}

function fallbackLao(source, categoryNames, sourceTitle) {
  const localizedSourceTitle = hasScriptForLang("lo", sourceTitle) ? sourceTitle : "";
  const title = localizedSourceTitle || `ຄູ່ມື${categoryNames.lo} ອຸບົນ`;
  const sourceExcerpt = sanitizeField(source?.excerpt);
  const sourceBody = sanitizeField(source?.body);
  const excerpt = ensureMinLength(
    hasScriptForLang("lo", sourceExcerpt) ? sourceExcerpt : "",
    30,
    `ໜ້ານີ້ສະຫຼຸບຂໍ້ມູນສຳຄັນຂອງ${categoryNames.lo} ໃນອຸບົນ ເພື່ອຊ່ວຍໃຫ້ວາງແຜນເດີນທາງໄດ້ງ່າຍ.`
  );
  const body = ensureMinLength(
    hasScriptForLang("lo", sourceBody) ? sourceBody : "",
    80,
    `ນີ້ແມ່ນເນື້ອຫາແນະນຳ${categoryNames.lo} ໃນແຂວງອຸບົນຣາຊະທານີ ສຳລັບນັກທ່ອງທ່ຽວ. ຂໍ້ມູນປະກອບດ້ວຍຈຸດເດັ່ນ ແລະ ຂໍ້ຄວນຮູ້ພື້ນຖານກ່ອນເດີນທາງ.`
  );

  return {
    translated_title: title,
    translated_excerpt: excerpt,
    translated_body: body,
    translated_meta_title: ensureMinLength(`${title} | ທ່ຽວອຸບົນ`, 8, "ຄູ່ມືທ່ຽວອຸບົນ"),
    translated_meta_description: ensureMinLength(
      `ຂໍ້ມູນ${categoryNames.lo} ໃນອຸບົນ ພ້ອມຈຸດເດັ່ນ ແລະ ແນວທາງວາງແຜນເດີນທາງທີ່ໃຊ້ງານໄດ້ຈິງ.`,
      40,
      "ຂໍ້ມູນທ່ອງທ່ຽວອຸບົນພ້ອມແນວທາງວາງແຜນ."
    ),
  };
}

function deterministicTranslate(source, targetLang) {
  const lang = String(targetLang || "en").trim().toLowerCase();
  const categoryNames = mapCategory(source?.category);
  const titleSource = safeSourceTitle(source);

  if (lang === "zh") {
    const payload = fallbackChinese(source, categoryNames, titleSource);
    return { ...payload, _engine: "deterministic", _model: "deterministic-v2" };
  }

  if (lang === "lo") {
    const payload = fallbackLao(source, categoryNames, titleSource);
    return { ...payload, _engine: "deterministic", _model: "deterministic-v2" };
  }

  const payload = fallbackEnglish(source, categoryNames, titleSource);
  return { ...payload, _engine: "deterministic", _model: "deterministic-v2" };
}

function ensureValidModelPayload(payload) {
  const normalized = normalizePayload(payload);
  if (!normalized) return null;

  const fields = [
    normalized.translated_title,
    normalized.translated_excerpt,
    normalized.translated_body,
    normalized.translated_meta_title,
    normalized.translated_meta_description,
  ];

  if (fields.some((f) => !f)) return null;
  if (fields.some((f) => hasMojibakeSignals(f))) return null;

  return normalized;
}

async function openAiTranslate(source, targetLang, aiConfig) {
  const apiKey = String(aiConfig?.openAiApiKey || aiConfig?.apiKey || "").trim();
  const baseUrl = String(aiConfig?.openAiBaseUrl || aiConfig?.baseUrl || "https://api.openai.com/v1").trim().replace(/\/$/, "");
  const model = String(aiConfig?.translationModel || aiConfig?.model || "gpt-5-mini").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const prompt = [
    "Return ONLY valid JSON with keys:",
    "translated_title, translated_excerpt, translated_body, translated_meta_title, translated_meta_description",
    `Translate into target language: ${targetLang}`,
    "Do not include markdown fences.",
    "Preserve factual details; no hallucination.",
    "Input:",
    JSON.stringify(source, null, 2),
  ].join("\n");

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "text" } },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI error ${response.status}: ${body.slice(0, 220)}`);
  }

  const data = await response.json();
  const parsed = ensureValidModelPayload(parseJsonLike(String(data?.output_text || "")));
  if (!parsed) {
    throw new Error("Invalid translation JSON payload");
  }

  return { ...parsed, _engine: "openai", _model: model };
}

async function googleAiTranslate(source, targetLang, aiConfig) {
  const apiKey = String(aiConfig?.googleApiKey || "").trim();
  const baseUrl = String(aiConfig?.googleBaseUrl || "https://generativelanguage.googleapis.com/v1beta").trim().replace(/\/$/, "");
  const model = String(aiConfig?.translationModel || aiConfig?.googleModel || "gemini-2.0-flash").trim();
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is missing");
  }

  const prompt = [
    "Return ONLY valid JSON with keys:",
    "translated_title, translated_excerpt, translated_body, translated_meta_title, translated_meta_description",
    `Translate into target language: ${targetLang}`,
    "Do not include markdown fences.",
    "Preserve factual details; no hallucination.",
    "Input:",
    JSON.stringify(source, null, 2),
  ].join("\n");

  const response = await fetch(
    `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google AI error ${response.status}: ${body.slice(0, 220)}`);
  }

  const data = await response.json();
  const outputText = data?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === "string")?.text || "";
  const parsed = ensureValidModelPayload(parseJsonLike(String(outputText || "")));
  if (!parsed) {
    throw new Error("Invalid translation JSON payload");
  }

  return { ...parsed, _engine: "google", _model: model };
}

function createDeterministicTranslator() {
  return {
    async translate(source, targetLang) {
      return deterministicTranslate(source, targetLang);
    },
  };
}

export function createTranslationGenerator(aiConfig) {
  if (!aiConfig || typeof aiConfig !== "object") {
    return createDeterministicTranslator();
  }
  const translationConfig = aiConfig?.features?.translation && typeof aiConfig.features.translation === "object"
    ? aiConfig.features.translation
    : aiConfig;
  const provider = String(
    translationConfig?.provider
    || aiConfig?.translationProvider
    || aiConfig?.provider
    || "openai"
  ).trim().toLowerCase();
  return {
    async translate(source, targetLang) {
      if (provider === "google") {
        return googleAiTranslate(source, targetLang, translationConfig);
      }
      if (provider === "openai") {
        return openAiTranslate(source, targetLang, translationConfig);
      }
      throw new Error(`Unsupported translation provider: ${provider}`);
    },
  };
}
