import { SUPPORTED_CONTENT_LANGS } from "../constants/languages.js";
import { cleanPlainText, cleanSlug, LIMITS } from "./inputSanitizer.js";

export function validateShortcutCreatePayload(body) {
  try {
    const slug = cleanSlug(body?.slug, { required: true, field: "slug" });

    const rawTranslations = body?.translations;
    if (!rawTranslations || typeof rawTranslations !== "object" || Array.isArray(rawTranslations)) {
      return { ok: false, error: "translations is required" };
    }
    if (!rawTranslations.en || !rawTranslations.en.title) {
      return { ok: false, error: "English title is required" };
    }

    const translations = {};
    for (const lang of SUPPORTED_CONTENT_LANGS) {
      const entry = rawTranslations[lang];
      if (!entry || !entry.title) continue;
      translations[lang] = {
        title: cleanPlainText(entry.title, { required: true, max: LIMITS.TITLE_MAX, field: `${lang}.title` }),
      };
    }

    const sort_order = body?.sort_order !== undefined && body?.sort_order !== null
      ? (Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : undefined)
      : undefined;

    return { ok: true, value: { slug, sort_order, translations } };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}

export function validateShortcutUpdatePayload(body) {
  try {
    const rawTranslations = body?.translations;
    const translations = {};

    if (rawTranslations && typeof rawTranslations === "object" && !Array.isArray(rawTranslations)) {
      if (!rawTranslations.en || !rawTranslations.en.title) {
        return { ok: false, error: "English title is required" };
      }
      for (const lang of SUPPORTED_CONTENT_LANGS) {
        const entry = rawTranslations[lang];
        if (!entry || !entry.title) continue;
        translations[lang] = {
          title: cleanPlainText(entry.title, { required: true, max: LIMITS.TITLE_MAX, field: `${lang}.title` }),
        };
      }
    }

    const value = { translations };
    if (body?.sort_order !== undefined) value.sort_order = Number(body.sort_order);

    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}
