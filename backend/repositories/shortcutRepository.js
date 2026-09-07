import pool from "../config/db.js";

export async function listShortcuts(lang = "en") {
  const [rows] = await pool.query(
    `SELECT
       s.id,
       s.slug,
       s.sort_order,
       COALESCE(t.title, f.title) AS title
     FROM shortcuts s
     LEFT JOIN shortcut_translations t ON t.shortcut_id = s.id AND t.lang = ?
     LEFT JOIN shortcut_translations f ON f.shortcut_id = s.id AND f.lang = 'en'
     ORDER BY s.sort_order ASC, s.id ASC`,
    [lang]
  );
  return rows;
}

export async function getShortcutBySlug(slug) {
  const [rows] = await pool.query(
    `SELECT s.id, s.slug, s.sort_order,
            s.created_at, s.updated_at
     FROM shortcuts s WHERE s.slug = ? LIMIT 1`,
    [slug]
  );
  if (!rows.length) return null;

  const shortcut = rows[0];
  const [translations] = await pool.query(
    `SELECT lang, title FROM shortcut_translations
     WHERE shortcut_id = ? ORDER BY lang ASC`,
    [shortcut.id]
  );

  return { ...shortcut, translations };
}

export async function createShortcut({ slug, sort_order, translations = {} }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [countRows] = await conn.query("SELECT COUNT(*) AS cnt FROM shortcuts FOR UPDATE");
    if (Number(countRows[0].cnt) >= 6) {
      const err = new Error("Maximum 6 shortcuts allowed. Delete one first.");
      err.code = "SHORTCUT_LIMIT_REACHED";
      throw err;
    }

    let finalSortOrder = sort_order;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const [[maxRow]] = await conn.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM shortcuts FOR UPDATE");
      finalSortOrder = maxRow.next;
    }

    const [result] = await conn.query(
      "INSERT INTO shortcuts (slug, sort_order) VALUES (?, ?)",
      [slug, finalSortOrder]
    );
    const shortcutId = Number(result.insertId);

    for (const [lang, data] of Object.entries(translations)) {
      if (!(data.title || "").trim()) continue;
      await conn.query(
        `INSERT INTO shortcut_translations (shortcut_id, lang, title)
         VALUES (?, ?, ?)`,
        [shortcutId, lang, data.title]
      );
    }

    await conn.commit();
    return shortcutId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateShortcutBySlug(slug, { sort_order, translations = {} }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existing] = await conn.query("SELECT id FROM shortcuts WHERE slug = ? LIMIT 1", [slug]);
    if (!existing.length) {
      await conn.rollback();
      return false;
    }
    const shortcutId = Number(existing[0].id);

    const sets = [];
    const params = [];
    if (sort_order !== undefined) { sets.push("sort_order = ?"); params.push(sort_order); }
    if (sets.length) {
      params.push(shortcutId);
      await conn.query(`UPDATE shortcuts SET ${sets.join(", ")} WHERE id = ?`, params);
    }

    for (const [lang, data] of Object.entries(translations)) {
      if (lang !== "en" && !(data.title || "").trim()) {
        await conn.query(
          "DELETE FROM shortcut_translations WHERE shortcut_id = ? AND lang = ?",
          [shortcutId, lang]
        );
      } else {
        await conn.query(
          `INSERT INTO shortcut_translations (shortcut_id, lang, title)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE title = VALUES(title)`,
          [shortcutId, lang, data.title]
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

export async function deleteShortcutBySlug(slug) {
  const [result] = await pool.query(
    "DELETE FROM shortcuts WHERE slug = ?", [slug]
  );
  return result.affectedRows;
}

export async function reorderShortcut(slug, direction) {
  if (direction !== "up" && direction !== "down") return null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT id, slug FROM shortcuts ORDER BY sort_order ASC, id ASC FOR UPDATE"
    );
    for (let i = 0; i < rows.length; i += 1) {
      await conn.query("UPDATE shortcuts SET sort_order = ? WHERE id = ?", [i + 1, rows[i].id]);
    }

    const idx = rows.findIndex((r) => r.slug === slug);
    if (idx === -1) {
      await conn.rollback();
      return null;
    }

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) {
      await conn.commit();
      return { moved: false };
    }

    await conn.query("UPDATE shortcuts SET sort_order = ? WHERE id = ?", [swapIdx + 1, rows[idx].id]);
    await conn.query("UPDATE shortcuts SET sort_order = ? WHERE id = ?", [idx + 1, rows[swapIdx].id]);

    await conn.commit();
    return { moved: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
