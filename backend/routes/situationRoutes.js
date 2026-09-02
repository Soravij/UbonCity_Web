import express from "express";
import {
  getSituations,
  getSituationDetail,
  createSituationHandler,
  updateSituation,
  deleteSituation,
} from "../controllers/situationController.js";
import { authorizeAdmin, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/situations", getSituations);
router.get("/situations/:slug", getSituationDetail);
router.post("/situations", protect, authorizeAdmin, logOwnerOverrideAction("situation.create"), createSituationHandler);
router.put("/situations/:slug", protect, authorizeAdmin, logOwnerOverrideAction("situation.update"), updateSituation);
router.delete("/situations/:slug", protect, authorizeAdmin, logOwnerOverrideAction("situation.delete"), deleteSituation);

export default router;
