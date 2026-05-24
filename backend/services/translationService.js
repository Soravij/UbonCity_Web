import OpenAI from "openai";
import { LANGUAGE_LABELS } from "../constants/languages.js";

function getBackendTranslationConfig() {
  const provider = String(process.env.TRANSLATION_AI_PROVIDER || "openai").trim().toLowerCase() || "openai";
  const openAiModel = String(process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
  const googleModel = String(process.env.GOOGLE_TRANSLATE_MODEL || process.env.GOOGLE_AI_MODEL || "gemini-2.0-flash").trim() || "gemini-2.0-flash";
  const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const googleApiKey = String(
    process.env.GOOGLE_AI_API_KEY
    || process.env.GEMINI_API_KEY
    || process.env.GOOGLE_API_KEY
    || ""
  ).trim();
  const googleBaseUrl = String(process.env.GOOGLE_AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta")
    .trim()
    .replace(/\/$/, "");
  return {
    provider: provider === "google" ? "google" : "openai",
    openAiModel,
    googleModel,
    openAiApiKey,
    googleApiKey,
    googleBaseUrl,
    hasOpenAI: openAiApiKey.length > 0,
    hasGoogle: googleApiKey.length > 0,
  };
}

export function noApiKeyStub() {
  const cfg = getBackendTranslationConfig();
  if (cfg.provider === "google") {
    throw new Error("Translation unavailable: GOOGLE_AI_API_KEY is not configured. Set your Google AI API key in backend environment variables.");
  }
  throw new Error("Translation unavailable: OPENAI_API_KEY is not configured. Set your OpenAI API key in backend environment variables.");
}

export function parseModelJson(rawText) {
  const text = String(rawText || "").trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenceMatch ? fenceMatch[1].trim() : text;

  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error("Model response is not valid JSON");
  }
}

function looksCorruptedTranslation(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  const qmarks = (text.match(/\?/g) || []).length;
  return qmarks >= 3 && qmarks / Math.max(text.length, 1) >= 0.3;
}

export function isInvalidTranslationPayload(payload) {
  const title = String(payload?.title || "").trim();
  const description = String(payload?.description || "").trim();
  if (!title || !description) return true;
  return looksCorruptedTranslation(title) || looksCorruptedTranslation(description);
}

async function requestPreviewTranslationOpenAI({
  title,
  description,
  sourceLang,
  targetLang,
  strict = false,
  keepImageMarkdown = false,
}) {
  const cfg = getBackendTranslationConfig();
  if (!cfg.hasOpenAI) {
    throw new Error("Translation unavailable: OPENAI_API_KEY is not configured. Set your OpenAI API key in backend environment variables.");
  }
  const strictLine = strict
    ? "If output contains question-mark placeholders like ???, regenerate proper target-language text."
    : "";
  const markdownLine = keepImageMarkdown
    ? "Keep markdown image tags exactly as original if present in description."
    : "";

  const openai = new OpenAI({ apiKey: cfg.openAiApiKey });
  const response = await openai.chat.completions.create({
    model: cfg.openAiModel,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a professional tourism translator for MANUAL PREVIEW ONLY. Return only JSON with keys title and description.",
      },
      {
        role: "user",
        content:
          `Source language: ${LANGUAGE_LABELS[sourceLang] || sourceLang} (${sourceLang})\n` +
          `Target language: ${LANGUAGE_LABELS[targetLang] || targetLang} (${targetLang})\n` +
          "Do not keep the original source text. The output must be fully in the target language.\n" +
          "For target lo, output must be in Lao language (not Thai).\n" +
          `${markdownLine}\n` +
          `${strictLine}\n\n` +
          `Title: ${title}\n` +
          `Description: ${description}`,
      },
    ],
  });

  const text = response.choices?.[0]?.message?.content;
  return parseModelJson(text);
}

async function requestPreviewTranslationGoogle({
  title,
  description,
  sourceLang,
  targetLang,
  strict = false,
  keepImageMarkdown = false,
}) {
  const cfg = getBackendTranslationConfig();
  if (!cfg.hasGoogle) {
    throw new Error("Translation unavailable: GOOGLE_AI_API_KEY is not configured. Set your Google AI API key in backend environment variables.");
  }
  const strictLine = strict
    ? "If output contains question-mark placeholders like ???, regenerate proper target-language text."
    : "";
  const markdownLine = keepImageMarkdown
    ? "Keep markdown image tags exactly as original if present in description."
    : "";
  const prompt =
    `Source language: ${LANGUAGE_LABELS[sourceLang] || sourceLang} (${sourceLang})\n` +
    `Target language: ${LANGUAGE_LABELS[targetLang] || targetLang} (${targetLang})\n` +
    "Do not keep the original source text. The output must be fully in the target language.\n" +
    "For target lo, output must be in Lao language (not Thai).\n" +
    `${markdownLine}\n` +
    `${strictLine}\n\n` +
    "Return only JSON with keys: title and description.\n" +
    `Title: ${title}\n` +
    `Description: ${description}`;

  const response = await fetch(
    `${cfg.googleBaseUrl}/models/${encodeURIComponent(cfg.googleModel)}:generateContent?key=${encodeURIComponent(cfg.googleApiKey)}`,
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
  const text = data?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === "string")?.text || "";
  return parseModelJson(text);
}

// Preview-only helper: this service is for explicit manual translation preview.
// It must not be used as an automatic lifecycle step (draft/review/approve/publish).
export async function requestPreviewTranslation(input) {
  const cfg = getBackendTranslationConfig();
  if (cfg.provider === "google") {
    return requestPreviewTranslationGoogle(input);
  }
  return requestPreviewTranslationOpenAI(input);
}

// Preview-only helper with retry. Human-triggered usage only.
export async function previewTranslateWithRetry(input) {
  const cfg = getBackendTranslationConfig();
  if (cfg.provider === "google" && !cfg.hasGoogle) {
    throw new Error("Translation unavailable: GOOGLE_AI_API_KEY is not configured. Set your Google AI API key in backend environment variables.");
  }
  if (cfg.provider !== "google" && !cfg.hasOpenAI) {
    throw new Error("Translation unavailable: OPENAI_API_KEY is not configured. Set your OpenAI API key in backend environment variables.");
  }

  let parsed = await requestPreviewTranslation(input);
  if (isInvalidTranslationPayload(parsed)) {
    parsed = await requestPreviewTranslation({ ...input, strict: true });
  }

  return {
    title: String(parsed?.title || "").trim(),
    description: String(parsed?.description || "").trim(),
  };
}

export const translateWithRetry = previewTranslateWithRetry;
export { getBackendTranslationConfig };
