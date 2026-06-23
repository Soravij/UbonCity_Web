import {
  getHomepageCurationLayout,
  getPublishedHomepageLayout,
  previewHomepageCurationLayout,
  publishHomepageCurationLayout,
  searchHomepageCurationCandidates,
  updateHomepageCurationDraft,
} from "../services/homepageCurationService.js";
import { getTaxonomyV1KeyList } from "../constants/taxonomyCatalog.js";

function getActorId(req) {
  const id = Number(req.user?.id || 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseTaxonomyFiltersQuery(rawValue) {
  if (rawValue == null) return { taxonomyFilters: null };
  if (Array.isArray(rawValue)) return { error: true };

  const raw = String(rawValue || "").trim();
  if (!raw) return { taxonomyFilters: null };

  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return { error: true };
    return { taxonomyFilters: parsed };
  } catch {
    return { error: true };
  }
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

export async function searchHomepageCurationCandidatesHandler(req, res, deps = {}) {
  try {
    const parsedTaxonomyFilters = parseTaxonomyFiltersQuery(req.query?.taxonomy_filters);
    if (parsedTaxonomyFilters.error) {
      res.status(400).json({ error: "Invalid taxonomy_filters" });
      return;
    }
    const searchCandidates = typeof deps.searchHomepageCurationCandidates === "function"
      ? deps.searchHomepageCurationCandidates
      : searchHomepageCurationCandidates;
    const items = await searchCandidates({
      entityType: req.query.entity_type || "place",
      lang: req.query.lang || "th",
      q: req.query.q || "",
      limit: req.query.limit || 20,
      taxonomyFilters: parsedTaxonomyFilters.taxonomyFilters,
    });
    res.json({ items });
  } catch (error) {
    console.error("Failed to search homepage curation candidates:", error);
    res.status(500).json({ error: "Failed to search homepage curation candidates" });
  }
}

export async function getHomepageCurationTaxonomyOptionsHandler(req, res) {
  try {
    const items = getTaxonomyV1KeyList()
      .map((key) => ({ key }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
    res.json({ items });
  } catch (error) {
    console.error("Failed to load homepage curation taxonomy options:", error);
    res.status(500).json({ error: "Failed to load homepage curation taxonomy options" });
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
