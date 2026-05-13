function isPlaceholderSecret(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return true;
  return normalized === "CHANGE_ME" || normalized.startsWith("REPLACE_WITH_");
}

function isTruthyEnv(value, defaultValue = false) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function hasHttpBaseUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function buildPublishSyncReadiness(config) {
  const missing = [];
  if (!hasHttpBaseUrl(config.backendApiBase)) missing.push("COLLECTOR_SYNC_BACKEND_API");
  if (isPlaceholderSecret(config.backendSyncToken)) missing.push("LIFECYCLE_SYNC_TOKEN");
  if (!String(config.collectorPublicBaseUrl || "").trim()) missing.push("COLLECTOR_PUBLIC_BASE_URL");
  return {
    required_env: ["COLLECTOR_SYNC_BACKEND_API", "LIFECYCLE_SYNC_TOKEN", "COLLECTOR_PUBLIC_BASE_URL"],
    configured: missing.length === 0,
    missing,
  };
}

function buildTransportSyncReadiness(config) {
  const missing = [];
  if (!hasHttpBaseUrl(config.backendApiBase)) missing.push("COLLECTOR_SYNC_BACKEND_API");
  if (isPlaceholderSecret(config.backendSyncToken)) missing.push("LIFECYCLE_SYNC_TOKEN");
  return {
    required_env: ["COLLECTOR_SYNC_BACKEND_API", "LIFECYCLE_SYNC_TOKEN"],
    configured: missing.length === 0,
    missing,
  };
}

function buildReviewReceiverReadiness(config) {
  const missing = [];
  if (isPlaceholderSecret(config.webReviewSyncToken)) missing.push("COLLECTOR_REVIEW_SYNC_TOKEN");
  return {
    required_env: ["COLLECTOR_REVIEW_SYNC_TOKEN"],
    configured: missing.length === 0,
    missing,
  };
}

function withRequiredFlags(readinessMap, requiredByPolicy) {
  const integrations = {};
  for (const [key, value] of Object.entries(readinessMap)) {
    const required = Boolean(requiredByPolicy[key]);
    integrations[key] = {
      ...value,
      required,
      ready: required ? Boolean(value.configured) : true,
    };
  }
  return integrations;
}

export function getCollectorIntegrationReadiness(config = {}) {
  const requiredByPolicy = {
    publish_sync_to_backend: isTruthyEnv(process.env.REQUIRE_COLLECTOR_PUBLISH_SYNC, false),
    transport_sync_to_backend: isTruthyEnv(process.env.REQUIRE_COLLECTOR_TRANSPORT_SYNC, false),
    review_feedback_receiver: isTruthyEnv(process.env.REQUIRE_COLLECTOR_REVIEW_FEEDBACK, false),
  };

  const integrations = withRequiredFlags(
    {
      publish_sync_to_backend: buildPublishSyncReadiness(config),
      transport_sync_to_backend: buildTransportSyncReadiness(config),
      review_feedback_receiver: buildReviewReceiverReadiness(config),
    },
    requiredByPolicy
  );

  const failingRequired = Object.entries(integrations)
    .filter(([, value]) => value.required && !value.ready)
    .map(([key]) => key);

  return {
    ok: failingRequired.length === 0,
    service: "collector-app",
    integrations,
    failing_required: failingRequired,
  };
}

export function assertCollectorIntegrationReadiness(config = {}, requiredKeys = null) {
  const readiness = getCollectorIntegrationReadiness(config);
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
    throw new Error(`collector integration readiness failed: ${detail}`);
  }
  return readiness;
}

export function getCollectorRequiredIntegrationKeys(config = {}) {
  const readiness = getCollectorIntegrationReadiness(config);
  return Object.entries(readiness.integrations)
    .filter(([, value]) => value.required)
    .map(([key]) => key);
}
