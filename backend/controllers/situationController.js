import { normalizeContentLang } from "../constants/languages.js";
import { cleanSlug } from "../validators/inputSanitizer.js";
import {
  listSituations,
  getSituationBySlug,
  createSituation,
  updateSituationBySlug,
  deleteSituationBySlug,
  reorderSituation,
} from "../repositories/situationRepository.js";
import { validateSituationCreatePayload, validateSituationUpdatePayload } from "../validators/situationValidator.js";

export async function getSituations(req, res) {
  try {
    const lang = normalizeContentLang(req.query?.lang, "en");
    const items = await listSituations(lang);
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getSituationDetail(req, res) {
  try {
    const slug = String(req.params?.slug || "").trim().toLowerCase();
    const item = await getSituationBySlug(slug);
    if (!item) return res.status(404).json({ error: "Situation not found" });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function createSituationHandler(req, res) {
  const validated = validateSituationCreatePayload(req.body || {});
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const existing = await getSituationBySlug(validated.value.slug);
    if (existing) {
      return res.status(409).json({ error: "slug already exists" });
    }

    const id = await createSituation(validated.value);
    return res.json({ message: "Situation created", id });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateSituation(req, res) {
  let slug;
  try {
    slug = cleanSlug(req.params?.slug, { required: true, field: "slug" });
  } catch (err) {
    return res.status(400).json({ error: String(err?.message || "Invalid slug") });
  }

  const validated = validateSituationUpdatePayload(req.body || {});
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const updated = await updateSituationBySlug(slug, validated.value);
    if (!updated) return res.status(404).json({ error: "Situation not found" });
    return res.json({ message: "Situation updated" });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteSituation(req, res) {
  try {
    const slug = String(req.params?.slug || "").trim().toLowerCase();
    const deleted = await deleteSituationBySlug(slug);
    if (!deleted) return res.status(404).json({ error: "Situation not found" });
    return res.json({ message: "Situation deleted" });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function reorderSituationHandler(req, res) {
  const slug = String(req.body?.slug || "").trim().toLowerCase();
  const direction = String(req.body?.direction || "").trim().toLowerCase();

  if (!slug) {
    return res.status(400).json({ error: "slug is required" });
  }
  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ error: "direction must be up or down" });
  }

  try {
    const result = await reorderSituation(slug, direction);
    if (result === null) {
      return res.status(404).json({ error: "Situation not found" });
    }
    return res.json({ moved: result.moved });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
