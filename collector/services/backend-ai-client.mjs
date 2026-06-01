function normalizeBackendApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveFeatureConfig(aiConfig, featureKey) {
  if (!aiConfig || typeof aiConfig !== "object") return {};
  const normalizedFeatureKey = featureKey === "revision" || featureKey === "aiDiscovery"
    ? "fieldPack"
    : String(featureKey || "").trim();
  const feature = aiConfig?.features?.[normalizedFeatureKey];
  if (feature && typeof feature === "object") {
    return {
      ...aiConfig,
      ...feature,
    };
  }
  return aiConfig;
}

export function isBackendAiConfigured(aiConfig) {
  const backendApiBase = normalizeBackendApiBase(aiConfig?.backendApiBase);
  const backendSyncToken = String(aiConfig?.backendSyncToken || "").trim();
  return Boolean(backendApiBase && backendSyncToken);
}

export async function executeBackendAiJson({ aiConfig, featureKey, task, prompt, imageInputs = [] }) {
  const featureConfig = resolveFeatureConfig(aiConfig, featureKey);
  const backendApiBase = normalizeBackendApiBase(featureConfig?.backendApiBase || aiConfig?.backendApiBase);
  const backendSyncToken = String(featureConfig?.backendSyncToken || aiConfig?.backendSyncToken || "").trim();
  const provider = String(featureConfig?.provider || aiConfig?.provider || "").trim().toLowerCase();
  const model = String(featureConfig?.model || aiConfig?.model || "").trim();

  if (!backendApiBase) {
    throw new Error("COLLECTOR_SYNC_BACKEND_API is not configured for backend AI proxy");
  }
  if (!backendSyncToken) {
    throw new Error("LIFECYCLE_SYNC_TOKEN is not configured for backend AI proxy");
  }
  if (!provider) {
    throw new Error("AI provider is missing");
  }
  if (!model) {
    throw new Error("AI model is missing");
  }

  const response = await fetch(`${backendApiBase}/internal/ai/json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-lifecycle-token": backendSyncToken,
    },
    body: JSON.stringify({
      task: String(task || "").trim() || String(featureKey || "").trim() || "unknown",
      provider,
      model,
      prompt: String(prompt || "").trim(),
      image_inputs: Array.isArray(imageInputs) ? imageInputs : [],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = String(payload?.error || payload?.message || "").trim();
    throw new Error(`backend ai proxy failed (${response.status})${body ? `: ${body}` : ""}`);
  }

  return {
    provider: String(payload?.provider || provider).trim().toLowerCase(),
    model: String(payload?.model || model).trim(),
    outputText: String(payload?.output_text || "").trim(),
    parsed: payload?.parsed ?? null,
  };
}
