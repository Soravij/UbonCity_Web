function isBlank(value) {
  return String(value || "").trim().length === 0;
}

function isPlaceholderSecret(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return true;
  return normalized === "CHANGE_ME" || normalized.startsWith("REPLACE_WITH_");
}

function hasHttpBaseUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isTruthyEnv(value, defaultValue = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getReviewFeedbackReadiness() {
  const collectorSyncBaseUrl = String(process.env.COLLECTOR_SYNC_BASE_URL || "").trim();
  const collectorReviewSyncToken = String(process.env.COLLECTOR_REVIEW_SYNC_TOKEN || "").trim();
  const missing = [];
  if (!hasHttpBaseUrl(collectorSyncBaseUrl)) missing.push("COLLECTOR_SYNC_BASE_URL");
  if (isPlaceholderSecret(collectorReviewSyncToken)) missing.push("COLLECTOR_REVIEW_SYNC_TOKEN");
  return {
    required_env: ["COLLECTOR_SYNC_BASE_URL", "COLLECTOR_REVIEW_SYNC_TOKEN"],
    configured: missing.length === 0,
    missing,
    details: {
      collector_sync_base_url: collectorSyncBaseUrl || null,
    },
  };
}

function getLifecycleImportReadiness() {
  const lifecycleSyncToken = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
  const missing = [];
  if (isBlank(lifecycleSyncToken)) missing.push("LIFECYCLE_SYNC_TOKEN");
  return {
    required_env: ["LIFECYCLE_SYNC_TOKEN"],
    configured: missing.length === 0,
    missing,
  };
}

function withRequiredFlags(readinessMap) {
  const requiredByPolicy = {
    review_feedback_to_collector: isTruthyEnv(process.env.REQUIRE_REVIEW_COLLECTOR_SYNC, false),
    collector_transport_import: isTruthyEnv(process.env.REQUIRE_COLLECTOR_TRANSPORT_SYNC, false),
  };

  const integrations = {};
  for (const [key, value] of Object.entries(readinessMap)) {
    const required = Boolean(requiredByPolicy[key]);
    const ready = required ? Boolean(value.configured) : true;
    integrations[key] = { ...value, required, ready };
  }
  return integrations;
}

export function getBackendIntegrationReadiness() {
  const integrations = withRequiredFlags({
    review_feedback_to_collector: getReviewFeedbackReadiness(),
    collector_transport_import: getLifecycleImportReadiness(),
  });

  const failingRequired = Object.entries(integrations)
    .filter(([, value]) => value.required && !value.ready)
    .map(([key]) => key);

  return {
    ok: failingRequired.length === 0,
    service: "backend",
    integrations,
    failing_required: failingRequired,
  };
}

export function assertBackendIntegrationReadiness(requiredKeys = null) {
  const readiness = getBackendIntegrationReadiness();
  const requiredSet = Array.isArray(requiredKeys) && requiredKeys.length ? new Set(requiredKeys) : null;
  const failing = Object.entries(readiness.integrations)
    .filter(([key, value]) => {
      const explicitlyRequired = requiredSet ? requiredSet.has(key) : false;
      const policyRequired = value.required;
      const mustPass = explicitlyRequired || policyRequired;
      return mustPass && !value.configured;
    })
    .map(([key, value]) => ({ key, missing: value.missing || [] }));
  if (failing.length) {
    const detail = failing.map((item) => `${item.key} missing [${item.missing.join(", ")}]`).join("; ");
    throw new Error(`integration readiness failed: ${detail}`);
  }
  return readiness;
}

export function getBackendRequiredIntegrationKeys() {
  const readiness = getBackendIntegrationReadiness();
  return Object.entries(readiness.integrations)
    .filter(([, value]) => value.required)
    .map(([key]) => key);
}
