import express from "express";
import { deleteImage, uploadImage } from "../controllers/uploadController.js";
import { authorizeOwner, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/upload/image", protect, authorizeOwner, logOwnerOverrideAction("upload.image"), uploadImage);
router.delete("/upload/image", protect, authorizeOwner, logOwnerOverrideAction("upload.image_delete"), deleteImage);

export default router;
