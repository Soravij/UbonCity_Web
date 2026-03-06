import pool from "../config/db.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "uboncity_secret";

let ensuredApprovalColumn = false;

function isAuthenticatedRequest(req) {
  try {
    const authHeader = String(req.headers?.authorization || "").trim();
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return false;

    const decoded = jwt.verify(match[1], JWT_SECRET);
    return Boolean(decoded?.id);
  } catch {
    return false;
  }
}

async function ensureApprovalColumn() {
  if (ensuredApprovalColumn) return;

  const [columns] = await pool.query("SHOW COLUMNS FROM places LIKE 'is_approved'");
  if (columns.length === 0) {
    await pool.query("ALTER TABLE places ADD COLUMN is_approved TINYINT(1) NOT NULL DEFAULT 0");
  }

  ensuredApprovalColumn = true;
}

async function getCategoryIdBySlug(categorySlug) {
  const [rows] = await pool.query("SELECT id FROM categories WHERE slug=? LIMIT 1", [categorySlug]);
  return rows.length ? rows[0].id : null;
}

async function getExistingTranslation(placeId, lang) {
  const [rows] = await pool.query(
    "SELECT id FROM place_translations WHERE place_id=? AND lang=? LIMIT 1",
    [placeId, lang]
  );

  return rows.length ? rows[0].id : null;
}

export const getPlaces = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const { category, lang, include_unapproved } = req.query;

    if (!category || !lang) {
      return res.json({ items: [] });
    }

    const includeUnapproved = String(include_unapproved || "") === "1" && isAuthenticatedRequest(req);
    const approvalFilter = includeUnapproved ? "" : "AND p.is_approved=1";

    const [rows] = await pool.query(
      `SELECT
         p.id,
         c.slug AS category,
         pt.lang,
         p.slug,
         pt.title,
         pt.description,
         pt.meta_title,
         pt.meta_description,
         p.image,
         p.is_approved
       FROM places p
       JOIN categories c ON c.id = p.category_id
       JOIN place_translations pt ON pt.place_id = p.id
       WHERE c.slug=? AND pt.lang=? ${approvalFilter}
       ORDER BY p.id DESC`,
      [category, lang]
    );

    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getPlaceDetail = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const { category, slug } = req.params;
    const { lang = "th", include_unapproved } = req.query;

    const includeUnapproved = String(include_unapproved || "") === "1" && isAuthenticatedRequest(req);

    const [rows] = await pool.query(
      `SELECT
         p.id,
         c.slug AS category,
         p.slug,
         p.image,
         p.is_approved,
         pt.lang,
         pt.title,
         pt.description,
         pt.meta_title,
         pt.meta_description
       FROM places p
       JOIN categories c ON c.id = p.category_id
       JOIN place_translations pt ON pt.place_id = p.id AND pt.lang=?
       WHERE c.slug=? AND p.slug=? ${includeUnapproved ? "" : "AND p.is_approved=1"}
       LIMIT 1`,
      [lang, category, slug]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Place not found" });
    }

    return res.json({ item: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const createPlace = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const {
      group_id,
      category,
      lang,
      slug,
      title,
      description,
      meta_title,
      meta_description,
      image,
    } = req.body;

    if (!category || !lang || !title || !description) {
      return res.status(400).json({ error: "category, lang, title, description are required" });
    }

    const categoryId = await getCategoryIdBySlug(category);
    if (!categoryId) {
      return res.status(400).json({ error: `Unknown category: ${category}` });
    }

    let placeId = null;

    if (group_id && Number.isFinite(Number(group_id))) {
      const [existingPlace] = await pool.query("SELECT id FROM places WHERE id=? LIMIT 1", [Number(group_id)]);
      if (existingPlace.length) {
        placeId = existingPlace[0].id;
      }
    }

    if (!placeId) {
      const [insertPlace] = await pool.query(
        "INSERT INTO places (category_id,slug,image,is_approved) VALUES (?,?,?,0)",
        [categoryId, slug || null, image || null]
      );
      placeId = insertPlace.insertId;
    } else {
      await pool.query(
        "UPDATE places SET category_id=?, slug=COALESCE(?,slug), image=COALESCE(?,image), is_approved=0 WHERE id=?",
        [categoryId, slug || null, image || null, placeId]
      );
    }

    const existingTranslationId = await getExistingTranslation(placeId, lang);

    if (existingTranslationId) {
      await pool.query(
        `UPDATE place_translations
         SET title=?, description=?, meta_title=?, meta_description=?
         WHERE id=?`,
        [title, description, meta_title || null, meta_description || null, existingTranslationId]
      );
    } else {
      await pool.query(
        `INSERT INTO place_translations
         (place_id,lang,title,description,meta_title,meta_description)
         VALUES (?,?,?,?,?,?)`,
        [placeId, lang, title, description, meta_title || null, meta_description || null]
      );
    }

    res.json({ message: "Created", place_id: placeId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updatePlace = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const { id } = req.params;
    const { lang, title, description, image, meta_title, meta_description } = req.body;

    if (!lang) {
      return res.status(400).json({ error: "lang is required for update" });
    }

    await pool.query("UPDATE places SET image=?, is_approved=0 WHERE id=?", [image || null, id]);

    const existingTranslationId = await getExistingTranslation(id, lang);
    if (!existingTranslationId) {
      return res.status(404).json({ error: "Translation not found for this lang" });
    }

    await pool.query(
      `UPDATE place_translations
       SET title=?, description=?, meta_title=?, meta_description=?
       WHERE id=?`,
      [title, description, meta_title || null, meta_description || null, existingTranslationId]
    );

    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const approvePlace = async (req, res) => {
  try {
    await ensureApprovalColumn();

    const { id } = req.params;
    await pool.query("UPDATE places SET is_approved=1 WHERE id=?", [id]);

    return res.json({ message: "Approved" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const deletePlace = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM place_translations WHERE place_id=?", [id]);
    await pool.query("DELETE FROM places WHERE id=?", [id]);

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

