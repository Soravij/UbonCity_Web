import express from "express";
import {
  getSituations,
  getSituationDetail,
  createSituationHandler,
  updateSituation,
  deleteSituation,
} from "../controllers/situationController.js";
import { authorizeOwner, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/situations", getSituations);
router.get("/situations/:slug", getSituationDetail);
router.post("/situations", protect, authorizeOwner, logOwnerOverrideAction("situation.create"), createSituationHandler);
router.put("/situations/:slug", protect, authorizeOwner, logOwnerOverrideAction("situation.update"), updateSituation);
router.delete("/situations/:slug", protect, authorizeOwner, logOwnerOverrideAction("situation.delete"), deleteSituation);

export default router;
