import {
  countCollectorImportReviewsByStatus,
  countCollectorImportReviewsByStatusAndType,
  ensureCollectorImportReviewTables,
  getCollectorImportReviewById,
  listCollectorImportReviews,
  rejectCollectorImportReviewById,
} from "../services/collectorImportReviewService.js";
import { listContentPurgeAudit } from "../services/contentGovernanceService.js";
import { assertLifecycleInfrastructureReady } from "./lifecycleInfra.js";

export async function initializeImportReviewInfrastructure() {
  await ensureCollectorImportReviewTables();
}

export const getCollectorImportReviewQueue = async (req, res) => {
  try {
    assertLifecycleInfrastructureReady();
    const status = String(req.query?.status || "pending").trim().toLowerCase();
    const sourceSystem = String(req.query?.source_system || "collector-app").trim().toLowerCase();
    const sourceContentType = String(req.query?.source_content_type || "all").trim().toLowerCase();
    const search = String(req.query?.search || "").trim();
    const limit = Number(req.query?.limit || 100);
    const offset = Number(req.query?.offset || 0);
    if (!["pending", "approved", "rejected", "all"].includes(status)) {
      return res.status(400).json({ error: "status must be one of pending, approved, rejected, all" });
    }
    if (!["place", "event", "all"].includes(sourceContentType)) {
      return res.status(400).json({ error: "source_content_type must be one of place, event, all" });
    }
    if (sourceSystem !== "all" && sourceSystem !== "collector-app") {
      return res.status(400).json({ error: "source_system must be collector-app or all" });
    }

    const items = await listCollectorImportReviews({ reviewStatus: status, sourceSystem, sourceContentType, search, limit, offset });
    const statusCounts = await countCollectorImportReviewsByStatus({ sourceSystem, sourceContentType });
    const statusTypeCounts = await countCollectorImportReviewsByStatusAndType({ sourceSystem, sourceContentType });
    return res.json({
      items,
      status_counts: statusCounts,
      status_type_counts: statusTypeCounts,
      query: {
        status,
        source_system: sourceSystem,
        source_content_type: sourceContentType,
        search,
        limit: Math.max(1, Math.min(200, Number(limit) || 100)),
        offset: Math.max(0, Number(offset) || 0),
      },
    });
  } catch (err) {
    if (String(err?.message || "").includes("Lifecycle infrastructure is not initialized")) {
      return res.status(503).json({ error: "Lifecycle infrastructure is not initialized" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getCollectorImportReviewQueueDetail = async (req, res) => {
  try {
    assertLifecycleInfrastructureReady();
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid review id" });
    const item = await getCollectorImportReviewById(id);
    if (!item) return res.status(404).json({ error: "Review record not found" });
    return res.json({ item });
  } catch (err) {
    if (String(err?.message || "").includes("Lifecycle infrastructure is not initialized")) {
      return res.status(503).json({ error: "Lifecycle infrastructure is not initialized" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const rejectCollectorImportReview = async (req, res) => {
  try {
    assertLifecycleInfrastructureReady();
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid review id" });
    const reviewerId = Number(req.user?.id || 0) || null;
    if (!reviewerId) return res.status(401).json({ error: "Authentication required" });
    const item = await getCollectorImportReviewById(id);
    if (!item) return res.status(404).json({ error: "Review record not found" });
    const affectedRows = await rejectCollectorImportReviewById({ reviewId: id, reviewedByUserId: reviewerId, reviewNote: req.body?.review_note });
    if (!affectedRows) return res.status(404).json({ error: "Review record not found" });
    return res.json({ message: "Rejected", item: await getCollectorImportReviewById(id) });
  } catch (err) {
    if (String(err?.message || "").includes("Lifecycle infrastructure is not initialized")) {
      return res.status(503).json({ error: "Lifecycle infrastructure is not initialized" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getDeletedContentHistory = async (req, res) => {
  try {
    const items = await listContentPurgeAudit({ limit: Number(req.query?.limit || 200), offset: Number(req.query?.offset || 0) });
    return res.json({
      items: items.map((row) => ({
        id: Number(row.id || 0) || 0,
        review_status: "deleted",
        source_content_type: String(row.entity_type || "").trim().toLowerCase(),
        pending_type: String(row.entity_type || "").trim().toLowerCase(),
        entity_id: Number(row.entity_id || 0) || 0,
        local_entity_id: Number(row.entity_id || 0) || 0,
        category: row.category == null ? (String(row.entity_type || "").toLowerCase() === "event" ? "event" : null) : String(row.category || "").trim() || null,
        slug: row.slug == null ? null : String(row.slug || "").trim() || null,
        title: row.title_snapshot == null ? null : String(row.title_snapshot || "").trim() || null,
        is_emer: Number(row.is_emer || 0) === 1 ? 1 : 0,
        reviewed_by_user_id: row.purged_by_user_id == null ? null : Number(row.purged_by_user_id || 0) || null,
        review_note: row.purge_note == null ? null : String(row.purge_note || "").trim() || null,
        updated_at: row.created_at || null,
        imported_at: row.created_at || null,
        created_at: row.created_at || null,
      })),
    });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
};
