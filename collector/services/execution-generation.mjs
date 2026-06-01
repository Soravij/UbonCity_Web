function toText(value) {
  return String(value || "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueText(values = [], limit = 8) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const text = toText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeGenerationChannel(value) {
  const channel = toText(value).toLowerCase();
  if (channel !== "facebook" && channel !== "tiktok") {
    throw new Error("channel must be one of: facebook, tiktok");
  }
  return channel;
}

function createGenerationPrerequisiteError(reasonCode, prereqSummary) {
  const err = new Error(String(reasonCode || "generation_prerequisite_failed"));
  err.code = String(reasonCode || "generation_prerequisite_failed");
  err.prereq_summary = prereqSummary || null;
  return err;
}

function buildGenerationInputContract(item, readinessSnapshot, controlsSnapshot) {
  const brief = readinessSnapshot?.brief_json || {};
  const payload = controlsSnapshot?.payload_json || {};
  return {
    item: {
      id: Number(item?.id || 0) || null,
      title: toText(item?.title) || null,
      category: toText(item?.category) || null,
      lang: "th",
    },
    readiness: {
      readiness_brief_id: Number(readinessSnapshot?.id || 0) || null,
      brief_summary: toText(brief?.brief_summary) || null,
      recommended_angle: toText(brief?.recommended_angle) || null,
      recommended_hook: toText(brief?.recommended_hook) || null,
      niche: brief?.niche || null,
      gaps: toArray(brief?.gaps),
      next_actions: toArray(brief?.next_actions),
      evidence_summary: brief?.evidence_summary || null,
    },
    controls: {
      controls_id: Number(controlsSnapshot?.id || 0) || null,
      must_include_points: toArray(controlsSnapshot?.must_include_points_json),
      must_avoid_points: toArray(controlsSnapshot?.must_avoid_points_json),
      blockers: toArray(controlsSnapshot?.blockers_json),
      missing_requirements: toArray(controlsSnapshot?.missing_requirements_json),
    },
    payload_context: payload?.context || null,
  };
}

function buildPromptContract(channel) {
  if (channel === "facebook") {
    return {
      version: "v1",
      channel: "facebook",
      input_contract: {
        requires: ["readiness.brief_summary", "readiness.recommended_angle", "controls.must_include_points", "controls.must_avoid_points"],
        language: "th",
      },
      output_contract: {
        recommended_version_json: {
          headline: "string",
          caption: "string",
          cta: "string",
          tone: "string",
          post_format: "string",
        },
        alternatives_json: "array<object>",
      },
    };
  }

  return {
    version: "v1",
    channel: "tiktok",
    input_contract: {
      requires: ["readiness.recommended_hook", "controls.must_include_points", "controls.must_avoid_points"],
      language: "th",
    },
    output_contract: {
      recommended_version_json: {
        hook: "string",
        full_script: "string",
        scene_outline: "array<string>",
        cta: "string",
        narrative_style: "string",
      },
      alternatives_json: "array<object>",
    },
  };
}

function buildFallbackFacebookOutput(input) {
  const title = toText(input?.item?.title) || "สถานที่แนะนำ";
  const angle = toText(input?.readiness?.recommended_angle) || "มุมที่ควรโฟกัส";
  const hook = toText(input?.readiness?.recommended_hook) || `ลองแวะ ${title}`;
  const includePoints = uniqueText(input?.controls?.must_include_points || [], 3);

  const recommended = {
    headline: `${title}: ${angle}`,
    caption: uniqueText([
      hook,
      ...includePoints,
      "แนะนำให้เช็กข้อมูลล่าสุดก่อนเดินทาง",
    ], 5).join("\n"),
    cta: "บันทึกโพสต์นี้ไว้เป็นตัวเลือกก่อนเดินทาง",
    tone: "informative_local",
    post_format: "single_image",
  };

  const alternatives = [
    {
      headline: `${title} สำหรับสายชิล`,
      caption: uniqueText([hook, ...includePoints], 4).join("\n"),
      cta: "คอมเมนต์มุมที่คุณอยากให้เราเจาะต่อ",
      tone: "friendly",
      post_format: "carousel",
    },
    {
      headline: `เช็กลิสต์ก่อนไป ${title}`,
      caption: uniqueText([
        `${title} เหมาะกับใคร: ${angle}`,
        "ตรวจเวลาและความพร้อมก่อนออกเดินทาง",
      ], 4).join("\n"),
      cta: "แชร์ให้เพื่อนร่วมทริปดูได้เลย",
      tone: "practical",
      post_format: "text_plus_image",
    },
  ];

  return { recommended, alternatives };
}

function buildFallbackTiktokOutput(input) {
  const title = toText(input?.item?.title) || "สถานที่แนะนำ";
  const angle = toText(input?.readiness?.recommended_angle) || "มุมหลัก";
  const hook = toText(input?.readiness?.recommended_hook) || `กำลังหาไอเดียที่เที่ยว? ลอง ${title}`;
  const includePoints = uniqueText(input?.controls?.must_include_points || [], 4);

  const recommended = {
    hook,
    full_script: uniqueText([
      `${title} เด่นเรื่อง ${angle}`,
      ...includePoints,
      "ปิดท้ายด้วยสิ่งที่ควรเช็กก่อนออกเดินทาง",
    ], 6).join(" "),
    scene_outline: uniqueText([
      `เปิดด้วยชื่อสถานที่: ${title}`,
      `เล่ามุมหลัก: ${angle}`,
      "ยกประเด็นที่ต้องรู้ก่อนตัดสินใจไป",
      "ปิดด้วย CTA ให้บันทึกคลิป",
    ], 5),
    cta: "กดบันทึกไว้ใช้วางแผนทริป",
    narrative_style: "onsite_guide",
  };

  const alternatives = [
    {
      hook: `${title} ไปแล้วควรรู้อะไรก่อน`,
      full_script: uniqueText([`${title} ในมุม ${angle}`, ...includePoints], 5).join(" "),
      scene_outline: uniqueText(["เปิดเร็วด้วย hook", "สรุปข้อดีหลัก", "ปิดด้วยคำแนะนำสั้น"], 4),
      cta: "แชร์ให้เพื่อนก่อนออกทริป",
      narrative_style: "quick_facts",
    },
    {
      hook: `1 นาทีรู้จัก ${title}`,
      full_script: uniqueText([hook, `${title} เหมาะกับคนที่อยากได้ ${angle}`], 4).join(" "),
      scene_outline: uniqueText(["เปิดภาพรวม", "ย้ำจุดเด่น", "เตือนข้อควรเช็ก", "จบด้วย CTA"], 5),
      cta: "บันทึกไว้แล้วค่อยตัดสินใจ",
      narrative_style: "summary_recap",
    },
  ];

  return { recommended, alternatives };
}

function buildFallbackOutput(channel, input) {
  if (channel === "facebook") {
    return buildFallbackFacebookOutput(input);
  }
  return buildFallbackTiktokOutput(input);
}

export async function generateExecutionChannelForItem(repo, contentItemId, channel, options = {}) {
  const itemId = Number(contentItemId || 0);
  if (!itemId) throw new Error("content_item_id is required");
  const normalizedChannel = normalizeGenerationChannel(channel);
  const actorEmail = toText(options.actorEmail) || "system@local";
  const aiConfig = options.aiConfig || null;

  const item = repo.getItem(itemId);
  if (!item) throw new Error("item not found");

  const readinessSnapshot = repo.getLatestReadinessBriefByItem(itemId);
  if (!readinessSnapshot?.id) {
    throw new Error("readiness snapshot is required before generation");
  }

  const controlsSnapshot = repo.getLatestExecutionControlsByItem(itemId);
  if (!controlsSnapshot?.id) {
    throw new Error("execution controls snapshot is required before generation");
  }
  if (Number(controlsSnapshot.source_readiness_brief_id || 0) !== Number(readinessSnapshot.id || 0)) {
    throw new Error("execution controls snapshot is stale; recompute execution controls from latest readiness first");
  }

  const readinessState = readinessSnapshot?.readiness_json || {};
  const controlsBlockers = toArray(controlsSnapshot?.blockers_json);
  const controlsMissingRequirements = toArray(controlsSnapshot?.missing_requirements_json);
  const prereqSummary = {
    source_readiness_brief_id: Number(readinessSnapshot?.id || 0) || null,
    source_controls_id: Number(controlsSnapshot?.id || 0) || null,
    blockers_count: controlsBlockers.length,
    missing_requirements_count: controlsMissingRequirements.length,
    ready_for_content: Boolean(readinessState?.ready_for_content),
  };

  if (!prereqSummary.ready_for_content) {
    throw createGenerationPrerequisiteError("readiness_not_ready_for_content", prereqSummary);
  }
  if (prereqSummary.blockers_count > 0) {
    throw createGenerationPrerequisiteError("execution_controls_blocked", prereqSummary);
  }
  if (prereqSummary.missing_requirements_count > 0) {
    throw createGenerationPrerequisiteError("execution_controls_missing_requirements", prereqSummary);
  }

  const inputContract = buildGenerationInputContract(item, readinessSnapshot, controlsSnapshot);
  const promptContract = buildPromptContract(normalizedChannel);

  const fallbackOutput = buildFallbackOutput(normalizedChannel, inputContract);
  const mode = "deterministic_fallback";
  const generatedBy = `execution-generator:${mode}`;

  const existing = repo.getLatestExecutionChannelByItemAndChannel(itemId, normalizedChannel);
  const record = repo.createExecutionChannelRecord(
    {
      id: existing?.id || undefined,
      content_item_id: itemId,
      source_readiness_brief_id: Number(readinessSnapshot.id || 0),
      channel: normalizedChannel,
      lang: "th",
      derived_controls_json: {
        source_controls_id: Number(controlsSnapshot.id || 0),
        must_include_points: controlsSnapshot.must_include_points_json || [],
        must_avoid_points: controlsSnapshot.must_avoid_points_json || [],
      },
      recommended_version_json: fallbackOutput.recommended,
      alternatives_json: fallbackOutput.alternatives,
      validation_json: {
        validation_status: "generated_pending_validation",
        blockers: [],
        warnings: [
          {
            code: "pending_validation",
            stage: "generation",
            message: "generated output should be validated before downstream usage",
          },
        ],
        missing_requirements: [],
        generation: {
          mode,
          provider: aiConfig?.provider || null,
          model: aiConfig?.model || null,
          used_controls_id: Number(controlsSnapshot.id || 0),
          used_readiness_brief_id: Number(readinessSnapshot.id || 0),
          contract_version: promptContract.version,
        },
      },
      status: "generated",
      generated_by: generatedBy,
    },
    actorEmail
  );

  return {
    item_id: itemId,
    channel: normalizedChannel,
    source_readiness_brief_id: Number(readinessSnapshot.id || 0),
    source_controls_id: Number(controlsSnapshot.id || 0),
    regenerated: Boolean(existing?.id),
    generated_by: generatedBy,
    generation_mode: mode,
    prompt_contract: promptContract,
    input_contract: inputContract,
    execution_channel: record,
  };
}
