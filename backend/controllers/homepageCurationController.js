import {
  getHomepageCurationLayout,
  getPublishedHomepageLayout,
  previewHomepageCurationLayout,
  publishHomepageCurationLayout,
  searchHomepageCurationCandidates,
  updateHomepageCurationDraft,
} from "../services/homepageCurationService.js";

function getActorId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function getHomepageCurationLayoutHandler(req, res) {
  try {
    const layoutKey = req.query.layout_key || "home";
    const lang = req.query.lang || "th";
    const item = await getHomepageCurationLayout(layoutKey, lang);
    res.json({ item });
  } catch (error) {
    console.error("Failed to load homepage curation layout:", error);
    res.status(500).json({ error: "Failed to load homepage curation layout" });
  }
}

export async function updateHomepageCurationLayoutHandler(req, res) {
  try {
    const item = await updateHomepageCurationDraft({
      layoutKey: req.body?.layout_key || "home",
      lang: req.body?.lang || "th",
      draftBlocks: req.body?.draft_blocks,
      actorId: getActorId(req),
    });
    res.json({ item });
  } catch (error) {
    console.error("Failed to save homepage curation layout:", error);
    res.status(500).json({ error: "Failed to save homepage curation layout" });
  }
}

export async function publishHomepageCurationLayoutHandler(req, res) {
  try {
    const item = await publishHomepageCurationLayout({
      layoutKey: req.body?.layout_key || "home",
      lang: req.body?.lang || "th",
      actorId: getActorId(req),
    });
    res.json({ item });
  } catch (error) {
    console.error("Failed to publish homepage curation layout:", error);
    res.status(500).json({ error: "Failed to publish homepage curation layout" });
  }
}

export async function getPublishedHomepageLayoutHandler(req, res) {
  try {
    const layoutKey = req.query.layout_key || "home";
    const lang = req.query.lang || "th";
    const item = await getPublishedHomepageLayout(layoutKey, lang);
    res.json({ item });
  } catch (error) {
    console.error("Failed to load published homepage layout:", error);
    res.status(500).json({ error: "Failed to load homepage layout" });
  }
}

export async function searchHomepageCurationCandidatesHandler(req, res) {
  try {
    const items = await searchHomepageCurationCandidates({
      entityType: req.query.entity_type || "place",
      lang: req.query.lang || "th",
      q: req.query.q || "",
      limit: req.query.limit || 20,
    });
    res.json({ items });
  } catch (error) {
    console.error("Failed to search homepage curation candidates:", error);
    res.status(500).json({ error: "Failed to search homepage curation candidates" });
  }
}

export async function previewHomepageCurationLayoutHandler(req, res) {
  try {
    const item = await previewHomepageCurationLayout({
      layoutKey: req.body?.layout_key || "home",
      lang: req.body?.lang || "th",
      draftBlocks: req.body?.draft_blocks,
    });
    res.json({ item });
  } catch (error) {
    console.error("Failed to preview homepage curation layout:", error);
    res.status(500).json({ error: "Failed to preview homepage curation layout" });
  }
}
