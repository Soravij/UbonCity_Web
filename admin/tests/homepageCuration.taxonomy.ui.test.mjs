import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addCandidateToBlocks,
  addCandidatesToBlocks,
  applyPoolEntityTypeChange,
  buildPoolCandidateParams,
  candidateSelectionKey,
  clearPoolTaxonomySelection,
  createTaxonomyLookupSlots,
  selectCurrentCandidateRows,
  selectedTaxonomyLookupKeys,
  toggleCandidateSelection,
  updateTaxonomyLookupSlot,
} from "../src/lib/homepageCurationPool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "src", "pages", "HomepageCuration.jsx"), "utf8");

test("taxonomy lookup keeps exactly three unique temporary slots", () => {
  assert.deepEqual(createTaxonomyLookupSlots(), ["", "", ""]);
  assert.deepEqual(createTaxonomyLookupSlots(["parking", "parking", "wifi_available"]), ["parking", "", "wifi_available"]);
  assert.deepEqual(updateTaxonomyLookupSlot(["parking", "", ""], 1, "parking"), ["parking", "", ""]);
  assert.deepEqual(updateTaxonomyLookupSlot(["parking", "", ""], 1, "wifi_available"), ["parking", "wifi_available", ""]);
  assert.deepEqual(selectedTaxonomyLookupKeys(["parking", "", "wifi_available"]), ["parking", "wifi_available"]);
});

test("candidate request sends selected place keys only", () => {
  assert.deepEqual(
    buildPoolCandidateParams({ entityType: "place", lang: "th", q: "coffee", taxonomyTrue: ["parking", "", "wifi_available"] }),
    { entity_type: "place", lang: "th", q: "coffee", limit: 20, taxonomy_true: "parking,wifi_available" }
  );
  assert.deepEqual(
    applyPoolEntityTypeChange({ entity_type: "place", taxonomy_true: ["parking", "", ""], items: [{ id: 1 }], error: "old" }, "event"),
    { entity_type: "event", taxonomy_true: ["", "", ""], items: [], error: "" }
  );
  assert.deepEqual(
    clearPoolTaxonomySelection({ entity_type: "place", taxonomy_true: ["parking", "", ""], items: [{ id: 1 }], error: "old" }),
    { entity_type: "place", taxonomy_true: ["", "", ""], items: [], error: "" }
  );
  assert.deepEqual(
    buildPoolCandidateParams({ entityType: "event", lang: "th", q: "fair", taxonomyTrue: ["parking", "", ""] }),
    { entity_type: "event", lang: "th", q: "fair", limit: 20 }
  );
});

test("current page selection supports one row and select-all", () => {
  const items = [
    { id: 1, entity_type: "place" },
    { id: 2, entity_type: "place" },
  ];
  const once = toggleCandidateSelection([], items[0]);
  assert.deepEqual(once, [candidateSelectionKey(items[0])]);
  const all = selectCurrentCandidateRows(items, once);
  assert.deepEqual(new Set(all), new Set(["place:1", "place:2"]));
  assert.deepEqual(selectCurrentCandidateRows(items, all), []);
});

test("bulk add appends selected candidates and keeps duplicate guard/manual items", () => {
  const blocks = [{
    key: "top_picks",
    enabled: true,
    manual_items: [{ entity_type: "place", entity_id: "1", label: "Existing" }],
  }];
  const next = addCandidatesToBlocks(blocks, "top_picks", [
    { id: 1, entity_type: "place", title: "Duplicate" },
    { id: 2, entity_type: "place", title: "New" },
    { id: 2, entity_type: "place", title: "Duplicate in selection" },
  ]);
  assert.equal(next[0].manual_items.length, 2);
  assert.equal(next[0].manual_items[0].label, "Existing");
  assert.equal(next[0].manual_items[1].entity_id, "2");
  assert.deepEqual(addCandidatesToBlocks(blocks, "featured_events", [{ id: 2, entity_type: "place" }]), blocks);
});

test("single-row add appends to the selected block and keeps its duplicate guard", () => {
  const blocks = [{
    key: "top_picks",
    enabled: true,
    manual_items: [{ entity_type: "place", entity_id: "1", label: "Existing" }],
  }];
  const added = addCandidateToBlocks(blocks, "top_picks", { id: 2, entity_type: "place", title: "New" });
  assert.deepEqual(added[0].manual_items.map((item) => item.entity_id), ["1", "2"]);
  const duplicate = addCandidateToBlocks(added, "top_picks", { id: 2, entity_type: "place", title: "New again" });
  assert.deepEqual(duplicate[0].manual_items.map((item) => item.entity_id), ["1", "2"]);
});

test("Homepage Curation renders the lookup table and keeps lookup state out of layout serialization", () => {
  assert.match(source, /\[0, 1, 2\]\.map/);
  assert.match(source, /className="full approvals-summary-grid"/);
  assert.match(source, /คุณสมบัติ \{slotIndex \+ 1\}/);
  assert.match(source, /<option value="">ไม่เลือก<\/option>/);
  assert.match(source, /<table>/);
  assert.match(source, /เลือกทั้งหมดในหน้าปัจจุบัน/);
  assert.match(source, /เพิ่มรายการที่เลือกเข้า Block/);
  assert.match(source, /<th>การทำงาน<\/th>/);
  assert.match(source, /onClick=\{\(\) => addPoolCandidateToBlock\(candidate\)\}/);
  assert.match(source, /ใช้ในบล็อก/);
  assert.match(source, /setPoolSelectedCandidateKeys\(\[\]\);/);
  assert.match(source, /onClick=\{searchPoolCandidates\}/);
  assert.match(source, /taxonomyTrue: selectedTaxonomyLookupKeys\(poolState\.taxonomy_true\)/);
  assert.match(source, /taxonomyCatalog\.map/);
  assert.match(source, /draft_blocks: serializeBlocks\(blocks\)/);

  const serializeStart = source.indexOf("function serializeBlocks");
  const serializeEnd = source.indexOf("function createCandidateState", serializeStart);
  assert.equal(source.slice(serializeStart, serializeEnd).includes("taxonomy_true"), false);
});
