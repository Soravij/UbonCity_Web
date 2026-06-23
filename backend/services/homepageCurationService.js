import pool from "../config/db.js";
import { filterPlacesByCuratedTaxonomy } from "./curatedTaxonomyFilterService.js";

const VALID_SOURCE_MODES = new Set(["manual-first-hybrid", "manual-only", "rule-only"]);
const VALID_FALLBACK_MODES = new Set(["latest-approved", "featured", "none"]);
const VALID_ENTITY_TYPES = new Set(["place", "event"]);
const FIXED_BLOCK_ORDER = ["hero", "top_picks", "trending", "scenarios", "featured_events"];
const FIXED_BLOCK_TYPES = {
  hero: "hero",
  top_picks: "place-list",
  trending: "place-list",
  scenarios: "scenario-grid",
  featured_events: "event-list",
};

const DEFAULT_BLOCK_COPY = {
  th: {
    hero: { title: "เลือกที่เที่ยวให้ง่ายขึ้น", subtitle: "บล็อกข้อความนำด้านบนของหน้าแรก" },
    top_picks: { title: "ตัวเด่นวันนี้", subtitle: "ใช้ manual ก่อน แล้วค่อยเติมจาก featured/latest" },
    trending: { title: "อัปเดตล่าสุด", subtitle: "รายการใหม่หรือกำลังถูกพูดถึง" },
    scenarios: { title: "เลือกตามสถานการณ์", subtitle: "บล็อกชุดแนะนำตามโจทย์ เช่น งบ 500 หรือมากับแฟน" },
    featured_events: { title: "อีเวนต์น่าสนใจ", subtitle: "ดึง event ที่อยากดันขึ้นหน้าแรก" },
  },
  en: {
    hero: { title: "Make the decision faster", subtitle: "Top-of-home hero messaging block" },
    top_picks: { title: "Top Picks", subtitle: "Use manual items first, then fill from featured/latest" },
    trending: { title: "Latest Updates", subtitle: "Fresh or trending items" },
    scenarios: { title: "By Situation", subtitle: "Scenario-based recommendation block" },
    featured_events: { title: "Featured Events", subtitle: "Push selected events onto the homepage" },
  },
  zh: {
    hero: { title: "更快做决定", subtitle: "首页顶部主视觉文案区块" },
    top_picks: { title: "精选推荐", subtitle: "优先使用手动选择，再补自动结果" },
    trending: { title: "最新更新", subtitle: "新内容或当前较热的内容" },
    scenarios: { title: "按情境选择", subtitle: "按需求场景整理的推荐区块" },
    featured_events: { title: "重点活动", subtitle: "将选定活动推到首页" },
  },
  lo: {
    hero: { title: "ຊ່ວຍໃຫ້ຕັດສິນໃຈໄດ້ໄວຂຶ້ນ", subtitle: "ບລັອກຂໍ້ຄວາມນຳດ້ານເທິງຂອງໜ້າຫຼັກ" },
    top_picks: { title: "ຕົວເລືອກເດັ່ນ", subtitle: "ໃຊ້ manual ກ່ອນ ແລ້ວຄ່ອຍເຕີມດ້ວຍ featured/latest" },
    trending: { title: "ອັບເດດຫຼ້າສຸດ", subtitle: "ລາຍການໃໝ່ ຫຼື ລາຍການທີ່ກຳລັງຖືກເວົ້າເຖິງ" },
    scenarios: { title: "ເລືອກຕາມສະຖານະການ", subtitle: "ບລັອກຊຸດແນະນຳຕາມໂຈດ" },
    featured_events: { title: "ອີເວັນເດັ່ນ", subtitle: "ດັນອີເວັນທີ່ເລືອກຂຶ້ນໜ້າຫຼັກ" },
  },
};

function normalizeLang(value) {
  const lang = String(value || "th").trim().toLowerCase();
  return ["th", "en", "zh", "lo"].includes(lang) ? lang : "th";
}

function normalizeLayoutKey(value) {
  const key = String(value || "home").trim().toLowerCase();
  return key || "home";
}

function getDefaultBlockCopy(lang, key) {
  const dict = DEFAULT_BLOCK_COPY[normalizeLang(lang)] || DEFAULT_BLOCK_COPY.th;
  return dict[key] || { title: key, subtitle: "" };
}

function createDefaultBlocks(lang = "th") {
  const activeLang = normalizeLang(lang);
  return [
    {
      key: "hero",
      type: "hero",
      enabled: true,
      position: 1,
      title: getDefaultBlockCopy(activeLang, "hero").title,
      subtitle: getDefaultBlockCopy(activeLang, "hero").subtitle,
      source_mode: "manual-first-hybrid",
      fallback_mode: "none",
      min_items: 0,
      max_items: 0,
      manual_items: [],
      rule_config: {
        category_scope: [],
        scenario_tags: [],
        sort_by: "featured_then_recent",
      },
    },
    {
      key: "top_picks",
      type: "place-list",
      enabled: true,
      position: 2,
      title: getDefaultBlockCopy(activeLang, "top_picks").title,
      subtitle: getDefaultBlockCopy(activeLang, "top_picks").subtitle,
      source_mode: "manual-first-hybrid",
      fallback_mode: "featured",
      min_items: 3,
      max_items: 10,
      manual_items: [],
      rule_config: {
        category_scope: ["attractions", "cafes", "restaurants", "activities", "hotels"],
        scenario_tags: [],
        sort_by: "featured_then_recent",
      },
    },
    {
      key: "trending",
      type: "place-list",
      enabled: true,
      position: 3,
      title: getDefaultBlockCopy(activeLang, "trending").title,
      subtitle: getDefaultBlockCopy(activeLang, "trending").subtitle,
      source_mode: "manual-first-hybrid",
      fallback_mode: "latest-approved",
      min_items: 3,
      max_items: 12,
      manual_items: [],
      rule_config: {
        category_scope: ["attractions", "cafes", "restaurants", "activities", "hotels"],
        scenario_tags: [],
        sort_by: "recent",
      },
    },
    {
      key: "scenarios",
      type: "scenario-grid",
      enabled: true,
      position: 4,
      title: getDefaultBlockCopy(activeLang, "scenarios").title,
      subtitle: getDefaultBlockCopy(activeLang, "scenarios").subtitle,
      source_mode: "manual-first-hybrid",
      fallback_mode: "featured",
      min_items: 4,
      max_items: 4,
      manual_items: [],
      rule_config: {
        category_scope: ["attractions", "cafes", "restaurants", "activities", "hotels"],
        scenario_tags: ["day-trip", "budget-500", "couple", "family"],
        sort_by: "scenario_match",
      },
    },
    {
      key: "featured_events",
      type: "event-list",
      enabled: true,
      position: 5,
      title: getDefaultBlockCopy(activeLang, "featured_events").title,
      subtitle: getDefaultBlockCopy(activeLang, "featured_events").subtitle,
      source_mode: "manual-first-hybrid",
      fallback_mode: "latest-approved",
      min_items: 2,
      max_items: 4,
      manual_items: [],
      rule_config: {
        category_scope: [],
        scenario_tags: [],
        sort_by: "recent",
      },
    },
  ];
}

function createDefaultBlockMap(lang = "th") {
  return new Map(createDefaultBlocks(lang).map((block) => [block.key, block]));
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseCuratedTaxonomyValue(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(value) ? value : null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeKeywordList(value) {
  return normalizeStringList(value).map((item) => item.toLowerCase());
}

function parseTagList(value) {
  return normalizeKeywordList(value);
}

function sortPlacesByFeaturedThenRecent(items) {
  return [...items].sort((a, b) => {
    const scoreDiff = Number(b?.decision_featured_score || 0) - Number(a?.decision_featured_score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function sortEventsByRecent(items) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a?.approved_at || a?.updated_at || a?.created_at || 0).getTime();
    const bTime = new Date(b?.approved_at || b?.updated_at || b?.created_at || 0).getTime();
    if (bTime !== aTime) return bTime - aTime;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function dedupeResolvedItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const type = String(item?.entity_type || "").trim().toLowerCase();
    const id = Number(item?.id || item?.entity_id || 0);
    if (!type || !id) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function itemMatchesKeywords(item, keywords) {
  if (!keywords.length) return true;
  const haystack = [
    item?.title,
    item?.description,
    item?.meta_title,
    item?.meta_description,
    item?.slug,
    item?.category,
  ]
    .map((part) => String(part || "").toLowerCase())
    .join("\n");
  return keywords.some((keyword) => haystack.includes(keyword));
}

function filterPlacesByRule(items, ruleConfig) {
  const categoryScope = normalizeKeywordList(ruleConfig?.category_scope);
  const scenarioTags = normalizeKeywordList(ruleConfig?.scenario_tags);
  return (Array.isArray(items) ? items : []).filter((item) => {
    const category = String(item?.category || "").toLowerCase();
    if (categoryScope.length && !categoryScope.includes(category)) return false;
    if (!scenarioTags.length) return true;
    const tags = parseTagList(item?.decision_scenario_tags);
    return scenarioTags.some((tag) => tags.includes(tag));
  });
}

function filterEventsByRule(items, ruleConfig) {
  const categoryScope = normalizeKeywordList(ruleConfig?.category_scope);
  const scenarioTags = normalizeKeywordList(ruleConfig?.scenario_tags);
  return (Array.isArray(items) ? items : []).filter((item) => {
    const eventTags = parseTagList(item?.decision_scenario_tags);
    const trendTags = parseTagList(item?.decision_trend_flags);
    const momentTags = parseTagList(item?.decision_moment_tags);
    const insightTags = parseTagList(item?.decision_insight_flags);
    const allTags = [...eventTags, ...trendTags, ...momentTags, ...insightTags];
    const matchesCategory = !categoryScope.length || categoryScope.some((tag) => allTags.includes(tag) || itemMatchesKeywords(item, [tag]));
    if (!matchesCategory) return false;
    if (!scenarioTags.length) return true;
    return scenarioTags.some((tag) => allTags.includes(tag) || itemMatchesKeywords(item, [tag]));
  });
}

function sortPlacesByMode(items, sortBy = "featured_then_recent") {
  const mode = String(sortBy || "featured_then_recent").trim().toLowerCase();
  if (mode === "recent") {
    return [...items].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
  }
  if (mode === "scenario_match") {
    return [...items].sort((a, b) => {
      const aScore = parseTagList(a?.decision_scenario_tags).length;
      const bScore = parseTagList(b?.decision_scenario_tags).length;
      if (bScore !== aScore) return bScore - aScore;
      return Number(b?.id || 0) - Number(a?.id || 0);
    });
  }
  return sortPlacesByFeaturedThenRecent(items);
}

function sortEventsByMode(items, sortBy = "recent") {
  const mode = String(sortBy || "recent").trim().toLowerCase();
  if (mode === "featured_then_recent") {
    return [...items].sort((a, b) => {
      const scoreDiff = Number(b?.decision_featured_score || 0) - Number(a?.decision_featured_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const aTime = new Date(a?.approved_at || a?.updated_at || a?.created_at || 0).getTime();
      const bTime = new Date(b?.approved_at || b?.updated_at || b?.created_at || 0).getTime();
      if (bTime !== aTime) return bTime - aTime;
      return Number(b?.id || 0) - Number(a?.id || 0);
    });
  }
  if (mode === "title") {
    return [...items].sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || "")));
  }
  return sortEventsByRecent(items);
}

async function loadApprovedPlacesForHomepage(lang = "th") {
  const normalizedLang = normalizeLang(lang);
  const [rows] = await pool.query(
    `SELECT
       p.id,
       c.slug AS category,
       ? AS lang,
       COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
       COALESCE(pt_req.title, pt_th.title) AS title,
       COALESCE(pt_req.description, pt_th.description) AS description,
       COALESCE(pt_req.meta_title, pt_th.meta_title) AS meta_title,
       COALESCE(pt_req.meta_description, pt_th.meta_description) AS meta_description,
       p.image,
       p.decision_featured_score,
       p.decision_scenario_tags
     FROM places p
     JOIN categories c ON c.id = p.category_id
     LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
     LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
     WHERE p.is_approved=1
       AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
     ORDER BY p.id DESC`,
    [normalizedLang, normalizedLang]
  );

  return rows.map((row) => ({
    ...row,
    entity_type: "place",
    decision_scenario_tags_list: parseTagList(row?.decision_scenario_tags),
  }));
}

async function loadApprovedEventsForHomepage(lang = "th") {
  const normalizedLang = normalizeLang(lang);
  try {
    const [rows] = await pool.query(
      `SELECT
         e.id,
         e.image,
         e.is_approved,
         e.approved_at,
         e.created_at,
         e.updated_at,
         ? AS lang,
         COALESCE(et_req.title, et_th.title, e.title) AS title,
         COALESCE(et_req.description, et_th.description, e.description) AS description,
         COALESCE(et_req.meta_title, et_th.meta_title, COALESCE(et_req.title, et_th.title, e.title)) AS meta_title,
         COALESCE(et_req.meta_description, et_th.meta_description, NULL) AS meta_description,
         e.decision_featured_score,
         e.decision_scenario_tags,
         e.decision_trend_flags,
         e.decision_moment_tags,
         e.decision_insight_flags,
         e.decision_cover_image,
         e.decision_thumbnail_image
       FROM events e
       LEFT JOIN event_translations et_req ON et_req.event_id=e.id AND et_req.lang=?
       LEFT JOIN event_translations et_th ON et_th.event_id=e.id AND et_th.lang='th'
       WHERE e.is_approved=1
       ORDER BY COALESCE(e.approved_at, e.updated_at) DESC, e.id DESC`,
      [normalizedLang, normalizedLang]
    );
    return rows.map((row) => ({ ...row, entity_type: "event" }));
  } catch (error) {
    const code = String(error?.code || "").toUpperCase();
    if (code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

function hydrateManualItems(block, placeById, eventById) {
  const manualItems = Array.isArray(block?.manual_items) ? block.manual_items : [];
  const resolved = [];
  const missing = [];

  for (const entry of manualItems) {
    const entityType = VALID_ENTITY_TYPES.has(String(entry?.entity_type || "").trim().toLowerCase())
      ? String(entry.entity_type).trim().toLowerCase()
      : "place";
    const entityId = Number(entry?.entity_id || 0) || null;
    if (!entityId) continue;

    const source = entityType === "event" ? eventById.get(entityId) : placeById.get(entityId);
    if (source) {
      resolved.push({ ...source, entity_type: entityType });
      continue;
    }

    missing.push({
      entity_type: entityType,
      entity_id: entityId,
      label: String(entry?.label || "").trim(),
      slug: String(entry?.slug || "").trim(),
    });
  }

  return {
    items: dedupeResolvedItems(resolved),
    missing,
  };
}

function resolveRuleItems(block, places, events) {
  const type = String(block?.type || "").trim().toLowerCase();
  const ruleConfig = block?.rule_config || {};
  if (type === "event-list") {
    return sortEventsByMode(filterEventsByRule(events, ruleConfig), ruleConfig.sort_by).map((item) => ({
      ...item,
      entity_type: "event",
    }));
  }
  return sortPlacesByMode(filterPlacesByRule(places, ruleConfig), ruleConfig.sort_by).map((item) => ({
    ...item,
    entity_type: "place",
  }));
}

function resolveFallbackItems(block, places, events) {
  const fallbackMode = String(block?.fallback_mode || "latest-approved").trim().toLowerCase();
  const type = String(block?.type || "").trim().toLowerCase();
  if (fallbackMode === "none") return [];
  if (type === "event-list") {
    return sortEventsByRecent(events).map((item) => ({ ...item, entity_type: "event" }));
  }
  if (fallbackMode === "featured") {
    return sortPlacesByFeaturedThenRecent(places).map((item) => ({ ...item, entity_type: "place" }));
  }
  return [...places]
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
    .map((item) => ({ ...item, entity_type: "place" }));
}

function resolveBlockItems(block, manualItems, places, events) {
  const type = String(block?.type || "").trim().toLowerCase();
  if (type === "hero") return [];

  const sourceMode = String(block?.source_mode || "manual-first-hybrid").trim().toLowerCase();
  const maxItems = Math.max(0, Number(block?.max_items || 0) || 0);
  const limit = maxItems > 0 ? maxItems : 24;
  let resolved = [];

  const pushUnique = (items) => {
    resolved = dedupeResolvedItems([...resolved, ...(Array.isArray(items) ? items : [])]).slice(0, limit);
  };

  if (sourceMode !== "rule-only") pushUnique(manualItems);
  if (sourceMode !== "manual-only" && resolved.length < limit) pushUnique(resolveRuleItems(block, places, events));
  if (resolved.length < limit) pushUnique(resolveFallbackItems(block, places, events));

  return resolved.slice(0, limit);
}

function buildResolvedBlocks(blocks, places, events, options = {}) {
  const includeHiddenBlocks = Boolean(options?.include_hidden_blocks);
  const placeById = new Map((Array.isArray(places) ? places : []).map((item) => [Number(item?.id || 0), item]));
  const eventById = new Map((Array.isArray(events) ? events : []).map((item) => [Number(item?.id || 0), item]));

  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => Boolean(block?.enabled))
    .map((block, index) => {
      const type = String(block?.type || "").trim().toLowerCase();
      const manual = hydrateManualItems(block, placeById, eventById);
      const resolvedItems = resolveBlockItems(block, manual.items, places, events);
      const minItems = Math.max(0, Number(block?.min_items || 0) || 0);
      const shouldRender = type === "hero" || resolvedItems.length > 0 || minItems === 0;
      return {
        ...block,
        type,
        position: Number(block?.position || index + 1) || index + 1,
        hydrated_manual_items: manual.items,
        manual_misses: manual.missing,
        resolved_items: resolvedItems,
        should_render: shouldRender,
      };
    })
    .filter((block) => includeHiddenBlocks || block.should_render)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

function sanitizeManualItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      entity_type: VALID_ENTITY_TYPES.has(String(item?.entity_type || "").trim().toLowerCase())
        ? String(item.entity_type).trim().toLowerCase()
        : "place",
      entity_id: Number(item?.entity_id || 0) || null,
      category: String(item?.category || "").trim().toLowerCase(),
      slug: String(item?.slug || "").trim(),
      label: String(item?.label || "").trim(),
      note: String(item?.note || "").trim(),
    }))
    .filter((item) => item.entity_id);
}

function sanitizeHeroBlock(block, fallbackBlock) {
  return {
    ...block,
    source_mode: "manual-first-hybrid",
    fallback_mode: "none",
    min_items: 0,
    max_items: 0,
    manual_items: [],
    rule_config: {
      ...(fallbackBlock?.rule_config || {}),
      sort_by: String(fallbackBlock?.rule_config?.sort_by || "featured_then_recent").trim(),
    },
  };
}

function sanitizeBlockByKey(block, fallbackBlock, position) {
  const key = fallbackBlock.key;
  const forcedType = FIXED_BLOCK_TYPES[key];
  const sourceMode = String(block?.source_mode || fallbackBlock.source_mode || "manual-first-hybrid").trim().toLowerCase();
  const fallbackMode = String(block?.fallback_mode || fallbackBlock.fallback_mode || "latest-approved").trim().toLowerCase();
  const minItems = Math.max(0, Number(block?.min_items ?? fallbackBlock.min_items ?? 0) || 0);
  const maxItems = Math.max(minItems, Number(block?.max_items ?? fallbackBlock.max_items ?? minItems) || minItems);

  const normalizedBlock = {
    key,
    type: forcedType,
    enabled: typeof block?.enabled === "boolean" ? block.enabled : Boolean(fallbackBlock.enabled),
    position,
    title: String(block?.title || fallbackBlock.title || key).trim(),
    subtitle: String(block?.subtitle || fallbackBlock.subtitle || "").trim(),
    source_mode: VALID_SOURCE_MODES.has(sourceMode) ? sourceMode : fallbackBlock.source_mode,
    fallback_mode: VALID_FALLBACK_MODES.has(fallbackMode) ? fallbackMode : fallbackBlock.fallback_mode,
    min_items: minItems,
    max_items: maxItems,
    manual_items: sanitizeManualItems(block?.manual_items),
    rule_config: {
      ...sanitizeRuleConfig(fallbackBlock?.rule_config),
      ...sanitizeRuleConfig(block?.rule_config),
    },
  };

  if (forcedType === "event-list") {
    normalizedBlock.manual_items = normalizedBlock.manual_items.map((item) => ({
      ...item,
      entity_type: "event",
    }));
  } else if (forcedType !== "event-list") {
    normalizedBlock.manual_items = normalizedBlock.manual_items.filter((item) => item.entity_type !== "event");
  }

  if (key === "hero") {
    return sanitizeHeroBlock(normalizedBlock, fallbackBlock);
  }

  return normalizedBlock;
}

function sanitizeRuleConfig(input) {
  const config = input || {};
  return {
    category_scope: normalizeStringList(config.category_scope).map((item) => item.toLowerCase()),
    scenario_tags: normalizeStringList(config.scenario_tags).map((item) => item.toLowerCase()),
    sort_by: String(config.sort_by || "featured_then_recent").trim() || "featured_then_recent",
  };
}

function sanitizeBlocks(blocks, lang = "th") {
  const defaultBlockMap = createDefaultBlockMap(lang);
  const submittedByKey = new Map();
  const submittedKeysInOrder = [];

  const orderedBlocks = (Array.isArray(blocks) ? [...blocks] : [])
    .map((block, index) => ({
      block,
      index,
      position: Number(block?.position || 0) || index + 1,
    }))
    .sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.index - b.index;
    });

  for (const entry of orderedBlocks) {
    const block = entry.block;
    const key = String(block?.key || "").trim().toLowerCase();
    if (!defaultBlockMap.has(key) || submittedByKey.has(key)) continue;
    submittedByKey.set(key, block);
    submittedKeysInOrder.push(key);
  }

  const finalKeys = [
    ...submittedKeysInOrder,
    ...FIXED_BLOCK_ORDER.filter((key) => !submittedByKey.has(key)),
  ];

  return finalKeys.map((key, index) =>
    sanitizeBlockByKey(submittedByKey.get(key) || defaultBlockMap.get(key), defaultBlockMap.get(key), index + 1)
  );
}

export async function ensureHomepageCurationTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS homepage_curation_layouts (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      layout_key VARCHAR(64) NOT NULL,
      lang VARCHAR(8) NOT NULL,
      draft_blocks_json LONGTEXT NOT NULL,
      published_blocks_json LONGTEXT NULL,
      updated_by BIGINT NULL,
      published_by BIGINT NULL,
      published_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_homepage_curation_layout (layout_key, lang)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

function mapLayoutRow(row, lang) {
  const draftBlocks = sanitizeBlocks(parseJson(row?.draft_blocks_json, createDefaultBlocks(lang)), lang);
  const publishedBlocks = row?.published_blocks_json
    ? sanitizeBlocks(parseJson(row.published_blocks_json, []), lang)
    : [];

  return {
    id: Number(row?.id || 0) || null,
    layout_key: normalizeLayoutKey(row?.layout_key),
    lang: normalizeLang(row?.lang || lang),
    draft_blocks: draftBlocks,
    published_blocks: publishedBlocks,
    updated_by: row?.updated_by ?? null,
    published_by: row?.published_by ?? null,
    published_at: row?.published_at || null,
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

export async function getHomepageCurationLayout(layoutKey = "home", lang = "th") {
  await ensureHomepageCurationTables();
  const normalizedKey = normalizeLayoutKey(layoutKey);
  const normalizedLang = normalizeLang(lang);
  const [rows] = await pool.query(
    "SELECT * FROM homepage_curation_layouts WHERE layout_key=? AND lang=? LIMIT 1",
    [normalizedKey, normalizedLang]
  );
  const row = rows[0];
  if (row) return mapLayoutRow(row, normalizedLang);

  const draftBlocks = createDefaultBlocks(normalizedLang);
  await pool.query(
    `INSERT INTO homepage_curation_layouts
      (layout_key, lang, draft_blocks_json, published_blocks_json)
      VALUES (?, ?, ?, NULL)`,
    [normalizedKey, normalizedLang, JSON.stringify(draftBlocks)]
  );

  return {
    id: null,
    layout_key: normalizedKey,
    lang: normalizedLang,
    draft_blocks: draftBlocks,
    published_blocks: [],
    updated_by: null,
    published_by: null,
    published_at: null,
    created_at: null,
    updated_at: null,
  };
}

export async function updateHomepageCurationDraft({
  layoutKey = "home",
  lang = "th",
  draftBlocks,
  actorId = null,
}) {
  await ensureHomepageCurationTables();
  const normalizedKey = normalizeLayoutKey(layoutKey);
  const normalizedLang = normalizeLang(lang);
  const sanitizedBlocks = sanitizeBlocks(draftBlocks, normalizedLang);
  const json = JSON.stringify(sanitizedBlocks);

  await pool.query(
    `INSERT INTO homepage_curation_layouts
      (layout_key, lang, draft_blocks_json, updated_by)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        draft_blocks_json=VALUES(draft_blocks_json),
        updated_by=VALUES(updated_by)`,
    [normalizedKey, normalizedLang, json, actorId]
  );

  return getHomepageCurationLayout(normalizedKey, normalizedLang);
}

export async function publishHomepageCurationLayout({
  layoutKey = "home",
  lang = "th",
  actorId = null,
}) {
  await ensureHomepageCurationTables();
  const layout = await getHomepageCurationLayout(layoutKey, lang);
  await pool.query(
    `UPDATE homepage_curation_layouts
      SET published_blocks_json=?, published_by=?, published_at=NOW()
      WHERE layout_key=? AND lang=?`,
    [JSON.stringify(layout.draft_blocks), actorId, layout.layout_key, layout.lang]
  );
  return getHomepageCurationLayout(layout.layout_key, layout.lang);
}

export async function getPublishedHomepageLayout(layoutKey = "home", lang = "th") {
  const layout = await getHomepageCurationLayout(layoutKey, lang);
  const publishedBlocks = Array.isArray(layout.published_blocks) && layout.published_blocks.length
    ? layout.published_blocks
    : layout.draft_blocks;
  const [allPlaces, allEvents] = await Promise.all([
    loadApprovedPlacesForHomepage(layout.lang),
    loadApprovedEventsForHomepage(layout.lang),
  ]);
  const resolvedBlocks = buildResolvedBlocks(publishedBlocks, allPlaces, allEvents);

  return {
    layout_key: layout.layout_key,
    lang: layout.lang,
    source: Array.isArray(layout.published_blocks) && layout.published_blocks.length ? "published" : "draft_fallback",
    blocks: publishedBlocks,
    resolved_blocks: resolvedBlocks,
    published_at: layout.published_at,
    updated_at: layout.updated_at,
  };
}

export async function previewHomepageCurationLayout({
  layoutKey = "home",
  lang = "th",
  draftBlocks = null,
}) {
  const normalizedKey = normalizeLayoutKey(layoutKey);
  const normalizedLang = normalizeLang(lang);
  const blocks = sanitizeBlocks(
    Array.isArray(draftBlocks) ? draftBlocks : (await getHomepageCurationLayout(normalizedKey, normalizedLang)).draft_blocks,
    normalizedLang
  );
  const [allPlaces, allEvents] = await Promise.all([
    loadApprovedPlacesForHomepage(normalizedLang),
    loadApprovedEventsForHomepage(normalizedLang),
  ]);

  return {
    layout_key: normalizedKey,
    lang: normalizedLang,
    blocks,
    resolved_blocks: buildResolvedBlocks(blocks, allPlaces, allEvents, { include_hidden_blocks: true }),
  };
}

export async function searchHomepageCurationCandidates({
  entityType = "place",
  lang = "th",
  q = "",
  limit = 20,
  taxonomyFilters = null,
}) {
  const normalizedType = VALID_ENTITY_TYPES.has(String(entityType || "").trim().toLowerCase())
    ? String(entityType).trim().toLowerCase()
    : "place";
  const normalizedLang = normalizeLang(lang);
  const normalizedQ = String(q || "").trim();
  const maxLimit = Math.max(1, Math.min(50, Number(limit || 20) || 20));
  const wildcard = `%${normalizedQ}%`;
  const hasTaxonomyFilters = isPlainObject(taxonomyFilters) && Object.keys(taxonomyFilters).length > 0;

  if (normalizedType === "event") {
    try {
      const [rows] = await pool.query(
        `SELECT
           e.id,
           'event' AS entity_type,
           NULL AS category,
           NULL AS slug,
           COALESCE(et_req.title, et_th.title, e.title) AS title,
           COALESCE(et_req.description, et_th.description, e.description) AS description,
           e.approved_at,
           e.updated_at
         FROM events e
         LEFT JOIN event_translations et_req ON et_req.event_id=e.id AND et_req.lang=?
         LEFT JOIN event_translations et_th ON et_th.event_id=e.id AND et_th.lang='th'
         WHERE e.is_approved=1
           AND (
             ?='' OR
             COALESCE(et_req.title, et_th.title, e.title) LIKE ? OR
             COALESCE(et_req.description, et_th.description, e.description) LIKE ?
           )
         ORDER BY COALESCE(e.approved_at, e.updated_at) DESC, e.id DESC
         LIMIT ?`,
        [normalizedLang, normalizedQ, wildcard, wildcard, maxLimit]
      );
      return rows;
    } catch (error) {
      const code = String(error?.code || "").toUpperCase();
      if (code === "ER_NO_SUCH_TABLE") return [];
      throw error;
    }
  }

  const [rows] = await pool.query(
    hasTaxonomyFilters
      ? `SELECT
       p.id,
       'place' AS entity_type,
       c.slug AS category,
       COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
       COALESCE(pt_req.title, pt_th.title) AS title,
       COALESCE(pt_req.description, pt_th.description) AS description,
       p.curated_taxonomy_json
     FROM places p
     JOIN categories c ON c.id = p.category_id
     LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
     LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
     WHERE p.is_approved=1
       AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
       AND (
         ?='' OR
         COALESCE(pt_req.title, pt_th.title) LIKE ? OR
         COALESCE(pt_req.description, pt_th.description) LIKE ? OR
         COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) LIKE ?
       )
     ORDER BY p.id DESC`
      : `SELECT
       p.id,
       'place' AS entity_type,
       c.slug AS category,
       COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) AS slug,
       COALESCE(pt_req.title, pt_th.title) AS title,
       COALESCE(pt_req.description, pt_th.description) AS description,
       p.curated_taxonomy_json
     FROM places p
     JOIN categories c ON c.id = p.category_id
     LEFT JOIN place_translations pt_req ON pt_req.place_id = p.id AND pt_req.lang=?
     LEFT JOIN place_translations pt_th ON pt_th.place_id = p.id AND pt_th.lang='th'
     WHERE p.is_approved=1
       AND (pt_req.id IS NOT NULL OR pt_th.id IS NOT NULL)
       AND (
         ?='' OR
         COALESCE(pt_req.title, pt_th.title) LIKE ? OR
         COALESCE(pt_req.description, pt_th.description) LIKE ? OR
         COALESCE(NULLIF(TRIM(p.slug), ''), CONCAT('place-', p.id)) LIKE ?
       )
     ORDER BY p.id DESC
     LIMIT ?`,
    hasTaxonomyFilters
      ? [normalizedLang, normalizedQ, wildcard, wildcard, wildcard]
      : [normalizedLang, normalizedQ, wildcard, wildcard, wildcard, maxLimit]
  );
  const normalizedRows = rows.map((row) => ({
    ...row,
    curated_taxonomy_json: parseCuratedTaxonomyValue(row?.curated_taxonomy_json),
  }));

  if (!hasTaxonomyFilters) {
    return normalizedRows;
  }

  return filterPlacesByCuratedTaxonomy(normalizedRows, taxonomyFilters).slice(0, maxLimit);
}
