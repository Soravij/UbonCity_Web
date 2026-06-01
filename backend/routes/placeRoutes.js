import express from "express";
import {
  getPlaces,
  getPlaceDetail,
  getNearbyPlaces,
  createPlace,
  updatePlace,
  deletePlace,
  approvePlace,
  importPlaces,
  importPlacesCsv,
} from "../controllers/placeController.js";

import { protect, authorizeAdmin, authorizeOwner, logOwnerOverrideAction } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/places", getPlaces);
router.get("/places/:category/:slug/nearby", getNearbyPlaces);
router.get("/places/:category/:slug", getPlaceDetail);
router.post("/places", protect, authorizeOwner, logOwnerOverrideAction("place.create"), createPlace);
router.post("/places/import", protect, authorizeOwner, logOwnerOverrideAction("place.import"), importPlaces);
router.post("/places/import-csv", protect, authorizeOwner, logOwnerOverrideAction("place.import_csv"), importPlacesCsv);
router.put("/places/:id", protect, authorizeOwner, logOwnerOverrideAction("place.update"), updatePlace);
router.patch("/places/:id/approve", protect, authorizeAdmin, approvePlace);
router.delete("/places/:id", protect, authorizeOwner, logOwnerOverrideAction("place.purge"), deletePlace);

export default router;
