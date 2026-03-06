import express from "express";
import { register, login } from "../controllers/authController.js";
import { authorizeAdmin, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", protect, authorizeAdmin, register);
router.post("/login", login);

export default router;
