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
  translationRecheck: Object.freeze({
    key: "translationRecheck",
    label: "Translation Recheck",
    description: "Used for semantic translation quality recheck after technical QA passes",
    status: "active",
    active: true,
    default_policy_key: AI_POLICY_DEFAULT_KEY,
  }),
  translationRepair: Object.freeze({
    key: "translationRepair",
    label: "Translation Repair",
    description: "Used to repair warning/failed translations from recheck issues",
    status: "active",
    active: true,
    default_policy_key: "gemini-2.5-flash",
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
  seoAgent: Object.freeze({
    key: "seoAgent",
    label: "SEO Agent",
    description: "สงวนไว้สำหรับ SEO assistance ใน article-workspace รอบถัดไป",
    status: "reserved",
    active: false,
    default_policy_key: "gemini-2.5-flash-lite",
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

function resolveFeatureConfig(provider, model) {
  const normalizedProvider = normalizeProvider(provider, "openai");
  const normalizedModel = String(model || "").trim();
  return {
    provider: normalizedProvider,
    model: normalizedModel,
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
  const backendApiBase = String(
    process.env.COLLECTOR_SYNC_BACKEND_API || process.env.BACKEND_API_BASE_URL || process.env.BACKEND_URL || ""
  ).trim().replace(/\/+$/, "");
  const backendSyncToken = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
  const fieldPack = resolveFeatureConfig(featureMap.fieldPack.provider, featureMap.fieldPack.model);
  const translation = resolveFeatureConfig(featureMap.translation.provider, featureMap.translation.model);
  const translationRecheck = resolveFeatureConfig(featureMap.translationRecheck.provider, featureMap.translationRecheck.model);
  const translationRepair = resolveFeatureConfig(featureMap.translationRepair.provider, featureMap.translationRepair.model);
  const visualContext = resolveFeatureConfig(featureMap.visualContext.provider, featureMap.visualContext.model);
  const articleGenerator = resolveFeatureConfig(featureMap.articleGenerator.provider, featureMap.articleGenerator.model);
  const seoAgent = resolveFeatureConfig(featureMap.seoAgent.provider, featureMap.seoAgent.model);
  const agentEngine = String(process.env.COLLECTOR_AGENT_ENGINE || "internal").trim().toLowerCase();
  const externalAgentUrl = String(process.env.COLLECTOR_EXTERNAL_AGENT_URL || "").trim().replace(/\/+$/, "");
  const externalAgentToken = String(process.env.COLLECTOR_EXTERNAL_AGENT_TOKEN || "").trim();

  return {
    provider,
    model,
    backendApiBase,
    backendSyncToken,
    translationProvider: translation.provider,
    translationModel: translation.model,
    translationRecheckProvider: translationRecheck.provider,
    translationRecheckModel: translationRecheck.model,
    translationRepairProvider: translationRepair.provider,
    translationRepairModel: translationRepair.model,
    fieldPackProvider: fieldPack.provider,
    fieldPackModel: fieldPack.model,
    seoAgentProvider: seoAgent.provider,
    seoAgentModel: seoAgent.model,
    agentEngine,
    externalAgentUrl,
    externalAgentToken,
    features: {
      fieldPack: { ...fieldPack, policyKey: featureMap.fieldPack.policy_key, backendApiBase, backendSyncToken },
      translation: { ...translation, policyKey: featureMap.translation.policy_key, backendApiBase, backendSyncToken },
      translationRecheck: { ...translationRecheck, policyKey: featureMap.translationRecheck.policy_key, backendApiBase, backendSyncToken },
      translationRepair: { ...translationRepair, policyKey: featureMap.translationRepair.policy_key, backendApiBase, backendSyncToken },
      visualContext: { ...visualContext, policyKey: featureMap.visualContext.policy_key, backendApiBase, backendSyncToken },
      articleGenerator: { ...articleGenerator, policyKey: featureMap.articleGenerator.policy_key, backendApiBase, backendSyncToken },
      seoAgent: { ...seoAgent, policyKey: featureMap.seoAgent.policy_key, backendApiBase, backendSyncToken },
    },
    featurePolicies: featureMap,
    enabled: agentEngine === "external"
      ? Boolean(externalAgentUrl)
      : Boolean(backendApiBase && backendSyncToken),
  };
}
