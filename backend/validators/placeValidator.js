import { normalizeContentLang } from "../constants/languages.js";
import { cleanOptionalNumber, cleanPlainText, cleanRichText, cleanSlug, cleanUrl, LIMITS } from "./inputSanitizer.js";

export function validateCreatePlacePayload(body) {
  try {
    const category = cleanSlug(body?.category, { required: true, field: "category" });
    const lang = normalizeContentLang(body?.lang, "th");
    const title = cleanPlainText(body?.title, { required: true, max: LIMITS.TITLE_MAX, field: "title" });
    const description = cleanRichText(body?.description, {
      required: true,
      max: LIMITS.DESCRIPTION_MAX,
      field: "description",
    });

    return {
      ok: true,
      value: {
        group_id: Number.isFinite(Number(body?.group_id)) ? Number(body.group_id) : null,
        category,
        lang,
        slug: body?.slug ? cleanSlug(body.slug, { field: "slug" }) : null,
        title,
        description,
        meta_title: body?.meta_title
          ? cleanPlainText(body.meta_title, { max: LIMITS.META_TITLE_MAX, field: "meta_title" })
          : null,
        meta_description: body?.meta_description
          ? cleanPlainText(body.meta_description, { max: LIMITS.META_DESC_MAX, field: "meta_description" })
          : null,
        image: body?.image ? cleanUrl(body.image, { field: "image" }) : null,
        latitude: cleanOptionalNumber(body?.latitude, { min: -90, max: 90 }),
        longitude: cleanOptionalNumber(body?.longitude, { min: -180, max: 180 }),
        map_url: body?.map_url ? cleanUrl(body.map_url, { field: "map_url" }) : null,
        google_place_id: body?.google_place_id
          ? cleanPlainText(body.google_place_id, { max: 255, field: "google_place_id" })
          : null,
        decision_featured_score: cleanOptionalNumber(body?.decision_featured_score, { min: 0, max: 1000 }),
        decision_scenario_tags: body?.decision_scenario_tags
          ? cleanPlainText(body.decision_scenario_tags, { max: 500, field: "decision_scenario_tags" })
          : null,
        decision_trend_flags: body?.decision_trend_flags
          ? cleanPlainText(body.decision_trend_flags, { max: 500, field: "decision_trend_flags" })
          : null,
        decision_moment_tags: body?.decision_moment_tags
          ? cleanPlainText(body.decision_moment_tags, { max: 500, field: "decision_moment_tags" })
          : null,
        decision_insight_flags: body?.decision_insight_flags
          ? cleanPlainText(body.decision_insight_flags, { max: 500, field: "decision_insight_flags" })
          : null,
        decision_cover_image: body?.decision_cover_image
          ? cleanUrl(body.decision_cover_image, { field: "decision_cover_image" })
          : null,
        decision_thumbnail_image: body?.decision_thumbnail_image
          ? cleanUrl(body.decision_thumbnail_image, { field: "decision_thumbnail_image" })
          : null,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}

export function validateUpdatePlacePayload(body) {
  try {
    const lang = normalizeContentLang(body?.lang, "");
    if (!lang) return { ok: false, error: "lang is required" };

    return {
      ok: true,
      value: {
        lang,
        title: cleanPlainText(body?.title, { required: true, max: LIMITS.TITLE_MAX, field: "title" }),
        description: cleanRichText(body?.description, {
          required: true,
          max: LIMITS.DESCRIPTION_MAX,
          field: "description",
        }),
        meta_title: body?.meta_title
          ? cleanPlainText(body.meta_title, { max: LIMITS.META_TITLE_MAX, field: "meta_title" })
          : null,
        meta_description: body?.meta_description
          ? cleanPlainText(body.meta_description, { max: LIMITS.META_DESC_MAX, field: "meta_description" })
          : null,
        image: body?.image ? cleanUrl(body.image, { field: "image" }) : null,
        latitude: cleanOptionalNumber(body?.latitude, { min: -90, max: 90 }),
        longitude: cleanOptionalNumber(body?.longitude, { min: -180, max: 180 }),
        map_url: body?.map_url ? cleanUrl(body.map_url, { field: "map_url" }) : null,
        google_place_id: body?.google_place_id
          ? cleanPlainText(body.google_place_id, { max: 255, field: "google_place_id" })
          : null,
        decision_featured_score: cleanOptionalNumber(body?.decision_featured_score, { min: 0, max: 1000 }),
        decision_scenario_tags: body?.decision_scenario_tags
          ? cleanPlainText(body.decision_scenario_tags, { max: 500, field: "decision_scenario_tags" })
          : null,
        decision_trend_flags: body?.decision_trend_flags
          ? cleanPlainText(body.decision_trend_flags, { max: 500, field: "decision_trend_flags" })
          : null,
        decision_moment_tags: body?.decision_moment_tags
          ? cleanPlainText(body.decision_moment_tags, { max: 500, field: "decision_moment_tags" })
          : null,
        decision_insight_flags: body?.decision_insight_flags
          ? cleanPlainText(body.decision_insight_flags, { max: 500, field: "decision_insight_flags" })
          : null,
        decision_cover_image: body?.decision_cover_image
          ? cleanUrl(body.decision_cover_image, { field: "decision_cover_image" })
          : null,
        decision_thumbnail_image: body?.decision_thumbnail_image
          ? cleanUrl(body.decision_thumbnail_image, { field: "decision_thumbnail_image" })
          : null,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}
