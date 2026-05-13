import { SUPPORTED_CONTENT_LANGS, LANGUAGE_LABELS, normalizeContentLang } from "../constants/languages.js";
import { previewTranslateWithRetry } from "../services/translationService.js";
import { LIMITS, cleanPlainText, cleanRichText } from "../validators/inputSanitizer.js";

// Manual preview endpoint only.
// This endpoint does not persist data and is not part of draft/review/approve/publish lifecycle.
export const previewTranslateManual = async (req, res) => {
  try {
    const sourceLang = normalizeContentLang(req.body?.sourceLang, "th");

    let title = "";
    let description = "";
    try {
      title = cleanPlainText(req.body?.title, { required: true, max: LIMITS.TITLE_MAX, field: "title" });
      description = cleanRichText(req.body?.description, {
        required: true,
        max: LIMITS.DESCRIPTION_MAX,
        field: "description",
      });
    } catch (validationErr) {
      return res.status(400).json({
        error: String(validationErr?.message || "Invalid input"),
        preview_only: true,
        manual_only: true,
        lifecycle_participation: "none",
      });
    }

    if (!title || !description) {
      return res.status(400).json({
        error: "title and description are required",
        preview_only: true,
        manual_only: true,
        lifecycle_participation: "none",
      });
    }

    const targets = SUPPORTED_CONTENT_LANGS.filter((lang) => lang !== sourceLang);
    const result = {};

    for (const lang of targets) {
      const translated = await previewTranslateWithRetry({
        title,
        description,
        sourceLang,
        targetLang: lang,
        languageLabels: LANGUAGE_LABELS,
      });

      result[lang] = {
        title: translated.title,
        description: translated.description,
      };
    }

    return res.json({
      ...result,
      preview_only: true,
      manual_only: true,
      lifecycle_participation: "none",
      note:
        "Manual translation preview only. This endpoint is not used by draft/review/approve/publish/export lifecycle.",
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message?.includes("OPENAI_API_KEY")
        ? "Translation unavailable: OPENAI_API_KEY is not configured. Please set your OpenAI API key in the backend environment variables."
        : "Internal server error",
      preview_only: true,
      manual_only: true,
      lifecycle_participation: "none",
      hint: "If you're the admin, set OPENAI_API_KEY in your backend .env or hosting environment variables.",
    });
  }
};

// Backward-compatible alias for legacy imports.
export const autoTranslate = previewTranslateManual;

