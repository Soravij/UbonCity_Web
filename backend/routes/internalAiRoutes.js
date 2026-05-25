import crypto from "crypto";
import express from "express";

import { requestJsonCompletion } from "../services/aiExecutionService.js";

const router = express.Router();

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireLifecycleSyncToken(req, res, next) {
  const expected = String(process.env.LIFECYCLE_SYNC_TOKEN || "").trim();
  if (!expected) return res.status(503).json({ error: "LIFECYCLE_SYNC_TOKEN is not configured" });
  const provided = String(req.headers["x-lifecycle-token"] || "").trim();
  if (!timingSafeEquals(provided, expected)) return res.status(401).json({ error: "Invalid lifecycle sync token" });
  return next();
}

router.post("/internal/ai/json", requireLifecycleSyncToken, async (req, res) => {
  try {
    const provider = String(req.body?.provider || "").trim();
    const model = String(req.body?.model || "").trim();
    const prompt = String(req.body?.prompt || "").trim();
    const task = String(req.body?.task || "").trim() || "unknown";
    const imageInputs = Array.isArray(req.body?.image_inputs) ? req.body.image_inputs : [];

    if (!provider) return res.status(400).json({ error: "provider is required" });
    if (!model) return res.status(400).json({ error: "model is required" });
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const result = await requestJsonCompletion({
      provider,
      model,
      prompt,
      imageInputs,
    });

    return res.json({
      ok: true,
      task,
      provider: result.provider,
      model,
      output_text: result.outputText,
      parsed: result.parsed,
    });
  } catch (error) {
    const message = String(error?.message || "internal ai execution failed");
    const status = /not configured/i.test(message) ? 503 : /required/i.test(message) ? 400 : 500;
    return res.status(status).json({ error: message });
  }
});

export default router;
