const ALLOWED_PLACE_CATEGORIES = new Set([
  "attractions",
  "activities",
  "hotels",
  "cafes",
  "restaurants",
  "transport",
]);

function dedupeKey(item) {
  if (item.source_url) return `url:${String(item.source_url).toLowerCase()}`;
  const lat = item.latitude ?? "";
  const lng = item.longitude ?? "";
  return `type:${item.type}|title:${String(item.title).toLowerCase()}|lat:${lat}|lng:${lng}`;
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function calcSeoRisk(item) {
  let risk = 0;
  const title = String(item.meta_title || item.title || "");
  const desc = String(item.meta_description || "");

  if (!title) risk += 35;
  if (title.length > 70) risk += 20;
  if (desc.length < 80) risk += 15;
  if (desc.length > 180) risk += 15;

  return clampScore(risk);
}

function calcMetadataScore(item) {
  let score = 0;
  if (String(item.meta_title || item.title || "").trim()) score += 45;
  if (String(item.meta_description || "").trim()) score += 35;
  if (String(item.slug || "").trim()) score += 20;
  return clampScore(score);
}

function calcGroundingScore(item) {
  let score = 20;
  if (String(item.source_url || "").trim()) score += 30;
  if (String(item.source_name || "").trim()) score += 20;
  if (item.latitude != null && item.longitude != null) score += 15;
  if (String(item.google_place_id || "").trim()) score += 15;
  return clampScore(score);
}

function calcAiQualityScore(item) {
  let score = 40;
  const body = String(item.body || item.description || "");
  if (body.length >= 120) score += 20;
  if (body.length >= 250) score += 10;
  if ((item.suggested_related || []).length >= 2) score += 10;
  if (String(item.excerpt || "").length >= 60) score += 10;
  if (/lorem ipsum|test test|\?\?\?\?/.test(body.toLowerCase())) score -= 30;
  return clampScore(score);
}

export function runQualityChecks(items) {
  const acceptedReports = [];
  const rejectedReports = [];
  const seen = new Set();

  for (const item of items) {
    const issues = [];

    if (!(item.type === "place" || item.type === "event" || item.type === "article")) {
      issues.push("type must be place/event/article");
    }
    if (!item.title) {
      issues.push("missing title");
    }
    if (!item.description && !item.body) {
      issues.push("missing description/body");
    }
    if (item.type === "place" && !ALLOWED_PLACE_CATEGORIES.has(item.category)) {
      issues.push("invalid place category");
    }

    const key = dedupeKey(item);
    const isDup = seen.has(key);
    if (isDup) {
      issues.push("duplicate");
    }

    const duplicationScore = isDup ? 100 : 0;
    const seoRiskScore = calcSeoRisk(item);
    const metadataScore = calcMetadataScore(item);
    const groundingScore = calcGroundingScore(item);
    const aiQualityScore = calcAiQualityScore(item);

    const totalScore = clampScore(
      (100 - duplicationScore) * 0.25 +
        (100 - seoRiskScore) * 0.2 +
        metadataScore * 0.2 +
        groundingScore * 0.2 +
        aiQualityScore * 0.15
    );

    const result = {
      row_no: item.row_no,
      item,
      report: {
        duplication_score: duplicationScore,
        seo_risk_score: seoRiskScore,
        metadata_score: metadataScore,
        grounding_score: groundingScore,
        ai_quality_score: aiQualityScore,
        total_score: totalScore,
        issues,
      },
    };

    if (!issues.length && totalScore >= 65) {
      acceptedReports.push(result);
      seen.add(key);
    } else {
      rejectedReports.push(result);
      if (!isDup) seen.add(key);
    }
  }

  return {
    accepted: acceptedReports.map((x) => x.item),
    rejected: rejectedReports.map((x) => ({ row_no: x.row_no, reason: x.report.issues.join("; "), item: x.item })),
    accepted_reports: acceptedReports,
    rejected_reports: rejectedReports,
  };
}
