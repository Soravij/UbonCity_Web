import pool from "../config/db.js";

export async function listSituations(lang = "en") {
  const [rows] = await pool.query(
    `SELECT
       s.id,
       s.slug,
       s.sort_order,
       s.is_active,
       s.image_url,
       COALESCE(t.title, f.title) AS title,
       COALESCE(t.description, f.description) AS description
     FROM situations s
     LEFT JOIN situation_translations t ON t.situation_id = s.id AND t.lang = ?
     LEFT JOIN situation_translations f ON f.situation_id = s.id AND f.lang = 'en'
     ORDER BY s.sort_order ASC, s.id ASC`,
    [lang]
  );
  return rows;
}

export async function getSituationBySlug(slug) {
  const [rows] = await pool.query(
    `SELECT s.id, s.slug, s.sort_order, s.is_active, s.image_url,
            s.created_at, s.updated_at
     FROM situations s WHERE s.slug = ? LIMIT 1`,
    [slug]
  );
  if (!rows.length) return null;

  const situation = rows[0];
  const [translations] = await pool.query(
    `SELECT lang, title, description FROM situation_translations
     WHERE situation_id = ? ORDER BY lang ASC`,
    [situation.id]
  );

  return { ...situation, translations };
}

export async function createSituation({ slug, sort_order = 0, is_active = 1, image_url = null, translations = {} }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      "INSERT INTO situations (slug, sort_order, is_active, image_url) VALUES (?, ?, ?, ?)",
      [slug, sort_order, is_active, image_url]
    );
    const situationId = Number(result.insertId);

    for (const [lang, data] of Object.entries(translations)) {
      if (!(data.title || "").trim()) continue;
      await conn.query(
        `INSERT INTO situation_translations (situation_id, lang, title, description)
         VALUES (?, ?, ?, ?)`,
        [situationId, lang, data.title, data.description || null]
      );
    }

    await conn.commit();
    return situationId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateSituationBySlug(slug, { sort_order, is_active, image_url, translations = {} }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query("SELECT id FROM situations WHERE slug = ? LIMIT 1", [slug]);
    if (!existing.length) {
      await conn.rollback();
      return false;
    }
    const situationId = Number(existing[0].id);

    const sets = [];
    const params = [];
    if (sort_order !== undefined) { sets.push("sort_order = ?"); params.push(sort_order); }
    if (is_active !== undefined) { sets.push("is_active = ?"); params.push(is_active); }
    if (image_url !== undefined) { sets.push("image_url = ?"); params.push(image_url); }
    if (sets.length) {
      params.push(situationId);
      await conn.query(`UPDATE situations SET ${sets.join(", ")} WHERE id = ?`, params);
    }

    for (const [lang, data] of Object.entries(translations)) {
      if (lang !== "en" && !(data.title || "").trim()) {
        await conn.query(
          "DELETE FROM situation_translations WHERE situation_id = ? AND lang = ?",
          [situationId, lang]
        );
      } else {
        await conn.query(
          `INSERT INTO situation_translations (situation_id, lang, title, description)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description)`,
          [situationId, lang, data.title, data.description || null]
        );
      }
    }

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function deleteSituationBySlug(slug) {
  const [result] = await pool.query(
    "DELETE FROM situations WHERE slug = ?", [slug]
  );
  return result.affectedRows;
}
