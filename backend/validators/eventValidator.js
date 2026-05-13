import { cleanOptionalNumber, cleanPlainText, cleanRichText, cleanUrl, LIMITS } from "./inputSanitizer.js";

function cleanCsvText(value, field) {
  return cleanPlainText(value, { required: false, max: LIMITS.CSV_TEXT_MAX, field });
}

export function validateEventPayload(body) {
  try {
    const title = cleanPlainText(body?.title, { required: true, max: LIMITS.TITLE_MAX, field: "title" });
    const description = cleanRichText(body?.description, {
      required: false,
      max: LIMITS.DESCRIPTION_MAX,
      field: "description",
    });
    const image = body?.image ? cleanUrl(body.image, { field: "image" }) : null;
    const metaTitle = cleanPlainText(body?.meta_title, {
      required: false,
      max: LIMITS.META_TITLE_MAX,
      field: "meta_title",
    });
    const metaDescription = cleanPlainText(body?.meta_description, {
      required: false,
      max: LIMITS.META_DESC_MAX,
      field: "meta_description",
    });
    const eventPeriodText = cleanPlainText(body?.event_period_text, {
      required: false,
      max: LIMITS.DESCRIPTION_MAX,
      field: "event_period_text",
    });
    const locationText = cleanPlainText(body?.location_text, {
      required: false,
      max: LIMITS.DESCRIPTION_MAX,
      field: "location_text",
    });
    const mapUrl = body?.map_url ? cleanUrl(body.map_url, { field: "map_url" }) : null;
    const decisionFeaturedScore = cleanOptionalNumber(body?.decision_featured_score, {
      min: 0,
      max: 1000,
    });
    const decisionScenarioTags = cleanCsvText(body?.decision_scenario_tags, "decision_scenario_tags");
    const decisionTrendFlags = cleanCsvText(body?.decision_trend_flags, "decision_trend_flags");
    const decisionMomentTags = cleanCsvText(body?.decision_moment_tags, "decision_moment_tags");
    const decisionInsightFlags = cleanCsvText(body?.decision_insight_flags, "decision_insight_flags");
    const decisionCoverImage = body?.decision_cover_image
      ? cleanUrl(body.decision_cover_image, { field: "decision_cover_image" })
      : null;
    const decisionThumbnailImage = body?.decision_thumbnail_image
      ? cleanUrl(body.decision_thumbnail_image, { field: "decision_thumbnail_image" })
      : null;

    return {
      ok: true,
      value: {
        title,
        description,
        image,
        meta_title: metaTitle,
        meta_description: metaDescription,
        event_period_text: eventPeriodText,
        location_text: locationText,
        map_url: mapUrl,
        decision_featured_score: decisionFeaturedScore,
        decision_scenario_tags: decisionScenarioTags,
        decision_trend_flags: decisionTrendFlags,
        decision_moment_tags: decisionMomentTags,
        decision_insight_flags: decisionInsightFlags,
        decision_cover_image: decisionCoverImage,
        decision_thumbnail_image: decisionThumbnailImage,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || "Invalid payload") };
  }
}
