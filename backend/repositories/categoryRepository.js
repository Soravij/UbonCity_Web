import pool from "../config/db.js";

export async function findCategoryIdBySlug(slug) {
  const [rows] = await pool.query("SELECT id FROM categories WHERE slug=? LIMIT 1", [slug]);
  return rows.length ? Number(rows[0].id) : null;
}

export async function listCategories(lang = "th") {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.slug,
       COALESCE(ct_lang.title, ct_th.title, c.slug) AS title,
       COALESCE(ct_lang.description, ct_th.description, NULL) AS description,
       ? AS lang,
       c.created_at
     FROM categories c
     LEFT JOIN category_translations ct_lang ON ct_lang.category_id=c.id AND ct_lang.lang=?
     LEFT JOIN category_translations ct_th ON ct_th.category_id=c.id AND ct_th.lang='th'
     ORDER BY c.id ASC`,
    [lang, lang]
  );

  return rows;
}

export async function getCategoryBySlug(slug, lang = "th") {
  const [rows] = await pool.query(
    `SELECT
       c.id,
       c.slug,
       COALESCE(ct_lang.title, ct_th.title, c.slug) AS title,
       COALESCE(ct_lang.description, ct_th.description, NULL) AS description,
       ? AS lang,
       c.created_at
     FROM categories c
     LEFT JOIN category_translations ct_lang ON ct_lang.category_id=c.id AND ct_lang.lang=?
     LEFT JOIN category_translations ct_th ON ct_th.category_id=c.id AND ct_th.lang='th'
     WHERE c.slug=?
     LIMIT 1`,
    [lang, lang, slug]
  );

  return rows.length ? rows[0] : null;
}

export async function createCategoryWithTranslation({ slug, lang, title, description }) {
  const [insertResult] = await pool.query("INSERT INTO categories (slug) VALUES (?)", [slug]);
  const categoryId = Number(insertResult.insertId);

  await pool.query(
    `INSERT INTO category_translations (category_id, lang, title, description)
     VALUES (?,?,?,?)`,
    [categoryId, lang, title, description || null]
  );

  return categoryId;
}

export async function upsertCategoryTranslation({ categoryId, lang, title, description }) {
  await pool.query(
    `INSERT INTO category_translations (category_id, lang, title, description)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE
       title=VALUES(title),
       description=VALUES(description)`,
    [Number(categoryId), lang, title, description || null]
  );
}

export async function updateCategorySlugById(categoryId, slug) {
  await pool.query("UPDATE categories SET slug=? WHERE id=?", [slug, Number(categoryId)]);
}

export async function deleteCategoryBySlug(slug) {
  const [rows] = await pool.query("SELECT id FROM categories WHERE slug=? LIMIT 1", [slug]);
  if (!rows.length) return false;

  const categoryId = Number(rows[0].id);

  const [placeRows] = await pool.query("SELECT COUNT(*) AS total FROM places WHERE category_id=?", [categoryId]);
  if (Number(placeRows?.[0]?.total || 0) > 0) {
    throw new Error("Cannot delete category with existing places");
  }

  await pool.query("DELETE FROM category_translations WHERE category_id=?", [categoryId]);
  const [result] = await pool.query("DELETE FROM categories WHERE id=?", [categoryId]);

  return Boolean(result.affectedRows);
}
