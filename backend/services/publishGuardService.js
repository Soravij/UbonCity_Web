import pool from "../config/db.js";

function normText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function findEmerConflictForPlace({
  category,
  slug,
  title,
  excludeEntityId = null,
  executor = pool,
}) {
  const normalizedCategory = String(category || "").trim().toLowerCase();
  const normalizedSlug = normSlug(slug);
  const normalizedTitle = normText(title);
  if (!normalizedCategory || (!normalizedSlug && !normalizedTitle)) return null;

  const sql = `
    SELECT
      p.id,
      c.slug AS category,
      p.slug,
      p.is_emer,
      COALESCE(pt_th.title, '') AS th_title
    FROM places p
    JOIN categories c ON c.id = p.category_id
    LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
    WHERE p.is_emer=1
      AND c.slug=?
      ${excludeEntityId ? "AND p.id<>?" : ""}
  `;
  const params = excludeEntityId ? [normalizedCategory, Number(excludeEntityId)] : [normalizedCategory];
  const [rows] = await executor.query(sql, params);
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowSlug = normSlug(row?.slug);
    const rowTitle = normText(row?.th_title);
    const sameSlug = normalizedSlug && rowSlug && normalizedSlug === rowSlug;
    const sameTitle = normalizedTitle && rowTitle && normalizedTitle === rowTitle;
    if (sameSlug || sameTitle) {
      return {
        entity_type: "place",
        entity_id: Number(row.id || 0) || 0,
        category: String(row.category || "").trim() || null,
        slug: String(row.slug || "").trim() || null,
        title: String(row.th_title || "").trim() || null,
        is_emer: 1,
      };
    }
  }
  return null;
}

export async function findEmerConflictForEvent({
  title,
  excludeEntityId = null,
  executor = pool,
}) {
  const normalizedTitle = normText(title);
  if (!normalizedTitle) return null;

  const sql = `
    SELECT
      e.id,
      e.is_emer,
      COALESCE(et_th.title, e.title, '') AS th_title
    FROM events e
    LEFT JOIN event_translations et_th ON et_th.event_id = e.id AND et_th.lang='th'
    WHERE e.is_emer=1
      ${excludeEntityId ? "AND e.id<>?" : ""}
  `;
  const params = excludeEntityId ? [Number(excludeEntityId)] : [];
  const [rows] = await executor.query(sql, params);
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowTitle = normText(row?.th_title);
    if (rowTitle && rowTitle === normalizedTitle) {
      return {
        entity_type: "event",
        entity_id: Number(row.id || 0) || 0,
        category: "event",
        slug: null,
        title: String(row.th_title || "").trim() || null,
        is_emer: 1,
      };
    }
  }
  return null;
}

export async function assertNoEmerConflictForPublish({
  entityType,
  category = null,
  slug = null,
  title = null,
  excludeEntityId = null,
  executor = pool,
}) {
  const normalizedType = String(entityType || "").trim().toLowerCase();
  let conflict = null;
  if (normalizedType === "place") {
    conflict = await findEmerConflictForPlace({
      category,
      slug,
      title,
      excludeEntityId,
      executor,
    });
  } else if (normalizedType === "event") {
    conflict = await findEmerConflictForEvent({
      title,
      excludeEntityId,
      executor,
    });
  }

  if (conflict) {
    const err = new Error("Emergency content already exists for this item. Purge it before publishing canonical content.");
    err.code = "EMER_CONFLICT";
    err.statusCode = 409;
    err.payload = {
      error: "emer_conflict",
      message: err.message,
      conflict,
    };
    throw err;
  }
}
