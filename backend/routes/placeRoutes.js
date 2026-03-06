import express from "express";
import {
  getPlaces,
  getPlaceDetail,
  createPlace,
  updatePlace,
  deletePlace,
  approvePlace,
} from "../controllers/placeController.js";

import { protect, authorizeAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/places", getPlaces);
router.get("/places/:category/:slug", getPlaceDetail);
router.post("/places", protect, createPlace);
router.put("/places/:id", protect, updatePlace);
router.patch("/places/:id/approve", protect, authorizeAdmin, approvePlace);
router.delete("/places/:id", protect, deletePlace);

export default router;
