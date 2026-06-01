import express from "express";
import {
  getHomepageCurationLayoutHandler,
  getPublishedHomepageLayoutHandler,
  previewHomepageCurationLayoutHandler,
  publishHomepageCurationLayoutHandler,
  searchHomepageCurationCandidatesHandler,
  updateHomepageCurationLayoutHandler,
} from "../controllers/homepageCurationController.js";
import { authorizeAdmin, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/homepage-layout", getPublishedHomepageLayoutHandler);
router.get("/homepage-curation/layout", protect, authorizeAdmin, getHomepageCurationLayoutHandler);
router.get("/homepage-curation/candidates", protect, authorizeAdmin, searchHomepageCurationCandidatesHandler);
router.post("/homepage-curation/preview", protect, authorizeAdmin, previewHomepageCurationLayoutHandler);
router.put("/homepage-curation/layout", protect, authorizeAdmin, updateHomepageCurationLayoutHandler);
router.post("/homepage-curation/layout/publish", protect, authorizeAdmin, publishHomepageCurationLayoutHandler);

export default router;
