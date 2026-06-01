import { normalizeContentLang } from "../constants/languages.js";
import { cleanPlainText, cleanRichText, cleanSlug, LIMITS } from "./inputSanitizer.js";

export function validateCategoryCreatePayload(body) {
  try {
    return {
      ok: true,
      value: {
        slug: cleanSlug(body?.slug, { required: true, field: "slug" }),
        lang: normalizeContentLang(body?.lang, "th"),
        title: cleanPlainText(body?.title, { required: true, max: LIMITS.TITLE_MAX, field: "title" }),
        description: body?.description
          ? cleanRichText(body.description, { max: LIMITS.DESCRIPTION_MAX, field: "description" })
          : null,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}

export function validateCategoryUpdatePayload(body) {
  try {
    return {
      ok: true,
      value: {
        lang: normalizeContentLang(body?.lang, "th"),
        title: cleanPlainText(body?.title, { required: true, max: LIMITS.TITLE_MAX, field: "title" }),
        description: body?.description
          ? cleanRichText(body.description, { max: LIMITS.DESCRIPTION_MAX, field: "description" })
          : null,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}
