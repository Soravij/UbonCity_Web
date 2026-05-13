import { getBackendIntegrationReadiness } from "../services/integrationReadinessService.js";

export function getIntegrationReadiness(_req, res) {
  const readiness = getBackendIntegrationReadiness();
  const status = readiness.ok ? 200 : 503;
  res.status(status).json(readiness);
}

