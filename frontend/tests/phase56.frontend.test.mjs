import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHomeDecisionSelections,
  filterByScenarioWithMetadata,
  pickScenarioItemsForCollections,
  pickTopPicksForCollections,
  pickTrendingPlacesForCollections,
  resolveCardCoverVisual,
  resolveDecisionSignalFromTags,
} from "../lib/phase56-decision-helpers.mjs";

test("collections scenario uses decision_scenario_tags before keyword fallback", () => {
  const allPlaces = [
    {
      id: 50,
      category: "attractions",
      title: "Keyword-heavy Day Trip",
      description: "one day one day one day",
    },
    {
      id: 1,
      category: "attractions",
      title: "Metadata Day Trip",
      description: "generic",
      decision_scenario_tags_list: ["day-trip"],
    },
  ];

  const meta = {
    categories: ["attractions"],
    decisionTags: ["day-trip", "one-day", "short-trip"],
    keywords: ["one day", "day trip"],
  };

  const result = pickScenarioItemsForCollections(allPlaces, meta, 10);
  assert.equal(result.items[0]?.id, 1);
  assert.equal(result.usedFallback, false);
  assert.ok(result.matchedCount >= 2);
});

test("collections scenario falls back to recency when no metadata or keyword match exists", () => {
  const allPlaces = [
    { id: 9, category: "attractions", title: "Newest fallback", description: "plain text" },
    { id: 3, category: "attractions", title: "Older fallback", description: "plain text" },
  ];

  const meta = {
    categories: ["attractions"],
    decisionTags: ["day-trip"],
    keywords: ["one day"],
  };

  const result = pickScenarioItemsForCollections(allPlaces, meta, 10);
  assert.equal(result.usedFallback, true);
  assert.equal(result.matchedCount, 0);
  assert.deepEqual(result.items.map((item) => item.id), [9, 3]);
});

test("collections top picks use featured score before recency fallback", () => {
  const allPlaces = [
    { id: 100, category: "cafes", title: "Newest non-featured", decision_featured_score: 0 },
    { id: 3, category: "cafes", title: "Featured winner", decision_featured_score: 99 },
    { id: 2, category: "cafes", title: "Featured second", decision_featured_score: 50 },
  ];

  const picked = pickTopPicksForCollections(allPlaces, 5);
  assert.deepEqual(
    picked.slice(0, 3).map((item) => item.id),
    [3, 2, 100]
  );
});

test("collections trending uses decision_trend_flags", () => {
  const allPlaces = [
    { id: 200, category: "restaurants", title: "Newest no trend" },
    { id: 20, category: "restaurants", title: "Trend metadata", decision_trend_flags_list: ["viral"] },
  ];

  const picked = pickTrendingPlacesForCollections(allPlaces, 5);
  assert.equal(picked[0]?.id, 20);
});

test("category scenario filtering uses metadata first for quick-action scenarios", () => {
  const scenarioTagsMap = {
    "scenic-cafe": ["scenic-cafe", "couple", "date", "romantic"],
    "signature-food": ["signature-food", "must-try", "local-food"],
  };
  const scenarioRulesMap = {
    "scenic-cafe": ["view", "sunset", "rooftop", "cafe"],
    "signature-food": ["signature", "must try", "local", "food"],
  };

  const scenicItems = [
    { id: 1, title: "Metadata scenic", description: "plain text", decision_scenario_tags_list: ["scenic-cafe"] },
    { id: 2, title: "Keyword scenic", description: "cafe with sunset view" },
  ];
  const foodItems = [
    { id: 11, title: "Metadata signature", description: "plain text", decision_scenario_tags_list: ["signature-food"] },
    { id: 12, title: "Keyword signature", description: "must try local food" },
  ];

  const scenicResult = filterByScenarioWithMetadata(scenicItems, "scenic-cafe", scenarioTagsMap, scenarioRulesMap);
  const foodResult = filterByScenarioWithMetadata(foodItems, "signature-food", scenarioTagsMap, scenarioRulesMap);

  assert.deepEqual(scenicResult.map((item) => item.id), [1]);
  assert.deepEqual(foodResult.map((item) => item.id), [11]);
});

test("category scenario filtering falls back to keyword and then capped default slice", () => {
  const scenarioTagsMap = {
    "scenic-cafe": ["scenic-cafe"],
  };
  const scenarioRulesMap = {
    "scenic-cafe": ["sunset", "view"],
  };

  const keywordOnly = [
    { id: 1, title: "Sunset deck", description: "great sunset view" },
    { id: 2, title: "Plain cafe", description: "plain text" },
  ];
  const noMatch = [
    { id: 11, title: "A", description: "plain" },
    { id: 12, title: "B", description: "plain" },
    { id: 13, title: "C", description: "plain" },
    { id: 14, title: "D", description: "plain" },
    { id: 15, title: "E", description: "plain" },
    { id: 16, title: "F", description: "plain" },
    { id: 17, title: "G", description: "plain" },
  ];

  assert.deepEqual(
    filterByScenarioWithMetadata(keywordOnly, "scenic-cafe", scenarioTagsMap, scenarioRulesMap).map((item) => item.id),
    [1]
  );
  assert.deepEqual(
    filterByScenarioWithMetadata(noMatch, "scenic-cafe", scenarioTagsMap, scenarioRulesMap).map((item) => item.id),
    [11, 12, 13, 14, 15, 16]
  );
});

test("home selections use featured score, trend flags, and moment tags before keyword fallback", () => {
  const allPlaces = [
    { id: 100, category: "attractions", title: "Newest regular place", decision_featured_score: 0 },
    { id: 2, category: "attractions", title: "Featured top place", decision_featured_score: 90 },
    { id: 110, category: "cafes", title: "Newest cafe regular", decision_featured_score: 0 },
    { id: 5, category: "cafes", title: "Featured cafe", decision_featured_score: 80 },
    { id: 120, category: "restaurants", title: "Night keyword fallback", description: "great night city view" },
    { id: 4, category: "restaurants", title: "Moment metadata first", decision_moment_tags_list: ["evening"] },
    { id: 130, category: "activities", title: "No trend newest" },
    { id: 3, category: "activities", title: "Trend metadata", decision_trend_flags_list: ["viral"] },
  ];

  const placesByCategory = {
    attractions: allPlaces.filter((item) => item.category === "attractions"),
    cafes: allPlaces.filter((item) => item.category === "cafes"),
    restaurants: allPlaces.filter((item) => item.category === "restaurants"),
    activities: allPlaces.filter((item) => item.category === "activities"),
    hotels: [],
  };

  const result = buildHomeDecisionSelections({ allPlaces, placesByCategory });
  assert.equal(result.topTenPlaces[0]?.id, 2);
  assert.equal(result.topCafePlaces[0]?.id, 5);
  assert.equal(result.trendingPlaces[0]?.id, 3);
  assert.equal(result.eveningSpots[0]?.id, 4);
});

test("detail decision signal prioritizes decision tags over fallback heuristic", () => {
  const fallback = {
    audience: "all",
    time: "anytime",
    budget: "mid",
    transport: "planned",
  };
  const place = {
    decision_scenario_tags_list: ["family", "budget-500"],
    decision_moment_tags_list: ["evening"],
    decision_insight_flags_list: ["nearby"],
  };

  const signal = resolveDecisionSignalFromTags(fallback, place);
  assert.deepEqual(signal, {
    audience: "family",
    time: "evening",
    budget: "budget",
    transport: "nearby",
  });
});

test("detail decision signal preserves heuristic fallback when metadata is absent", () => {
  const fallback = {
    audience: "couple",
    time: "morning",
    budget: "premium",
    transport: "planned",
  };

  assert.deepEqual(resolveDecisionSignalFromTags(fallback, {}), fallback);
});

test("card media uses effective thumbnail first, then effective cover", () => {
  const thumbnailWinner = resolveCardCoverVisual({
    title: "Thumbnail priority",
    effective_thumbnail_image: "https://cdn.example.com/thumb.jpg",
    effective_cover_image: "https://cdn.example.com/cover.jpg#r=90",
    image: "https://cdn.example.com/legacy.jpg",
    description: "desc ![inline](https://cdn.example.com/inline.jpg)",
  });
  assert.equal(thumbnailWinner.coverImage, "https://cdn.example.com/thumb.jpg");
  assert.equal(thumbnailWinner.coverRotation, 0);

  const coverWinner = resolveCardCoverVisual({
    title: "Cover fallback",
    effective_cover_image: "https://cdn.example.com/cover.jpg#r=90",
    image: "https://cdn.example.com/legacy.jpg",
  });
  assert.equal(coverWinner.coverImage, "https://cdn.example.com/cover.jpg");
  assert.equal(coverWinner.coverRotation, 90);
});

test("card media falls back to content image, then default image", () => {
  const contentFallback = resolveCardCoverVisual({
    title: "Content fallback",
    description: "text ![content image](https://cdn.example.com/content.jpg)",
  });
  assert.equal(contentFallback.coverImage, "https://cdn.example.com/content.jpg");

  const defaultFallback = resolveCardCoverVisual({
    title: "Default fallback",
    description: "plain text only",
  });
  assert.equal(defaultFallback.coverImage, "/default-lotus.svg");
});
