import OpenAI from "openai";
import { LANGUAGE_LABELS } from "../constants/languages.js";

const MODEL_NAME = String(process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";

const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
const hasOpenAI = apiKey.length > 0;

const openai = hasOpenAI
  ? new OpenAI({ apiKey })
  : null;

// Stub for when no API key is configured
export function noApiKeyStub() {
  throw new Error("Translation unavailable: OPENAI_API_KEY is not configured. Set OPENAI_API_KEY in your backend environment variables.");
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

// Preview-only helper: this service is for explicit manual translation preview.
// It must not be used as an automatic lifecycle step (draft/review/approve/publish).
export async function requestPreviewTranslation({
  title,
  description,
  sourceLang,
  targetLang,
  strict = false,
  keepImageMarkdown = false,
}) {
  if (!hasOpenAI) {
    throw new Error("Translation unavailable: OPENAI_API_KEY is not configured. Set OPENAI_API_KEY in your backend environment variables.");
  }
  const strictLine = strict
    ? "If output contains question-mark placeholders like ???, regenerate proper target-language text."
    : "";

  const markdownLine = keepImageMarkdown
    ? "Keep markdown image tags exactly as original if present in description."
    : "";

  const response = await openai.chat.completions.create({
    model: MODEL_NAME,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a professional tourism translator for MANUAL PREVIEW ONLY. Return only JSON with keys title and description.",
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

// Preview-only helper with retry. Human-triggered usage only.
export async function previewTranslateWithRetry(input) {
  if (!hasOpenAI) {
    throw new Error("Translation unavailable: OPENAI_API_KEY is not configured. Set OPENAI_API_KEY in your backend environment variables.");
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

// Backward-compatible export name for existing callers.
export const translateWithRetry = previewTranslateWithRetry;
