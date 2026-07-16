import test from "node:test";
import assert from "node:assert/strict";

import {
  addCandidateToBlocks,
  applyPoolEntityTypeChange,
  buildPoolCandidateParams,
  canUseCandidateInBlock,
  clearPoolTaxonomySelection,
  removePoolTaxonomyKey,
} from "../src/lib/homepageCurationPool.js";

function createPoolState(overrides = {}) {
  return { q: "", entity_type: "place", taxonomy_true: [], loading: false, error: "", items: [], ...overrides };
}

test("Content Pool taxonomy filter request contract", async (t) => {
  await t.test("multiple selected keys travel as one comma-separated taxonomy_true", () => {
    const params = buildPoolCandidateParams({
      entityType: "place",
      lang: "th",
      q: "cafe",
      limit: 20,
      taxonomyTrue: ["parking", "air_conditioning"],
    });
    assert.equal(params.taxonomy_true, "parking,air_conditioning");
    assert.equal(params.entity_type, "place");
    assert.equal(params.lang, "th");
    assert.equal(params.q, "cafe");
    assert.equal(params.limit, 20);
  });

  await t.test("cleared selection sends no taxonomy_true at all", () => {
    const cleared = removePoolTaxonomyKey(createPoolState({ taxonomy_true: ["parking"] }), "parking");
    assert.deepEqual(cleared.taxonomy_true, []);
    const params = buildPoolCandidateParams({ entityType: "place", taxonomyTrue: cleared.taxonomy_true });
    assert.equal(Object.hasOwn(params, "taxonomy_true"), false);
  });

  await t.test("removing one of several keys keeps the rest", () => {
    const next = removePoolTaxonomyKey(createPoolState({ taxonomy_true: ["parking", "wifi_available"] }), "parking");
    assert.deepEqual(next.taxonomy_true, ["wifi_available"]);
    assert.equal(buildPoolCandidateParams({ entityType: "place", taxonomyTrue: next.taxonomy_true }).taxonomy_true, "wifi_available");
  });

  await t.test("event mode never sends taxonomy_true, even with stale selection", () => {
    const params = buildPoolCandidateParams({ entityType: "event", taxonomyTrue: ["parking"] });
    assert.equal(Object.hasOwn(params, "taxonomy_true"), false);
  });

  await t.test("switching to event clears the selection, switching back does not resurrect it", () => {
    const asEvent = applyPoolEntityTypeChange(createPoolState({ taxonomy_true: ["parking"] }), "event");
    assert.deepEqual(asEvent.taxonomy_true, []);
    assert.deepEqual(asEvent.items, []);

    const backToPlace = applyPoolEntityTypeChange(asEvent, "place");
    assert.deepEqual(backToPlace.taxonomy_true, []);
    assert.equal(Object.hasOwn(buildPoolCandidateParams({
      entityType: backToPlace.entity_type,
      taxonomyTrue: backToPlace.taxonomy_true,
    }), "taxonomy_true"), false);
  });

  await t.test("catalog load failure leaves no hidden filter on the next search", () => {
    const afterFailure = clearPoolTaxonomySelection(createPoolState({ taxonomy_true: ["parking", "wifi_available"] }));
    assert.deepEqual(afterFailure.taxonomy_true, []);
    assert.deepEqual(afterFailure.items, []);
    const params = buildPoolCandidateParams({
      entityType: afterFailure.entity_type,
      taxonomyTrue: afterFailure.taxonomy_true,
    });
    assert.equal(Object.hasOwn(params, "taxonomy_true"), false);
  });
});

test("Content Pool block flow stays intact", async (t) => {
  const placeBlock = { key: "top_picks", enabled: true, manual_items: [] };
  const eventBlock = { key: "featured_events", enabled: true, manual_items: [] };
  const candidate = { id: 7, entity_type: "place", title: "Cafe A", category: "cafes", slug: "cafe-a" };

  await t.test("place candidate is usable in a place block only", () => {
    assert.equal(canUseCandidateInBlock(placeBlock, "place"), true);
    assert.equal(canUseCandidateInBlock(eventBlock, "place"), false);
    assert.equal(canUseCandidateInBlock({ key: "hero", enabled: true }, "place"), false);
    assert.equal(canUseCandidateInBlock({ ...placeBlock, enabled: false }, "place"), false);
  });

  await t.test("using a candidate in a block appends it to that block only", () => {
    const next = addCandidateToBlocks([placeBlock, eventBlock], "top_picks", candidate);
    assert.deepEqual(next[0].manual_items, [
      { entity_type: "place", entity_id: "7", category: "cafes", slug: "cafe-a", label: "Cafe A", note: "" },
    ]);
    assert.deepEqual(next[1].manual_items, []);
  });

  await t.test("the same candidate is not added twice", () => {
    const once = addCandidateToBlocks([placeBlock], "top_picks", candidate);
    const twice = addCandidateToBlocks(once, "top_picks", candidate);
    assert.equal(twice[0].manual_items.length, 1);
  });

  await t.test("a place candidate cannot be pushed into the event block", () => {
    const next = addCandidateToBlocks([eventBlock], "featured_events", candidate);
    assert.deepEqual(next[0].manual_items, []);
  });

  await t.test("no target block selected leaves blocks untouched", () => {
    assert.deepEqual(addCandidateToBlocks([placeBlock], "", candidate), [placeBlock]);
  });
});
