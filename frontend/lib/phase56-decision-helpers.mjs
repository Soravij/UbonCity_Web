function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function parseDecisionTagList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
  return String(value || "")
    .split(/[\,\n]/g)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

export function getDecisionTags(item, field) {
  const listField = `${field}_list`;
  const list = parseDecisionTagList(item?.[listField]);
  if (list.length) return list;
  return parseDecisionTagList(item?.[field]);
}

export function getFeaturedScore(item) {
  const score = Number(item?.decision_featured_score);
  return Number.isFinite(score) ? score : 0;
}

export function sortByFeaturedThenRecent(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const scoreDiff = getFeaturedScore(b) - getFeaturedScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function sortRecent(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
}

function hasAnyKeyword(text, keywords) {
  const source = String(text || "").toLowerCase();
  return (Array.isArray(keywords) ? keywords : []).some((keyword) => source.includes(keyword));
}

export function pickUniquePlaces(groups, limit = 3) {
  const seen = new Set();
  const out = [];

  for (const group of Array.isArray(groups) ? groups : []) {
    for (const item of Array.isArray(group) ? group : []) {
      const id = Number(item?.id || 0);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

export function buildHomeDecisionSelections({ allPlaces, placesByCategory }) {
  const all = Array.isArray(allPlaces) ? allPlaces : [];
  const byCategory = placesByCategory || {};
  const sortedPlaces = sortRecent(all);
  const featuredSortedPlaces = sortByFeaturedThenRecent(all);
  const hasFeaturedPlaces = featuredSortedPlaces.some((place) => getFeaturedScore(place) > 0);

  const topTenPlaces = (hasFeaturedPlaces ? featuredSortedPlaces : sortedPlaces).slice(0, 10);
  const topCafePlaces = sortByFeaturedThenRecent(byCategory.cafes || []).slice(0, 5);
  const eveningSpots = pickUniquePlaces(
    [
      sortByFeaturedThenRecent(
        all.filter((place) =>
          getDecisionTags(place, "decision_moment_tags").some((tag) =>
            ["evening", "night", "sunset", "late-afternoon"].includes(tag)
          )
        )
      ),
      sortedPlaces.filter((place) => hasAnyKeyword(place?.title, ["เย็น", "ค่ำ", "กลางคืน", "sunset", "night"])),
      sortedPlaces.filter((place) => hasAnyKeyword(place?.description, ["เย็น", "sunset", "night", "romantic"])),
      byCategory.restaurants || [],
      byCategory.cafes || [],
      byCategory.attractions || [],
    ],
    3
  );

  const trendingPlaces = pickUniquePlaces(
    [
      sortByFeaturedThenRecent(
        all.filter((place) => getDecisionTags(place, "decision_trend_flags").length > 0)
      ),
      sortedPlaces,
    ],
    12
  );

  return { topTenPlaces, topCafePlaces, eveningSpots, trendingPlaces };
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = Number(item?.id || 0);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function scoreByKeywords(item, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return 0;
  const source = normalizeText(`${item?.title || ""} ${item?.description || ""}`);
  if (!source) return 0;
  let score = 0;
  for (const keyword of keywords) {
    if (source.includes(normalizeText(keyword))) score += 1;
  }
  return score;
}

export function scoreByDecisionTags(item, tags) {
  const target = Array.isArray(tags) ? tags.map((tag) => normalizeText(tag)) : [];
  if (!target.length) return 0;
  const source = getDecisionTags(item, "decision_scenario_tags");
  if (!source.length) return 0;
  return target.reduce((sum, token) => (source.includes(token) ? sum + 1 : sum), 0);
}

export function pickScenarioItemsForCollections(allPlaces, meta, limit = 18) {
  const scoped = (Array.isArray(allPlaces) ? allPlaces : []).filter((item) =>
    (Array.isArray(meta?.categories) ? meta.categories : []).includes(item.category)
  );
  const scored = scoped
    .map((item) => ({
      item,
      metaScore: scoreByDecisionTags(item, meta?.decisionTags),
      score: scoreByKeywords(item, meta?.keywords),
      id: Number(item?.id || 0),
    }))
    .sort((a, b) => {
      if (b.metaScore !== a.metaScore) return b.metaScore - a.metaScore;
      if (b.score !== a.score) return b.score - a.score;
      return b.id - a.id;
    })
    .map((row) => row.item);

  const positive = scored.filter(
    (item) =>
      scoreByDecisionTags(item, meta?.decisionTags) > 0 ||
      scoreByKeywords(item, meta?.keywords) > 0
  );
  const fallback = sortRecent(scoped);

  return {
    items: dedupeItems([...positive, ...fallback]).slice(0, limit),
    matchedCount: positive.length,
    usedFallback: positive.length === 0 && fallback.length > 0,
  };
}

export function pickTopPicksForCollections(allPlaces, limit = 18) {
  const all = Array.isArray(allPlaces) ? allPlaces : [];
  const featuredItems = all
    .map((item) => ({ item, score: Number(item?.decision_featured_score || 0), id: Number(item?.id || 0) }))
    .filter((row) => Number.isFinite(row.score) && row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.id - a.id;
    })
    .map((row) => row.item);

  if (featuredItems.length) {
    return dedupeItems([...featuredItems, ...sortRecent(all)]).slice(0, limit);
  }

  const grouped = new Map();
  for (const item of sortRecent(all)) {
    const category = String(item?.category || "");
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(item);
  }

  const curated = [];
  for (const category of ["attractions", "cafes", "restaurants", "activities", "hotels"]) {
    const items = grouped.get(category) || [];
    curated.push(...items.slice(0, 3));
  }

  return dedupeItems([...curated, ...sortRecent(all)]).slice(0, limit);
}

export function pickTrendingPlacesForCollections(allPlaces, limit = 18) {
  const all = Array.isArray(allPlaces) ? allPlaces : [];
  const trendItems = all
    .map((item) => ({
      item,
      tags: getDecisionTags(item, "decision_trend_flags"),
      id: Number(item?.id || 0),
    }))
    .map((row) => ({ ...row, score: row.tags.length }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.id - a.id;
    })
    .map((row) => row.item);

  return dedupeItems([...trendItems, ...sortRecent(all)]).slice(0, limit);
}

function matchesTokens(text, tokens) {
  const source = normalizeText(text);
  if (!source || !tokens.length) return false;
  return tokens.some((token) => source.includes(token));
}

export function filterByScenarioWithMetadata(items, scenario, scenarioTagsMap, scenarioRulesMap) {
  const sourceItems = Array.isArray(items) ? items : [];
  const scenarioKey = String(scenario || "").trim();
  const decisionTags = scenarioTagsMap?.[scenarioKey];
  if (decisionTags?.length) {
    const matchedByMetadata = sourceItems.filter((item) => {
      const tags = getDecisionTags(item, "decision_scenario_tags");
      return decisionTags.some((tag) => tags.includes(normalizeText(tag)));
    });
    if (matchedByMetadata.length) return matchedByMetadata;
  }

  const rules = scenarioRulesMap?.[scenarioKey];
  if (!rules?.length) return sourceItems;

  const matched = sourceItems.filter((item) =>
    matchesTokens(`${item?.title || ""} ${item?.description || ""}`, rules)
  );
  return matched.length ? matched : sourceItems.slice(0, Math.min(sourceItems.length, 6));
}

function hasAnyTag(tags, candidates) {
  return (Array.isArray(candidates) ? candidates : []).some((candidate) =>
    tags.includes(normalizeText(candidate))
  );
}

export function resolveDecisionSignalFromTags(fallback, place) {
  const fallbackSignal = fallback || {};
  const scenarioTags = getDecisionTags(place, "decision_scenario_tags");
  const momentTags = getDecisionTags(place, "decision_moment_tags");
  const insightTags = getDecisionTags(place, "decision_insight_flags");

  const audience = hasAnyTag(scenarioTags, ["family", "all-ages", "kids"])
    ? "family"
    : hasAnyTag(scenarioTags, ["couple", "date", "romantic"])
      ? "couple"
      : fallbackSignal.audience;

  const time = hasAnyTag(momentTags, ["evening", "night", "sunset"])
    ? "evening"
    : hasAnyTag(momentTags, ["morning", "sunrise", "daytime"])
      ? "morning"
      : fallbackSignal.time;

  const budget = hasAnyTag(scenarioTags, ["budget-500", "budget", "value"])
    ? "budget"
    : hasAnyTag(scenarioTags, ["premium", "luxury"])
      ? "premium"
      : fallbackSignal.budget;

  const transport = hasAnyTag(insightTags, ["nearby", "walkable", "in-town"])
    ? "nearby"
    : hasAnyTag(insightTags, ["planned", "route-required"])
      ? "planned"
      : fallbackSignal.transport;

  return { audience, time, budget, transport };
}

function normalizeRotation(rotation) {
  const n = Number(rotation);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

function parseCoverImageValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return { url: "", rotation: 0 };

  const match = value.match(/^(.*?)(?:#r=(-?\d+))?$/);
  return {
    url: String(match?.[1] || "").trim(),
    rotation: normalizeRotation(match?.[2] ?? 0),
  };
}

function parseAltRotation(rawAlt) {
  const input = String(rawAlt || "").trim();
  const match = input.match(/^(.*?)(?:\|r=(-?\d+))?$/);
  return {
    alt: String(match?.[1] || "").trim(),
    rotation: normalizeRotation(match?.[2] ?? 0),
  };
}

function cleanMediaUrl(value) {
  const url = String(value || "").trim();
  return url || "";
}

function parseDescriptionBlocks(text) {
  const source = String(text || "");
  const regex = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  const blocks = [];
  let lastIndex = 0;

  for (const match of source.matchAll(regex)) {
    const full = match[0];
    const url = (match[2] || "").trim();
    const index = match.index ?? 0;
    const parsedAlt = parseAltRotation(match[1]);

    if (index > lastIndex) {
      const textBlock = source.slice(lastIndex, index).trim();
      if (textBlock) blocks.push({ type: "text", value: textBlock });
    }

    if (url) {
      blocks.push({
        type: "image",
        url,
        alt: parsedAlt.alt || "Content image",
        rotation: parsedAlt.rotation,
      });
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < source.length) {
    const textBlock = source.slice(lastIndex).trim();
    if (textBlock) blocks.push({ type: "text", value: textBlock });
  }

  if (blocks.length === 0) {
    blocks.push({ type: "text", value: source });
  }

  return blocks;
}

export function resolveCardCoverVisual(place) {
  const blocks = parseDescriptionBlocks(place?.description || "");
  const firstContentImage = blocks.find((block) => block.type === "image");
  const effectiveThumbnail = cleanMediaUrl(place?.effective_thumbnail_image);
  const effectiveCover = cleanMediaUrl(place?.effective_cover_image);
  const parsedCover = parseCoverImageValue(effectiveCover || place?.image);
  const matchedCoverImage = blocks.find(
    (block) => block.type === "image" && parsedCover.url && block.url === parsedCover.url
  );

  const coverImage = effectiveThumbnail || parsedCover.url || firstContentImage?.url || "/default-lotus.svg";
  const coverAlt = place?.title || firstContentImage?.alt || "Lotus image";
  const coverRotation =
    coverImage === parsedCover.url
      ? parsedCover.rotation || matchedCoverImage?.rotation || 0
      : coverImage === firstContentImage?.url
        ? firstContentImage?.rotation || 0
        : 0;

  return { coverImage, coverAlt, coverRotation };
}
