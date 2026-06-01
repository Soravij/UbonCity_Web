import express from "express";
import {
  createCategory,
  deleteCategory,
  getCategories,
  getCategoryDetail,
  updateCategory,
} from "../controllers/categoryController.js";
import { authorizeOwner, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/categories", getCategories);
router.get("/categories/:slug", getCategoryDetail);
router.post("/categories", protect, authorizeOwner, logOwnerOverrideAction("category.create"), createCategory);
router.put("/categories/:slug", protect, authorizeOwner, logOwnerOverrideAction("category.update"), updateCategory);
router.delete("/categories/:slug", protect, authorizeOwner, logOwnerOverrideAction("category.delete"), deleteCategory);

export default router;
