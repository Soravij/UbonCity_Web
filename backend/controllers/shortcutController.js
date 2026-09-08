import { normalizeContentLang } from "../constants/languages.js";
import { cleanSlug } from "../validators/inputSanitizer.js";
import {
  listShortcuts,
  getShortcutBySlug,
  createShortcut,
  updateShortcutBySlug,
  deleteShortcutBySlug,
  reorderShortcut,
} from "../repositories/shortcutRepository.js";
import {
  listPlacesByShortcut,
  addPlacesToShortcut,
  removePlaceFromShortcut,
  reorderShortcutPlace,
} from "../repositories/shortcutPlaceRepository.js";
import { validateShortcutCreatePayload, validateShortcutUpdatePayload } from "../validators/shortcutValidator.js";
import logger from "../middleware/logger.js";

export async function getShortcuts(req, res) {
  try {
    const lang = normalizeContentLang(req.query?.lang, "en");
    const items = await listShortcuts(lang);
    return res.json({ items });
  } catch (err) {
    logger.error("getShortcuts failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getShortcutDetail(req, res) {
  try {
    const slug = String(req.params?.slug || "").trim().toLowerCase();
    const item = await getShortcutBySlug(slug);
    if (!item) return res.status(404).json({ error: "Shortcut not found" });
    return res.json({ item });
  } catch (err) {
    logger.error("getShortcutDetail failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function createShortcutHandler(req, res) {
  const validated = validateShortcutCreatePayload(req.body || {});
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const existing = await getShortcutBySlug(validated.value.slug);
    if (existing) {
      return res.status(409).json({ error: "slug already exists" });
    }

    const id = await createShortcut(validated.value);
    return res.json({ message: "Shortcut created", id });
  } catch (err) {
    if (err?.code === "SHORTCUT_LIMIT_REACHED") {
      return res.status(409).json({ error: err.message });
    }
    logger.error("createShortcut failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateShortcut(req, res) {
  let slug;
  try {
    slug = cleanSlug(req.params?.slug, { required: true, field: "slug" });
  } catch (err) {
    return res.status(400).json({ error: String(err?.message || "Invalid slug") });
  }

  const validated = validateShortcutUpdatePayload(req.body || {});
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const updated = await updateShortcutBySlug(slug, validated.value);
    if (!updated) return res.status(404).json({ error: "Shortcut not found" });
    return res.json({ message: "Shortcut updated" });
  } catch (err) {
    logger.error("updateShortcut failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteShortcut(req, res) {
  try {
    const slug = String(req.params?.slug || "").trim().toLowerCase();
    const deleted = await deleteShortcutBySlug(slug);
    if (!deleted) return res.status(404).json({ error: "Shortcut not found" });
    return res.json({ message: "Shortcut deleted" });
  } catch (err) {
    logger.error("deleteShortcut failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function reorderShortcutHandler(req, res) {
  const slug = String(req.body?.slug || "").trim().toLowerCase();
  const direction = String(req.body?.direction || "").trim().toLowerCase();

  if (!slug) {
    return res.status(400).json({ error: "slug is required" });
  }
  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ error: "direction must be up or down" });
  }

  try {
    const result = await reorderShortcut(slug, direction);
    if (result === null) {
      return res.status(404).json({ error: "Shortcut not found" });
    }
    return res.json({ moved: result.moved });
  } catch (err) {
    logger.error("reorderShortcut failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getShortcutPlaces(req, res) {
  try {
    const slug = String(req.params?.slug || "").trim().toLowerCase();
    const shortcut = await getShortcutBySlug(slug);
    if (!shortcut) return res.status(404).json({ error: "Shortcut not found" });

    const lang = normalizeContentLang(req.query?.lang, "en");
    const items = await listPlacesByShortcut(shortcut.id, lang);
    return res.json({ items });
  } catch (err) {
    logger.error("getShortcutPlaces failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function addShortcutPlaces(req, res) {
  try {
    const slug = String(req.params?.slug || "").trim().toLowerCase();
    const shortcut = await getShortcutBySlug(slug);
    if (!shortcut) return res.status(404).json({ error: "Shortcut not found" });

    const placeIds = req.body?.place_ids;
    if (!Array.isArray(placeIds) || !placeIds.length) {
      return res.status(400).json({ error: "place_ids must be a non-empty array" });
    }

    const inserted = await addPlacesToShortcut(shortcut.id, placeIds);
    return res.json({ message: "Places added", inserted });
  } catch (err) {
    logger.error("addShortcutPlaces failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function removeShortcutPlace(req, res) {
  try {
    const slug = String(req.params?.slug || "").trim().toLowerCase();
    const shortcut = await getShortcutBySlug(slug);
    if (!shortcut) return res.status(404).json({ error: "Shortcut not found" });

    const placeId = Number(req.params?.placeId);
    if (!placeId) return res.status(400).json({ error: "Invalid placeId" });

    const removed = await removePlaceFromShortcut(shortcut.id, placeId);
    if (!removed) return res.status(404).json({ error: "Place not found in shortcut" });
    return res.json({ message: "Place removed" });
  } catch (err) {
    logger.error("removeShortcutPlace failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function reorderShortcutPlaceHandler(req, res) {
  const slug = String(req.params?.slug || "").trim().toLowerCase();
  const placeId = Number(req.body?.place_id);
  const direction = String(req.body?.direction || "").trim().toLowerCase();

  if (!slug) {
    return res.status(400).json({ error: "slug is required" });
  }
  if (!placeId) {
    return res.status(400).json({ error: "place_id is required" });
  }
  if (direction !== "up" && direction !== "down") {
    return res.status(400).json({ error: "direction must be up or down" });
  }

  try {
    const shortcut = await getShortcutBySlug(slug);
    if (!shortcut) return res.status(404).json({ error: "Shortcut not found" });

    const result = await reorderShortcutPlace(shortcut.id, placeId, direction);
    if (result === null) {
      return res.status(404).json({ error: "Place not found in shortcut" });
    }
    return res.json({ moved: result.moved });
  } catch (err) {
    logger.error("reorderShortcutPlace failed", { err });
    return res.status(500).json({ error: "Internal server error" });
  }
}
