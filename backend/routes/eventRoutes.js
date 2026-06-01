import express from "express";
import {
  approveEvent,
  createEvent,
  deleteEvent,
  getEventDetail,
  getEvents,
  updateEvent,
} from "../controllers/eventController.js";
import { authorizeAdmin, authorizeOwner, logOwnerOverrideAction, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/events", getEvents);
router.get("/events/:id", getEventDetail);
router.post("/events", protect, authorizeOwner, logOwnerOverrideAction("event.create"), createEvent);
router.put("/events/:id", protect, authorizeOwner, logOwnerOverrideAction("event.update"), updateEvent);
router.patch("/events/:id/approve", protect, authorizeAdmin, approveEvent);
router.delete("/events/:id", protect, authorizeOwner, logOwnerOverrideAction("event.purge"), deleteEvent);

export default router;
