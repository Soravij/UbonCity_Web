import express from "express";
import {
  applyUserChanges,
  createUser,
  deleteUser,
  getUser,
  getUsers,
  deleteUserAvatar,
  uploadUserAvatar,
  updateUserProfile,
  updateUserLifecycle,
  updateUserManager,
  updateUserRole,
} from "../controllers/userController.js";
import { authorizeAdmin, authorizeOwner, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/users", protect, getUsers);
router.get("/users/:id", protect, authorizeAdmin, getUser);
router.post("/users", protect, createUser);
router.patch("/users/:id", protect, applyUserChanges);
router.post("/users/:id/avatar", protect, uploadUserAvatar);
router.delete("/users/:id/avatar", protect, deleteUserAvatar);
router.patch("/users/:id/profile", protect, updateUserProfile);
router.patch("/users/:id/role", protect, authorizeOwner, updateUserRole);
router.patch("/users/:id/lifecycle", protect, authorizeOwner, updateUserLifecycle);
router.patch("/users/:id/manager", protect, authorizeAdmin, updateUserManager);
router.delete("/users/:id", protect, authorizeOwner, deleteUser);

export default router;
