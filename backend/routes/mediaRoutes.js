import express from "express";
import {
  createMediaUsage,
  deleteMediaAsset,
  deleteMediaUsage,
  getMediaAssetDetail,
  listMediaAssets,
  listMediaUsages,
  registerMediaAsset,
  updateMediaAsset,
  uploadMediaAsset,
} from "../controllers/mediaController.js";
import { authorizeOwner, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/media-assets", protect, listMediaAssets);
router.get("/media-assets/:id", protect, getMediaAssetDetail);
router.post("/media-assets/register", protect, authorizeOwner, logOwnerOverrideAction("media_asset.register"), registerMediaAsset);
router.post("/media-assets/upload", protect, authorizeOwner, logOwnerOverrideAction("media_asset.upload"), uploadMediaAsset);
router.patch("/media-assets/:id", protect, authorizeOwner, logOwnerOverrideAction("media_asset.update"), updateMediaAsset);
router.delete("/media-assets/:id", protect, authorizeOwner, deleteMediaAsset);

router.get("/media-usages", protect, listMediaUsages);
router.post("/media-usages", protect, authorizeOwner, logOwnerOverrideAction("media_usage.create"), createMediaUsage);
router.delete("/media-usages/:id", protect, authorizeOwner, logOwnerOverrideAction("media_usage.delete"), deleteMediaUsage);

export default router;
