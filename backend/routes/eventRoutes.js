import express from "express";
import {
  approveEvent,
  createEvent,
  deleteEvent,
  getEventDetail,
  getEvents,
  updateEvent,
} from "../controllers/eventController.js";
import { authorizeAdmin, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/events", getEvents);
router.get("/events/:id", getEventDetail);
router.post("/events", protect, createEvent);
router.put("/events/:id", protect, updateEvent);
router.patch("/events/:id/approve", protect, authorizeAdmin, approveEvent);
router.delete("/events/:id", protect, authorizeAdmin, deleteEvent);

export default router;

