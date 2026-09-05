import pool from "../config/db.js";

export async function listPlacesBySituation(situationId, lang = "en") {
  const [rows] = await pool.query(
    `SELECT
       p.id,
       COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
       COALESCE(pt_req.title, pt_th.title) AS title,
       COALESCE(pt_req.description, pt_th.description) AS description,
       c.slug AS category,
       p.image,
       p.decision_cover_image,
       p.decision_thumbnail_image,
       sp.sort_order
     FROM situation_places sp
     JOIN places p ON p.id = sp.place_id
     JOIN categories c ON c.id = p.category_id
     LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang = ?
     LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang = 'th'
     WHERE sp.situation_id = ?
     ORDER BY sp.sort_order ASC, sp.id ASC`,
    [lang, situationId]
  );
  return rows;
}

export async function addPlacesToSituation(situationId, placeIds) {
  if (!Array.isArray(placeIds) || !placeIds.length) return 0;

  const [[maxRow]] = await pool.query(
    "SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM situation_places WHERE situation_id = ?",
    [situationId]
  );
  let nextSort = Number(maxRow.maxSort) + 1;

  let inserted = 0;
  for (const placeId of placeIds) {
    const [result] = await pool.query(
      `INSERT IGNORE INTO situation_places (situation_id, place_id, sort_order)
       VALUES (?, ?, ?)`,
      [situationId, placeId, nextSort]
    );
    if (result.affectedRows > 0) {
      inserted += 1;
      nextSort += 1;
    }
  }
  return inserted;
}

export async function removePlaceFromSituation(situationId, placeId) {
  const [result] = await pool.query(
    "DELETE FROM situation_places WHERE situation_id = ? AND place_id = ?",
    [situationId, placeId]
  );
  return result.affectedRows;
}

export async function reorderSituationPlace(situationId, placeId, direction) {
  if (direction !== "up" && direction !== "down") return null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT place_id, sort_order FROM situation_places WHERE situation_id = ? ORDER BY sort_order ASC, id ASC FOR UPDATE",
      [situationId]
    );
    for (let i = 0; i < rows.length; i += 1) {
      await conn.query(
        "UPDATE situation_places SET sort_order = ? WHERE situation_id = ? AND place_id = ?",
        [i + 1, situationId, rows[i].place_id]
      );
    }

    const idx = rows.findIndex((r) => Number(r.place_id) === Number(placeId));
    if (idx === -1) {
      await conn.rollback();
      return null;
    }

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) {
      await conn.commit();
      return { moved: false };
    }

    await conn.query(
      "UPDATE situation_places SET sort_order = ? WHERE situation_id = ? AND place_id = ?",
      [swapIdx + 1, situationId, rows[idx].place_id]
    );
    await conn.query(
      "UPDATE situation_places SET sort_order = ? WHERE situation_id = ? AND place_id = ?",
      [idx + 1, situationId, rows[swapIdx].place_id]
    );

    await conn.commit();
    return { moved: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
