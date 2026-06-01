import pool from "../config/db.js";

function slugify(input) {
  const base = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "item";
}

function isPlaceholderSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return slug === "item" || /^item-\d+$/.test(slug);
}

async function ensureUniquePlaceSlug(connection, initialSlug, excludePlaceId) {
  const base = String(initialSlug || "place").trim().toLowerCase();
  let candidate = base;
  let suffix = 2;
  while (true) {
    const [rows] = await connection.query("SELECT id FROM places WHERE slug=? LIMIT 1", [candidate]);
    if (!rows.length) return candidate;
    const matchedId = Number(rows[0]?.id || 0) || null;
    if (excludePlaceId && matchedId === Number(excludePlaceId)) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function computeTargetSlug(placeId, title, translationTitle) {
  const preferredTitle = String(title || "").trim() || String(translationTitle || "").trim();
  const fromTitle = slugify(preferredTitle);
  if (!isPlaceholderSlug(fromTitle)) return fromTitle;
  return `place-${placeId}`;
}

async function main() {
  const connection = await pool.getConnection();
  let changed = 0;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT p.id, p.slug, pt.title AS th_title
       FROM places p
       LEFT JOIN place_translations pt ON pt.place_id = p.id AND pt.lang='th'
       WHERE p.slug REGEXP '^item(-[0-9]+)?$'
          OR p.slug IS NULL
          OR TRIM(p.slug) = ''
          OR p.slug LIKE '-%'`
    );

    for (const row of rows) {
      const placeId = Number(row.id || 0) || 0;
      if (!placeId) continue;
      const targetBase = computeTargetSlug(placeId, "", row.th_title);
      const targetSlug = await ensureUniquePlaceSlug(connection, targetBase, placeId);
      if (targetSlug === row.slug) continue;

      await connection.query("UPDATE places SET slug=? WHERE id=?", [targetSlug, placeId]);
      await connection.query(
        "UPDATE review_contents SET slug=?, updated_at=CURRENT_TIMESTAMP WHERE public_entity_type='place' AND public_entity_id=? AND status='published'",
        [targetSlug, placeId]
      );
      changed += 1;
      console.log(`place ${placeId}: ${row.slug} -> ${targetSlug}`);
    }

    await connection.commit();
    console.log(`done: ${changed} place slugs updated`);
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
