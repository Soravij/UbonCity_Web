import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.js";
import placeRoutes from "./routes/placeRoutes.js";
import translateRoutes from "./routes/translateRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());
 
//Translate routes
app.use("/api/translate", translateRoutes);

// routes
app.use("/api", authRoutes);
app.use("/api", placeRoutes);

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
