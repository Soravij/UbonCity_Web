export function resolveAiConfig() {
  const provider = String(process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  const model = String(process.env.AI_MODEL || "gpt-5-mini").trim();
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const baseUrl = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/$/, "");
  const agentEngine = String(process.env.COLLECTOR_AGENT_ENGINE || "internal").trim().toLowerCase();
  const externalAgentUrl = String(process.env.COLLECTOR_EXTERNAL_AGENT_URL || "").trim().replace(/\/+$/, "");
  const externalAgentToken = String(process.env.COLLECTOR_EXTERNAL_AGENT_TOKEN || "").trim();

  return {
    provider,
    model,
    apiKey,
    baseUrl,
    agentEngine,
    externalAgentUrl,
    externalAgentToken,
    enabled: agentEngine === "external" ? Boolean(externalAgentUrl) : Boolean(apiKey),
  };
}
