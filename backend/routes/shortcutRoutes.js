import express from "express";
import {
  getShortcuts,
  getShortcutDetail,
  createShortcutHandler,
  updateShortcut,
  deleteShortcut,
  reorderShortcutHandler,
  getShortcutPlaces,
  addShortcutPlaces,
  removeShortcutPlace,
  reorderShortcutPlaceHandler,
} from "../controllers/shortcutController.js";
import { authorizeAdmin, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/shortcuts", getShortcuts);
router.get("/shortcuts/:slug", getShortcutDetail);
router.get("/shortcuts/:slug/places", getShortcutPlaces);
router.post("/shortcuts/reorder", protect, authorizeAdmin, logOwnerOverrideAction("shortcut.reorder"), reorderShortcutHandler);
router.post("/shortcuts", protect, authorizeAdmin, logOwnerOverrideAction("shortcut.create"), createShortcutHandler);
router.post("/shortcuts/:slug/places", protect, authorizeAdmin, logOwnerOverrideAction("shortcut.places.add"), addShortcutPlaces);
router.post("/shortcuts/:slug/places/reorder", protect, authorizeAdmin, logOwnerOverrideAction("shortcut.places.reorder"), reorderShortcutPlaceHandler);
router.put("/shortcuts/:slug", protect, authorizeAdmin, logOwnerOverrideAction("shortcut.update"), updateShortcut);
router.delete("/shortcuts/:slug", protect, authorizeAdmin, logOwnerOverrideAction("shortcut.delete"), deleteShortcut);
router.delete("/shortcuts/:slug/places/:placeId", protect, authorizeAdmin, logOwnerOverrideAction("shortcut.places.remove"), removeShortcutPlace);

export default router;
