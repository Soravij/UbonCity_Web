import express from "express";
import {
  getHomepageCurationLayoutHandler,
  getHomepageCurationTaxonomyCatalogHandler,
  getPublishedHomepageLayoutHandler,
  previewHomepageCurationLayoutHandler,
  publishHomepageCurationLayoutHandler,
  searchHomepageCurationCandidatesHandler,
  updateHomepageCurationLayoutHandler,
} from "../controllers/homepageCurationController.js";
import { authorizeAdmin, authorizeReviewContentInternal, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/homepage-layout", getPublishedHomepageLayoutHandler);
router.get("/homepage-curation/layout", protect, authorizeAdmin, getHomepageCurationLayoutHandler);
// These two expose the confirmed-taxonomy curation signal, so they gate on the shared internal-role
// source rather than restating admin/owner locally (PROJECT_POLICY.md §7A, locked).
router.get("/homepage-curation/taxonomy-catalog", protect, authorizeReviewContentInternal, getHomepageCurationTaxonomyCatalogHandler);
router.get("/homepage-curation/candidates", protect, authorizeReviewContentInternal, searchHomepageCurationCandidatesHandler);
router.post("/homepage-curation/preview", protect, authorizeAdmin, previewHomepageCurationLayoutHandler);
router.put("/homepage-curation/layout", protect, authorizeAdmin, updateHomepageCurationLayoutHandler);
router.post("/homepage-curation/layout/publish", protect, authorizeAdmin, publishHomepageCurationLayoutHandler);

export default router;
