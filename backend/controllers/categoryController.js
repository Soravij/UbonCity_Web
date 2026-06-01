import pool from "../config/db.js";
import {
  createCategoryWithTranslation,
  deleteCategoryBySlug,
  findCategoryIdBySlug,
  getCategoryBySlug,
  listCategories,
  updateCategorySlugById,
  upsertCategoryTranslation,
} from "../repositories/categoryRepository.js";
import { normalizeContentLang } from "../constants/languages.js";
import { validateCategoryCreatePayload, validateCategoryUpdatePayload } from "../validators/categoryValidator.js";
import { cleanSlug } from "../validators/inputSanitizer.js";

let ensuredCategoryTables = false;

async function ensureCategoryTables() {
  if (ensuredCategoryTables) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS category_translations (
      id INT NOT NULL AUTO_INCREMENT,
      category_id INT NOT NULL,
      lang VARCHAR(8) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_category_lang (category_id, lang)
    )
  `);

  ensuredCategoryTables = true;
}

export async function getCategories(req, res) {
  try {
    await ensureCategoryTables();

    const lang = normalizeContentLang(req.query?.lang, "th");
    const items = await listCategories(lang);
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getCategoryDetail(req, res) {
  try {
    await ensureCategoryTables();

    const lang = normalizeContentLang(req.query?.lang, "th");
    const item = await getCategoryBySlug(String(req.params?.slug || "").trim().toLowerCase(), lang);
    if (!item) return res.status(404).json({ error: "Category not found" });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function createCategory(req, res) {
  const validated = validateCategoryCreatePayload(req.body || {});
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  const payload = validated.value;

  try {
    await ensureCategoryTables();

    const existsId = await findCategoryIdBySlug(payload.slug);
    if (existsId) {
      return res.status(409).json({ error: "slug already exists" });
    }

    const categoryId = await createCategoryWithTranslation(payload);
    return res.json({ message: "Category created", id: categoryId });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function updateCategory(req, res) {
  let currentSlug = "";
  let nextSlug = "";
  try {
    currentSlug = cleanSlug(req.params?.slug, { required: true, field: "slug" });
    nextSlug = req.body?.slug ? cleanSlug(req.body.slug, { field: "slug" }) : currentSlug;
  } catch (err) {
    return res.status(400).json({ error: String(err?.message || "Invalid slug") });
  }
  const validated = validateCategoryUpdatePayload(req.body || {});

  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    await ensureCategoryTables();

    const categoryId = await findCategoryIdBySlug(currentSlug);
    if (!categoryId) return res.status(404).json({ error: "Category not found" });

    if (nextSlug !== currentSlug) {
      const duplicate = await findCategoryIdBySlug(nextSlug);
      if (duplicate && Number(duplicate) !== Number(categoryId)) {
        return res.status(409).json({ error: "slug already exists" });
      }
      await updateCategorySlugById(categoryId, nextSlug);
    }

    await upsertCategoryTranslation({
      categoryId,
      lang: validated.value.lang,
      title: validated.value.title,
      description: validated.value.description,
    });

    return res.json({ message: "Category updated" });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function deleteCategory(req, res) {
  try {
    await ensureCategoryTables();

    const deleted = await deleteCategoryBySlug(String(req.params?.slug || "").trim().toLowerCase());
    if (!deleted) return res.status(404).json({ error: "Category not found" });
    return res.json({ message: "Category deleted" });
  } catch (err) {
    if (String(err?.message || "").includes("existing places")) {
      return res.status(409).json({ error: "Internal server error" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

