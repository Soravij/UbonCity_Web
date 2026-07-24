import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/authRoutes.js";
import placeRoutes from "./routes/placeRoutes.js";
import translateRoutes from "./routes/translateRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import transportRoutes from "./routes/transportRoutes.js";
import mediaRoutes from "./routes/mediaRoutes.js";
import importReviewRoutes from "./routes/importReviewRoutes.js";
import homepageCurationRoutes from "./routes/homepageCurationRoutes.js";
import internalAiRoutes from "./routes/internalAiRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import { initializeImportReviewInfrastructure } from "./controllers/importReviewController.js";
import { ensureUtf8mb4 } from "./config/ensureUtf8mb4.js";
import { ensureSharedSchemaBootstrap } from "./config/sharedSchemaBootstrap.js";
import { ensureBootstrapOwner } from "./services/bootstrapOwnerService.js";
import { ensureReviewInfrastructure } from "./services/reviewContentService.js";
import { ensureContentGovernanceInfrastructure } from "./services/contentGovernanceService.js";
import reviewContentRoutes from "./routes/reviewContentRoutes.js";
import integrationReadinessRoutes from "./routes/integrationReadinessRoutes.js";
import { assertBackendIntegrationReadiness, getBackendRequiredIntegrationKeys } from "./services/integrationReadinessService.js";
import {
  applyBasicSecurityHeaders,
  corsOptionsDelegate,
  createRateLimiter,
  requireStrongJwtSecret,
  validateCorsConfiguration,
} from "./middleware/securityMiddleware.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

requireStrongJwtSecret();
validateCorsConfiguration();

app.set("trust proxy", 1);
app.use(applyBasicSecurityHeaders);
app.use(cors(corsOptionsDelegate));
app.use(express.json({ limit: "10mb" }));
app.use(createRateLimiter({ windowMs: 60 * 1000, max: 180, message: "Too many requests" }));
app.use(
  "/uploads",
  express.static(path.resolve(__dirname, "uploads"), {
    index: false,
    setHeaders(res) {
      // Frontend public pages load uploaded media from backend on a different port/host.
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);
app.use("/transport", express.static(path.resolve(__dirname, "transport"), { index: false }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "backend" });
});

// Translate routes
app.use("/api", translateRoutes);

// routes
app.use("/api", authRoutes);
app.use("/api", placeRoutes);
app.use("/api", userRoutes);
app.use("/api", uploadRoutes);
app.use("/api", eventRoutes);
app.use("/api", categoryRoutes);
app.use("/api", transportRoutes);
app.use("/api", mediaRoutes);
app.use("/api", importReviewRoutes);
app.use("/api", homepageCurationRoutes);
app.use("/api", reviewContentRoutes);
app.use("/api", integrationReadinessRoutes);
app.use("/api", internalAiRoutes);
app.use("/api", analyticsRoutes);

app.use((err, _req, res, _next) => {
  console.error("Unhandled backend error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

const PORT = Number(process.env.PORT || 5000);

async function startServer() {
  try {
    assertBackendIntegrationReadiness(getBackendRequiredIntegrationKeys());
    await ensureUtf8mb4();
    await ensureSharedSchemaBootstrap();
    await initializeImportReviewInfrastructure();
    await ensureReviewInfrastructure();
    await ensureContentGovernanceInfrastructure();
    await ensureBootstrapOwner();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup failed:", err.message);
    process.exit(1);
  }
}

startServer();
