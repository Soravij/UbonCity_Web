import express from "express";
import multer from "multer";
import { getLatestTransportMap, publishTransportMap, requireTransportSyncToken } from "../controllers/transportV2Controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 40 } });

function parseMultipart(req, res, next) {
  upload.any()(req, res, (err) => (err ? res.status(400).json({ error: String(err.message || "invalid multipart") }) : next()));
}

router.post("/transport-v2/publish", requireTransportSyncToken, parseMultipart, publishTransportMap);
router.get("/transport-v2/maps/:mapKey", getLatestTransportMap);

export default router;
