import express from "express";
import { deleteImage, uploadImage } from "../controllers/uploadController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/upload/image", protect, uploadImage);
router.delete("/upload/image", protect, deleteImage);

export default router;
