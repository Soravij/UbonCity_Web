import express from "express";
import {
  getSituations,
  getSituationDetail,
  createSituationHandler,
  updateSituation,
  deleteSituation,
  reorderSituationHandler,
  getSituationPlaces,
  addSituationPlaces,
  removeSituationPlace,
} from "../controllers/situationController.js";
import { authorizeAdmin, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/situations", getSituations);
router.get("/situations/:slug", getSituationDetail);
router.get("/situations/:slug/places", getSituationPlaces);
router.post("/situations/reorder", protect, authorizeAdmin, logOwnerOverrideAction("situation.reorder"), reorderSituationHandler);
router.post("/situations", protect, authorizeAdmin, logOwnerOverrideAction("situation.create"), createSituationHandler);
router.post("/situations/:slug/places", protect, authorizeAdmin, logOwnerOverrideAction("situation.places.add"), addSituationPlaces);
router.put("/situations/:slug", protect, authorizeAdmin, logOwnerOverrideAction("situation.update"), updateSituation);
router.delete("/situations/:slug", protect, authorizeAdmin, logOwnerOverrideAction("situation.delete"), deleteSituation);
router.delete("/situations/:slug/places/:placeId", protect, authorizeAdmin, logOwnerOverrideAction("situation.places.remove"), removeSituationPlace);

export default router;
