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

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.resolve(__dirname, "uploads")));

// Translate routes
app.use("/api", translateRoutes);

// routes
app.use("/api", authRoutes);
app.use("/api", placeRoutes);
app.use("/api", userRoutes);
app.use("/api", uploadRoutes);
app.use("/api", eventRoutes);

app.listen(5000, () => {
  console.log("Server running on port 5000");
});

