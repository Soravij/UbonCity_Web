import express from "express";
import { autoTranslate } from "../controllers/translateController.js";

const router = express.Router();

router.post("/translate", autoTranslate);

export default router;