import express from "express";
import { getIntegrationReadiness } from "../controllers/integrationReadinessController.js";

const router = express.Router();

router.get("/integrations/readiness", getIntegrationReadiness);

export default router;

