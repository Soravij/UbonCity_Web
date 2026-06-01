import {
  getDecisionTags,
  sortByFeaturedThenRecent,
} from "@/lib/phase56-decision-helpers.mjs";

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function dedupeByEntity(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const type = String(item?.entity_type || "").trim().toLowerCase();
    const id = Number(item?.id || item?.entity_id || 0);
    if (!id || !type) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function toManualItems(block, placeById, eventById) {
  const hydrated = dedupeByEntity(Array.isArray(block?.hydrated_manual_items) ? block.hydrated_manual_items : []);
  if (hydrated.length) return hydrated;

  const manual = Array.isArray(block?.manual_items) ? block.manual_items : [];
  const out = [];
  for (const entry of manual) {
    const type = String(entry?.entity_type || "place").trim().toLowerCase();
    const id = Number(entry?.entity_id || 0);
    if (!id) continue;
    if (type === "event") {
      const event = eventById.get(id);
      if (event) out.push({ ...event, entity_type: "event" });
      continue;
    }
    const place = placeById.get(id);
    if (place) out.push({ ...place, entity_type: "place" });
  }
  return dedupeByEntity(out);
}

function filterPlacesByRule(allPlaces, ruleConfig) {
  const categoryScope = normalizeList(ruleConfig?.category_scope);
  const scenarioTags = normalizeList(ruleConfig?.scenario_tags);
  const scoped = categoryScope.length
    ? allPlaces.filter((place) => categoryScope.includes(String(place?.category || "").toLowerCase()))
    : allPlaces;

  if (!scenarioTags.length) return scoped;
  return scoped.filter((place) => {
    const tags = getDecisionTags(place, "decision_scenario_tags");
    return scenarioTags.some((tag) => tags.includes(tag));
  });
}

function sortPlacesByMode(items, sortBy = "featured_then_recent") {
  const mode = String(sortBy || "featured_then_recent").trim().toLowerCase();
  if (mode === "recent") {
    return [...items].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
  }
  if (mode === "scenario_match") {
    return [...items].sort((a, b) => {
      const aScore = getDecisionTags(a, "decision_scenario_tags").length;
      const bScore = getDecisionTags(b, "decision_scenario_tags").length;
      if (bScore !== aScore) return bScore - aScore;
      return Number(b?.id || 0) - Number(a?.id || 0);
    });
  }
  return sortByFeaturedThenRecent(items);
}

function sortEventsByRecent(items) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a?.approved_at || a?.updated_at || 0).getTime();
    const bTime = new Date(b?.approved_at || b?.updated_at || 0).getTime();
    if (bTime !== aTime) return bTime - aTime;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function filterEventsByRule(allEvents, ruleConfig) {
  const categoryScope = normalizeList(ruleConfig?.category_scope);
  const scenarioTags = normalizeList(ruleConfig?.scenario_tags);
  if (!categoryScope.length && !scenarioTags.length) return Array.isArray(allEvents) ? allEvents : [];

  return (Array.isArray(allEvents) ? allEvents : []).filter((item) => {
    const tagHaystack = [
      ...normalizeList(item?.decision_scenario_tags_list || item?.decision_scenario_tags),
      ...normalizeList(item?.decision_trend_flags),
      ...normalizeList(item?.decision_moment_tags),
      ...normalizeList(item?.decision_insight_flags),
    ];
    const haystack = [
      item?.title,
      item?.description,
      item?.meta_title,
      item?.meta_description,
    ]
      .map((part) => String(part || "").toLowerCase())
      .join("\n");
    const matchesCategory = !categoryScope.length || categoryScope.some((keyword) => tagHaystack.includes(keyword) || haystack.includes(keyword));
    if (!matchesCategory) return false;
    if (!scenarioTags.length) return true;
    return scenarioTags.some((keyword) => tagHaystack.includes(keyword) || haystack.includes(keyword));
  });
}

function resolveRuleItems(block, allPlaces, allEvents) {
  const type = String(block?.type || "").trim().toLowerCase();
  const ruleConfig = block?.rule_config || {};
  if (type === "event-list") {
    return sortEventsByRecent(filterEventsByRule(allEvents, ruleConfig)).map((item) => ({ ...item, entity_type: "event" }));
  }
  const filtered = filterPlacesByRule(allPlaces, ruleConfig);
  return sortPlacesByMode(filtered, ruleConfig.sort_by).map((item) => ({ ...item, entity_type: "place" }));
}

function resolveFallbackItems(block, allPlaces, allEvents) {
  const fallbackMode = String(block?.fallback_mode || "latest-approved").trim().toLowerCase();
  if (fallbackMode === "none") return [];
  const type = String(block?.type || "").trim().toLowerCase();

  if (type === "event-list") {
    return sortEventsByRecent(allEvents).map((item) => ({ ...item, entity_type: "event" }));
  }

  if (fallbackMode === "featured") {
    return sortByFeaturedThenRecent(allPlaces).map((item) => ({ ...item, entity_type: "place" }));
  }

  return [...allPlaces]
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
    .map((item) => ({ ...item, entity_type: "place" }));
}

function pickItemsByPolicy(block, allPlaces, allEvents, placeById, eventById) {
  const type = String(block?.type || "").trim().toLowerCase();
  if (type === "hero") return [];

  const sourceMode = String(block?.source_mode || "manual-first-hybrid").trim().toLowerCase();
  const maxItems = Math.max(0, Number(block?.max_items || 0) || 0);
  const limit = maxItems > 0 ? maxItems : 24;

  let resolved = [];
  const pushUnique = (items) => {
    resolved = dedupeByEntity([...resolved, ...(Array.isArray(items) ? items : [])]).slice(0, limit);
  };

  if (sourceMode !== "rule-only") {
    pushUnique(toManualItems(block, placeById, eventById));
  }

  if (sourceMode !== "manual-only" && resolved.length < limit) {
    pushUnique(resolveRuleItems(block, allPlaces, allEvents));
  }

  if (resolved.length < limit) {
    pushUnique(resolveFallbackItems(block, allPlaces, allEvents));
  }

  return resolved.slice(0, limit);
}

export function resolveHomepageLayout({
  layout,
  allPlaces,
  allEvents,
}) {
  const places = Array.isArray(allPlaces) ? allPlaces : [];
  const events = Array.isArray(allEvents) ? allEvents : [];
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];
  const placeById = new Map(places.map((item) => [Number(item?.id || 0), item]));
  const eventById = new Map(events.map((item) => [Number(item?.id || 0), item]));

  return blocks
    .filter((block) => Boolean(block?.enabled))
    .map((block, index) => {
      const type = String(block?.type || "").trim().toLowerCase();
      const items = pickItemsByPolicy(block, places, events, placeById, eventById);
      const minItems = Math.max(0, Number(block?.min_items || 0) || 0);
      const shouldRender = type === "hero" || items.length > 0 || minItems === 0;

      return {
        ...block,
        type,
        position: Number(block?.position || index + 1) || index + 1,
        resolved_items: items,
        should_render: shouldRender,
      };
    })
    .filter((block) => block.should_render)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}
