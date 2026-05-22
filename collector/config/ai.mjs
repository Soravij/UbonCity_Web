const KNOWN_PROVIDERS = new Set(["openai", "google"]);
const AI_POLICY_DEFAULT_KEY = "gemini-2.5-flash-lite";

const AI_POLICY_CATALOG = Object.freeze({
  "gemini-2.5-flash-lite": Object.freeze({
    key: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite (economy)",
    provider: "google",
    model: "gemini-2.5-flash-lite",
  }),
  "gemini-2.5-flash": Object.freeze({
    key: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash (review)",
    provider: "google",
    model: "gemini-2.5-flash",
  }),
  "gpt-5.4-mini": Object.freeze({
    key: "gpt-5.4-mini",
    label: "GPT-5.4 mini (precision)",
    provider: "openai",
    model: "gpt-5.4-mini",
  }),
});

const AI_FEATURE_CATALOG = Object.freeze({
  fieldPack: Object.freeze({
    key: "fieldPack",
    label: "Field Pack",
    description: "Used for field pack generation, regenerate, and AI discovery queries",
    status: "active",
    active: true,
    default_policy_key: AI_POLICY_DEFAULT_KEY,
  }),
  translation: Object.freeze({
    key: "translation",
    label: "Translation",
    description: "ใช้สำหรับงานแปลภาษา",
    status: "active",
    active: true,
    default_policy_key: AI_POLICY_DEFAULT_KEY,
  }),
  visualContext: Object.freeze({
    key: "visualContext",
    label: "Visual Context",
    description: "ใช้สำหรับวิเคราะห์ภาพประกอบ",
    status: "active",
    active: true,
    default_policy_key: AI_POLICY_DEFAULT_KEY,
  }),
  articleGenerator: Object.freeze({
    key: "articleGenerator",
    label: "Article Generator",
    description: "สงวนไว้สำหรับ article-workspace ในรอบถัดไป",
    status: "reserved",
    active: false,
    default_policy_key: AI_POLICY_DEFAULT_KEY,
  }),
});

function normalizeProvider(value, fallback = "openai") {
  const candidate = String(value || "").trim().toLowerCase();
  if (KNOWN_PROVIDERS.has(candidate)) return candidate;
  return fallback;
}

function normalizePolicyKey(value, fallback = AI_POLICY_DEFAULT_KEY) {
  const candidate = String(value || "").trim();
  if (AI_POLICY_CATALOG[candidate]) return candidate;
  return fallback;
}

function resolveProviderTransport(provider, transport) {
  if (provider === "google") {
    return {
      apiKey: transport.googleApiKey,
      baseUrl: transport.googleBaseUrl,
    };
  }
  return {
    apiKey: transport.openAiApiKey,
    baseUrl: transport.openAiBaseUrl,
  };
}

function resolveFeatureConfig(provider, model, transport) {
  const normalizedProvider = normalizeProvider(provider, "openai");
  const normalizedModel = String(model || "").trim();
  const providerTransport = resolveProviderTransport(normalizedProvider, transport);
  return {
    provider: normalizedProvider,
    model: normalizedModel,
    apiKey: providerTransport.apiKey,
    baseUrl: providerTransport.baseUrl,
  };
}

export function listAiPolicyCatalog() {
  return Object.values(AI_POLICY_CATALOG).map((item) => ({ ...item }));
}

export function listAiFeatureCatalog() {
  return Object.values(AI_FEATURE_CATALOG).map((item) => ({ ...item }));
}

export function getAiFeatureDefinition(featureKey) {
  const key = String(featureKey || "").trim();
  return AI_FEATURE_CATALOG[key] ? { ...AI_FEATURE_CATALOG[key] } : null;
}

export function resolvePolicySelection(policyKey) {
  const key = normalizePolicyKey(policyKey, AI_POLICY_DEFAULT_KEY);
  const selected = AI_POLICY_CATALOG[key] || AI_POLICY_CATALOG[AI_POLICY_DEFAULT_KEY];
  return selected
    ? {
        key: selected.key,
        label: selected.label,
        provider: selected.provider,
        model: selected.model,
      }
    : null;
}

export function buildFeaturePolicyMap(rawPolicyByFeature = {}) {
  const result = {};
  for (const featureDef of Object.values(AI_FEATURE_CATALOG)) {
    const rawKey = rawPolicyByFeature && typeof rawPolicyByFeature === "object"
      ? rawPolicyByFeature[featureDef.key]
      : "";
    const selected = resolvePolicySelection(rawKey || featureDef.default_policy_key);
    result[featureDef.key] = {
      ...featureDef,
      policy_key: selected?.key || AI_POLICY_DEFAULT_KEY,
      provider: selected?.provider || "openai",
      model: selected?.model || "",
      policy_label: selected?.label || "",
    };
  }
  return result;
}

export function resolveAiFeatureConfig(aiConfig, featureKey) {
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

export function resolveAiConfig(options = {}) {
  const { policyByFeature = {} } = options;
  const featureMap = buildFeaturePolicyMap(policyByFeature);
  const defaultPolicy = resolvePolicySelection(AI_POLICY_DEFAULT_KEY);
  const provider = defaultPolicy?.provider || "openai";
  const model = defaultPolicy?.model || "gemini-2.5-flash-lite";
  const transport = {
    openAiApiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    openAiBaseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/$/, ""),
    googleApiKey: String(process.env.GOOGLE_AI_API_KEY || "").trim(),
    googleBaseUrl: String(process.env.GOOGLE_AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta")
      .trim()
      .replace(/\/$/, ""),
  };
  const globalTransport = resolveProviderTransport(provider, transport);
  const fieldPack = resolveFeatureConfig(featureMap.fieldPack.provider, featureMap.fieldPack.model, transport);
  const translation = resolveFeatureConfig(featureMap.translation.provider, featureMap.translation.model, transport);
  const visualContext = resolveFeatureConfig(featureMap.visualContext.provider, featureMap.visualContext.model, transport);
  const articleGenerator = resolveFeatureConfig(
    featureMap.articleGenerator.provider,
    featureMap.articleGenerator.model,
    transport
  );
  const agentEngine = String(process.env.COLLECTOR_AGENT_ENGINE || "internal").trim().toLowerCase();
  const externalAgentUrl = String(process.env.COLLECTOR_EXTERNAL_AGENT_URL || "").trim().replace(/\/+$/, "");
  const externalAgentToken = String(process.env.COLLECTOR_EXTERNAL_AGENT_TOKEN || "").trim();

  return {
    provider,
    model,
    apiKey: globalTransport.apiKey,
    baseUrl: globalTransport.baseUrl,
    openAiApiKey: transport.openAiApiKey,
    openAiBaseUrl: transport.openAiBaseUrl,
    googleApiKey: transport.googleApiKey,
    googleBaseUrl: transport.googleBaseUrl,
    translationProvider: translation.provider,
    translationModel: translation.model,
    fieldPackProvider: fieldPack.provider,
    fieldPackModel: fieldPack.model,
    agentEngine,
    externalAgentUrl,
    externalAgentToken,
    features: {
      fieldPack: { ...fieldPack, policyKey: featureMap.fieldPack.policy_key },
      translation: { ...translation, policyKey: featureMap.translation.policy_key },
      visualContext: { ...visualContext, policyKey: featureMap.visualContext.policy_key },
      articleGenerator: { ...articleGenerator, policyKey: featureMap.articleGenerator.policy_key },
    },
    featurePolicies: featureMap,
    enabled: agentEngine === "external"
      ? Boolean(externalAgentUrl)
      : Boolean(fieldPack.apiKey || translation.apiKey || visualContext.apiKey || globalTransport.apiKey),
  };
}
