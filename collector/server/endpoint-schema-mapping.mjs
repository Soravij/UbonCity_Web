function cloneValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function buildFieldPackUpdatePayloadFromAgent(source = {}) {
  const fieldPack = source && typeof source === "object" ? source : {};
  return {
    status: String(fieldPack.status || "ready_for_field").trim().toLowerCase() || "ready_for_field",
    writer_ready: Boolean(fieldPack.writer_ready),
    ai_summary: String(fieldPack.ai_summary || "").trim(),
    ai_highlights: Array.isArray(fieldPack.ai_highlights) ? fieldPack.ai_highlights : [],
    ai_unknowns: Array.isArray(fieldPack.ai_unknowns) ? fieldPack.ai_unknowns : [],
    editor_summary: String(fieldPack.editor_summary || "").trim(),
    verified_facts: Array.isArray(fieldPack.verified_facts) ? fieldPack.verified_facts : [],
    uncertain_facts: Array.isArray(fieldPack.uncertain_facts) ? fieldPack.uncertain_facts : [],
    story_angle: String(fieldPack.story_angle || "").trim(),
    field_notes: String(fieldPack.field_notes || "").trim(),
    social_hook: String(fieldPack.social_hook || "").trim(),
    social_shot_emphasis: Array.isArray(fieldPack.social_shot_emphasis) ? fieldPack.social_shot_emphasis : [],
    social_on_camera_points: Array.isArray(fieldPack.social_on_camera_points) ? fieldPack.social_on_camera_points : [],
    social_caption_angle: String(fieldPack.social_caption_angle || "").trim(),
    // AI regenerate writes suggestion fields only. Curated fields stay human-owned.
    ai_cta_contact_json: cloneValue(fieldPack.ai_cta_contact_json),
    ai_taxonomy_json: cloneValue(fieldPack.ai_taxonomy_json),
    field_pack_checklists: Array.isArray(fieldPack.field_pack_checklists) ? fieldPack.field_pack_checklists : [],
    // Current schema requires real URLs for references/media hints. Revision keeps
    // these out until the separate internal-context reference schema exists.
    field_pack_references: [],
    field_pack_media_hints: [],
  };
}

export function buildAssignmentSubmissionPayload({
  assignmentId,
  submittedByUserId,
  submissionState,
  articlePayloadJson,
  mediaPayloadJson,
  fieldReturnPayloadJson,
  contributorNote,
  reviewerNote,
  reviewedAt,
} = {}) {
  return {
    assignment_id: assignmentId,
    submitted_by_user_id: submittedByUserId,
    submission_state: submissionState,
    article_payload_json: articlePayloadJson,
    media_payload_json: mediaPayloadJson,
    field_return_payload_json: fieldReturnPayloadJson,
    contributor_note: contributorNote,
    reviewer_note: reviewerNote,
    reviewed_at: reviewedAt,
  };
}

export function mergeConfirmedDraftMetadata(draftPayload = {}, latestDraft = null) {
  const hasOwnField = (key) => Object.prototype.hasOwnProperty.call(draftPayload, key);
  return {
    confirmed_cta_contact_json: hasOwnField("confirmed_cta_contact_json")
      ? draftPayload.confirmed_cta_contact_json
      : (latestDraft?.confirmed_cta_contact_json ?? undefined),
    confirmed_taxonomy_json: hasOwnField("confirmed_taxonomy_json")
      ? draftPayload.confirmed_taxonomy_json
      : (latestDraft?.confirmed_taxonomy_json ?? undefined),
    confirmed_meta_status: hasOwnField("confirmed_meta_status")
      ? draftPayload.confirmed_meta_status
      : (latestDraft?.confirmed_meta_status ?? undefined),
    confirmed_by_user_id: hasOwnField("confirmed_by_user_id")
      ? draftPayload.confirmed_by_user_id
      : (latestDraft?.confirmed_by_user_id ?? undefined),
    confirmed_at: hasOwnField("confirmed_at")
      ? draftPayload.confirmed_at
      : (latestDraft?.confirmed_at ?? undefined),
    confirmed_note: hasOwnField("confirmed_note")
      ? draftPayload.confirmed_note
      : (latestDraft?.confirmed_note ?? undefined),
  };
}
