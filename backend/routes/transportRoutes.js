import express from "express";
import {
  getTransportConfig,
  getTransportRoutes,
  getTransportRouteById,
  createTransportRoute,
  updateTransportRoute,
  deleteTransportRoute,
  importTransportGeoJson,
  exportTransportRoutes,
  importCollectorTransportRoutes,
  submitAddLineRequest,
  listAddLineRequests,
  reviewAddLineRequest,
  applyAddLineRequest,
} from "../controllers/transportController.js";
import { protect, authorizeOwner } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/transport/config", getTransportConfig);
router.get("/transport-routes", getTransportRoutes);
router.get("/transport-routes/:id", getTransportRouteById);

router.post("/transport-routes", protect, authorizeOwner, createTransportRoute);
router.put("/transport-routes/:id", protect, authorizeOwner, updateTransportRoute);
router.delete("/transport-routes/:id", protect, authorizeOwner, deleteTransportRoute);
router.post("/transport-routes/import-collector", importCollectorTransportRoutes);
router.post("/transport-routes/import-geojson", protect, authorizeOwner, importTransportGeoJson);
router.get("/transport-routes/export", protect, authorizeOwner, exportTransportRoutes);

router.post("/transport-requests/add-line", protect, submitAddLineRequest);
router.get("/transport-requests/add-line", protect, authorizeOwner, listAddLineRequests);
router.patch("/transport-requests/add-line/:id/review", protect, authorizeOwner, reviewAddLineRequest);
router.post("/transport-requests/add-line/:id/apply", protect, authorizeOwner, applyAddLineRequest);

export default router;
