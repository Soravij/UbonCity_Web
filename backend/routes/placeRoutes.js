import express from "express";
import {
  getPlaces,
  createPlace,
  updatePlace,
  deletePlace
} from "../controllers/placeController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/places", getPlaces);
router.post("/places", /*protect*/ createPlace);
router.put("/places/:id", protect, updatePlace);
router.delete("/places/:id", protect, deletePlace);

export default router;