export function isCtaTraceEnabled() {
  return String(process.env.COLLECTOR_CTA_TRACE || "").trim() === "1";
}

function extractKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([, candidate]) => {
      if (candidate == null) return false;
      if (Array.isArray(candidate)) return candidate.length > 0;
      if (typeof candidate === "object") return Object.keys(candidate).length > 0;
      return String(candidate || "").trim().length > 0;
    })
    .map(([key]) => key)
    .sort();
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function summarizeStructuredContext(context = {}) {
  return {
    structured_context_exists: Boolean(context && typeof context === "object"),
    approved_context_count: Array.isArray(context?.approved_context) ? context.approved_context.length : 0,
    evidence_blocks_count: Array.isArray(context?.evidence_blocks) ? context.evidence_blocks.length : 0,
  };
}

function buildCtaSummary(value = {}, prefix = "cta") {
  const normalizedPrefix = String(prefix || "cta").trim() || "cta";
  return {
    [`${normalizedPrefix}_keys`]: extractKeys(value),
    [`${normalizedPrefix}_phone_last4`]: maskPhone(value?.phone),
  };
}

export function summarizeCtaCandidates(candidates = {}) {
  return buildCtaSummary(candidates, "candidate");
}

export function summarizeCtaValue(value = {}, prefix = "cta") {
  return buildCtaSummary(value, prefix);
}

export function summarizeCtaJsonString(rawValue, prefix = "cta") {
  if (!isCtaTraceEnabled()) return {};
  if (rawValue == null) return buildCtaSummary({}, prefix);
  try {
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return buildCtaSummary({}, prefix);
    }
    return buildCtaSummary(parsed, prefix);
  } catch {
    return buildCtaSummary({}, prefix);
  }
}

export function traceCtaStage(stage, payload = {}) {
  if (!isCtaTraceEnabled()) return;
  try {
    console.error(`[collector-cta-trace] ${stage} ${JSON.stringify(payload)}`);
  } catch {
    console.error(`[collector-cta-trace] ${stage}`);
  }
}
