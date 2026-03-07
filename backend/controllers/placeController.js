import pool from "../config/db.js";
import jwt from "jsonwebtoken";
import OpenAI from "openai";

const JWT_SECRET = process.env.JWT_SECRET || "uboncity_secret";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

function normalizeSlugInput(rawSlug) {
  const value = String(rawSlug || "").trim();
  return value || null;
}

function fallbackSlugById(id) {
  return `place-${Number(id)}`;
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

async function ensureFallbackSlug(placeId) {
  const numericId = Number(placeId);
  if (!Number.isFinite(numericId)) return;

  await pool.query(
    "UPDATE places SET slug=COALESCE(NULLIF(TRIM(slug), ''), ?) WHERE id=?",
    [fallbackSlugById(numericId), numericId]
  );
}

function extractImageMarkdownBlocks(text) {
  const source = String(text || "");
  const regex = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  const blocks = [];

  for (const match of source.matchAll(regex)) {
    const full = String(match?.[0] || "").trim();
    const url = String(match?.[1] || "").trim();
    if (!full || !url) continue;
    blocks.push({ full, url });
  }

  return blocks;
}

function mergeDescriptionWithThaiImages(requestedDescription, thaiDescription, lang) {
  const req = String(requestedDescription || "").trim();
  const th = String(thaiDescription || "").trim();

  if (lang === "th") return req || th;

  const thaiImages = extractImageMarkdownBlocks(th);
  if (!thaiImages.length) return req || th;

  const reqImages = extractImageMarkdownBlocks(req);
  if (reqImages.length >= thaiImages.length) return req || th;

  const reqUrls = new Set(reqImages.map((item) => item.url));
  const missingBlocks = thaiImages
    .filter((item) => !reqUrls.has(item.url))
    .map((item) => item.full);

  if (!missingBlocks.length) return req || th;
  if (!req) return `${th}\n\n${missingBlocks.join("\n\n")}`;

  return `${req}\n\n${missingBlocks.join("\n\n")}`;
}

function extractPlainTextForMeta(value) {
  return String(value || "")
    .replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveMetaDescription(metaDescription, description) {
  const direct = extractPlainTextForMeta(metaDescription);
  if (direct && direct.length <= 160) return direct;

  const source = extractPlainTextForMeta(description);
  if (!source) return direct ? direct.slice(0, 160) : null;

  if (source.length <= 160) return source;
  const clipped = source.slice(0, 157).trimEnd();
  return `${clipped}...`;
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
         ? AS lang,
         COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
         COALESCE(pt_req.title, pt_th.title) AS title,
         COALESCE(pt_req.description, pt_th.description) AS description,
         pt_req.description AS req_description,
         pt_th.description AS th_description,
         COALESCE(pt_req.meta_title, pt_th.meta_title) AS meta_title,
         COALESCE(pt_req.meta_description, pt_th.meta_description) AS meta_description,
         p.image,
         p.is_approved
       FROM places p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
       LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
       WHERE c.slug=? ${approvalFilter}
         AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
       ORDER BY p.id DESC`,
      [lang, lang, category]
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
         COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
         p.image,
         p.is_approved,
         ? AS lang,
         COALESCE(pt_req.title, pt_th.title) AS title,
         COALESCE(pt_req.description, pt_th.description) AS description,
         pt_req.description AS req_description,
         pt_th.description AS th_description,
         COALESCE(pt_req.meta_title, pt_th.meta_title) AS meta_title,
         COALESCE(pt_req.meta_description, pt_th.meta_description) AS meta_description
       FROM places p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
       LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
       WHERE c.slug=? AND p.slug=? ${includeUnapproved ? "" : "AND p.is_approved=1"}
         AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
       LIMIT 1`,
      [lang, lang, category, slug]
    );

    if (!rows.length) {
      const fallbackMatch = String(slug || "").match(/^place-(\d+)$/);
      if (fallbackMatch) {
        const fallbackId = Number(fallbackMatch[1]);
        const [fallbackRows] = await pool.query(
          `SELECT
             p.id,
             c.slug AS category,
             COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
             p.image,
             p.is_approved,
             ? AS lang,
             COALESCE(pt_req.title, pt_th.title) AS title,
             COALESCE(pt_req.description, pt_th.description) AS description,
         pt_req.description AS req_description,
         pt_th.description AS th_description,
             COALESCE(pt_req.meta_title, pt_th.meta_title) AS meta_title,
             COALESCE(pt_req.meta_description, pt_th.meta_description) AS meta_description
           FROM places p
           JOIN categories c ON c.id = p.category_id
           LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
           LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
           WHERE c.slug=? AND p.id=? ${includeUnapproved ? "" : "AND p.is_approved=1"}
             AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
           LIMIT 1`,
          [lang, lang, category, fallbackId]
        );

        if (fallbackRows.length) {
          const item = {
            ...fallbackRows[0],
            description: mergeDescriptionWithThaiImages(
              fallbackRows[0]?.req_description,
              fallbackRows[0]?.th_description,
              lang
            ),
          };
          delete item.req_description;
          delete item.th_description;
          return res.json({ item });
        }
      }

      return res.status(404).json({ error: "Place not found" });
    }

    const item = {
      ...rows[0],
      description: mergeDescriptionWithThaiImages(rows[0]?.req_description, rows[0]?.th_description, lang),
    };
    delete item.req_description;
    delete item.th_description;

    return res.json({ item });
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

    const normalizedSlug = normalizeSlugInput(slug);
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
        [categoryId, normalizedSlug, image || null]
      );
      placeId = insertPlace.insertId;
      if (!normalizedSlug) {
        await ensureFallbackSlug(placeId);
      }
    } else {
      await pool.query(
        "UPDATE places SET category_id=?, slug=COALESCE(?,slug), image=?, is_approved=0 WHERE id=?",
        [categoryId, normalizedSlug, image || null, placeId]
      );
      if (!normalizedSlug) {
        await ensureFallbackSlug(placeId);
      }
    }

    const existingTranslationId = await getExistingTranslation(placeId, lang);

    if (existingTranslationId) {
      await pool.query(
        `UPDATE place_translations
         SET title=?, description=?, meta_title=?, meta_description=?
         WHERE id=?`,
        [title, description, meta_title || null, resolveMetaDescription(meta_description, description), existingTranslationId]
      );
    } else {
      await pool.query(
        `INSERT INTO place_translations
         (place_id,lang,title,description,meta_title,meta_description)
         VALUES (?,?,?,?,?,?)`,
        [placeId, lang, title, description, meta_title || null, resolveMetaDescription(meta_description, description)]
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
    await ensureFallbackSlug(id);

    const existingTranslationId = await getExistingTranslation(id, lang);
    if (!existingTranslationId) {
      return res.status(404).json({ error: "Translation not found for this lang" });
    }

    await pool.query(
      `UPDATE place_translations
       SET title=?, description=?, meta_title=?, meta_description=?
       WHERE id=?`,
      [title, description, meta_title || null, resolveMetaDescription(meta_description, description), existingTranslationId]
    );

    res.json({ message: "Updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function parseModelJson(rawText) {
  const text = String(rawText || "").trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenceMatch ? fenceMatch[1].trim() : text;

  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error("Model response is not valid JSON");
  }
}

async function translateFromThai(title, description, targetLang) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a professional tourism translator. Return only JSON with keys title and description.",
      },
      {
        role: "user",
        content:
          `Source language: th (Thai)\nTarget language: ${targetLang}\n` +
          "Keep markdown image tags exactly as original if present in description.\n" +
          "For target lo, output must be in Lao language (not Thai).\n\n" +
          `Title: ${title}\nDescription: ${description}`,
      },
    ],
  });

  const text = response.choices?.[0]?.message?.content;
  const parsed = parseModelJson(text);
  return {
    title: String(parsed?.title || "").trim(),
    description: String(parsed?.description || "").trim(),
  };
}

export const approvePlace = async (req, res) => {
  const logs = [];
  try {
    await ensureApprovalColumn();

    const { id } = req.params;
    const placeId = Number(id);
    logs.push(`start approve place_id=${id}`);

    if (!Number.isFinite(placeId)) {
      logs.push("invalid place id");
      return res.status(400).json({ error: "Invalid place id", logs });
    }

    const [thRows] = await pool.query(
      `SELECT title, description, meta_title, meta_description
       FROM place_translations
       WHERE place_id=? AND lang='th'
       LIMIT 1`,
      [placeId]
    );
    logs.push(`loaded thai source rows=${thRows.length}`);

    if (!thRows.length) {
      logs.push("thai source not found");
      return res.status(400).json({ error: "Thai source translation not found", logs });
    }

    const source = thRows[0];

    for (const lang of ["en", "zh", "lo"]) {
      logs.push(`[${lang}] begin translate`);

      let translatedTitle = String(source.title || "").trim();
      let translatedDescription = String(source.description || "").trim();

      try {
        const translated = await translateFromThai(source.title || "", source.description || "", lang);
        if (translated.title) translatedTitle = translated.title;
        if (translated.description) translatedDescription = translated.description;
        logs.push(
          `[${lang}] ai translated ok title_len=${translatedTitle.length} desc_len=${translatedDescription.length}`
        );
      } catch {
        logs.push(`[${lang}] ai translate failed -> fallback thai`);
      }

      const existingTranslationId = await getExistingTranslation(placeId, lang);
      const targetMeta = resolveMetaDescription(null, translatedDescription);

      if (existingTranslationId) {
        await pool.query(
          `UPDATE place_translations
           SET title=?, description=?, meta_title=?, meta_description=?
           WHERE id=?`,
          [
            translatedTitle || null,
            translatedDescription || null,
            translatedTitle || null,
            targetMeta,
            existingTranslationId,
          ]
        );
        logs.push(`[${lang}] updated translation id=${existingTranslationId}`);
      } else {
        await pool.query(
          `INSERT INTO place_translations
           (place_id,lang,title,description,meta_title,meta_description)
           VALUES (?,?,?,?,?,?)`,
          [
            placeId,
            lang,
            translatedTitle || null,
            translatedDescription || null,
            translatedTitle || null,
            targetMeta,
          ]
        );
        logs.push(`[${lang}] inserted translation`);
      }
    }

    const [result] = await pool.query("UPDATE places SET is_approved=1 WHERE id=?", [placeId]);
    if (!result.affectedRows) {
      logs.push("place row not found on approve update");
      return res.status(404).json({ error: "Place not found", logs });
    }
    logs.push("approved flag set");

    return res.json({ message: "Approved", logs });
  } catch (err) {
    logs.push(`fatal: ${err.message}`);
    return res.status(500).json({ error: err.message, logs });
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











