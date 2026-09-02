import { SUPPORTED_CONTENT_LANGS } from "../constants/languages.js";
import { cleanPlainText, cleanSlug, cleanUrl, LIMITS } from "./inputSanitizer.js";

export function validateSituationCreatePayload(body) {
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
        description: entry.description
          ? cleanPlainText(entry.description, { max: LIMITS.DESCRIPTION_MAX, field: `${lang}.description` })
          : null,
      };
    }

    const sort_order = body?.sort_order !== undefined && body?.sort_order !== null
      ? (Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : undefined)
      : undefined;
    const is_active = body?.is_active !== undefined && body?.is_active !== null
      ? (body.is_active === 0 || body.is_active === false ? 0 : 1)
      : undefined;
    const image_url = body?.image_url
      ? cleanUrl(body.image_url, { field: "image_url" })
      : null;

    return { ok: true, value: { slug, sort_order, is_active, image_url, translations } };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}

export function validateSituationUpdatePayload(body) {
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
          description: entry.description
            ? cleanPlainText(entry.description, { max: LIMITS.DESCRIPTION_MAX, field: `${lang}.description` })
            : null,
        };
      }
    }

    const value = { translations };
    if (body?.sort_order !== undefined) value.sort_order = Number(body.sort_order);
    if (body?.is_active !== undefined) value.is_active = body.is_active === 0 || body.is_active === false ? 0 : 1;
    if (body?.image_url !== undefined) value.image_url = body.image_url ? cleanUrl(body.image_url, { field: "image_url" }) : null;

    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}
