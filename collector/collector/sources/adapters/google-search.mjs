import { normalizeRawItem } from "../normalize.mjs";

const FETCH_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.COLLECTOR_SOURCE_FETCH_TIMEOUT_MS || process.env.COLLECTOR_FETCH_TIMEOUT_MS || 15_000) || 15_000
);

function toQueries(payload) {
  if (Array.isArray(payload?.queries)) {
    return payload.queries.map((q) => String(q || "").trim()).filter(Boolean);
  }
  if (typeof payload?.query === "string" && payload.query.trim()) {
    return [payload.query.trim()];
  }
  return [];
}

function toPositiveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function extractImageUrl(item = {}) {
  const cseImage = Array.isArray(item?.pagemap?.cse_image) ? item.pagemap.cse_image : [];
  const cseThumbnail = Array.isArray(item?.pagemap?.cse_thumbnail) ? item.pagemap.cse_thumbnail : [];
  const image = String(cseImage[0]?.src || cseThumbnail[0]?.src || "").trim();
  return image;
}

function mapSearchResultToRawItem(item, query, category) {
  const title = String(item?.title || "").trim();
  const snippet = String(item?.snippet || "").trim();
  const link = String(item?.link || "").trim();
  const displayLink = String(item?.displayLink || "").trim();
  const image = extractImageUrl(item);
  const tags = [query, category, displayLink].map((value) => String(value || "").trim()).filter(Boolean).slice(0, 5);

  return normalizeRawItem(
    {
      type: "place",
      category,
      lang: "th",
      title,
      description: snippet,
      image,
      source_name: displayLink || "google-search",
      source_url: link,
      website_url: link,
      editorial_summary: snippet,
      tags,
      payload_json: item,
      media: image ? [{ media_url: image, metadata_json: item?.pagemap || null }] : [],
      source_ref: String(item?.cacheId || item?.formattedUrl || link || title).trim(),
    },
    "google_search"
  );
}

async function fetchWithTimeout(url, options = {}, contextLabel = "external request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${contextLabel} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    const message = String(error?.message || "fetch failed").trim() || "fetch failed";
    throw new Error(`${contextLabel} failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCustomSearchJson(query, options) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", options.apiKey);
  url.searchParams.set("cx", options.engineId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(options.num));
  url.searchParams.set("safe", "off");
  if (options.language) url.searchParams.set("lr", `lang_${options.language}`);
  if (options.region) url.searchParams.set("gl", options.region.toLowerCase());

  const response = await fetchWithTimeout(url, {}, "Google Custom Search request");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(payload?.error?.message || response.statusText || "Custom Search JSON API error").trim();
    throw new Error(`Custom Search JSON API error: ${message}`);
  }
  return Array.isArray(payload?.items) ? payload.items : [];
}

function resolveCustomSearchApiKey(payload = {}) {
  return String(
    payload?.custom_search_api_key ||
      payload?.api_key ||
      process.env.GOOGLE_CUSTOM_SEARCH_JSON_API_KEY ||
      process.env.GOOGLE_SEARCH_API_KEY ||
      ""
  ).trim();
}

function resolveCustomSearchEngineId(payload = {}) {
  return String(
    payload?.custom_search_engine_id ||
      payload?.engine_id ||
      process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID ||
      process.env.GOOGLE_SEARCH_ENGINE_ID ||
      ""
  ).trim();
}

export async function collectFromGoogleSearchPayload(payload = {}) {
  const apiKey = resolveCustomSearchApiKey(payload);
  const engineId = resolveCustomSearchEngineId(payload);
  if (!apiKey) {
    throw new Error("GOOGLE_CUSTOM_SEARCH_JSON_API_KEY is missing");
  }
  if (!engineId) {
    throw new Error("GOOGLE_CUSTOM_SEARCH_ENGINE_ID is missing");
  }

  const queries = toQueries(payload);
  if (!queries.length) {
    throw new Error("google_search payload requires query or queries[] for Custom Search JSON API");
  }

  const num = toPositiveInt(payload?.max_results_per_query, 10, 1, 10);
  const category = String(payload?.category || "attractions").trim().toLowerCase() || "attractions";
  const options = {
    apiKey,
    engineId,
    num,
    language: String(payload?.language || "th").trim().toLowerCase() || "th",
    region: String(payload?.region || "TH").trim().toUpperCase() || "TH",
  };

  const dedupe = new Set();
  const out = [];

  for (const query of queries) {
    const rows = await fetchCustomSearchJson(query, options);
    for (const item of rows) {
      const raw = mapSearchResultToRawItem(item, query, category);
      const key = raw.source_url || raw.source_ref || raw.title_raw;
      if (!key || dedupe.has(key)) continue;
      dedupe.add(key);
      out.push(raw);
    }
  }

  return out;
}
