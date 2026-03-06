import express from "express";
import { createUser, deleteUser, getUsers, updateUserRole } from "../controllers/userController.js";
import { authorizeAdmin, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/users", protect, authorizeAdmin, getUsers);
router.post("/users", protect, authorizeAdmin, createUser);
router.patch("/users/:id/role", protect, authorizeAdmin, updateUserRole);
router.delete("/users/:id", protect, authorizeAdmin, deleteUser);

export default router;
