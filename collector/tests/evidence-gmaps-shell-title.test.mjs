import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidenceCandidatesForNormalized } from "../server/evidence-candidates.mjs";

function build(title) {
  const normalized = {
    title,
    description: "",
    article_body_text: "",
    article_section_texts: [],
  };
  const base = {
    content_item_id: 1,
    source_record_id: 1,
    source_record_type: "source_records",
  };
  return buildEvidenceCandidatesForNormalized(normalized, base);
}

function titleBlocks(candidates) {
  return candidates.filter((c) => c.payload_json?.field === "title");
}

test("Google Maps shell title does not produce a title block", () => {
  assert.equal(titleBlocks(build("Google Maps")).length, 0);
});

test("Thai Google Maps shell title does not produce a title block", () => {
  assert.equal(titleBlocks(build("google แผนที่")).length, 0);
});

test("real place title still produces a title block", () => {
  const blocks = titleBlocks(build("วัดหนองป่าพง"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text_value, "Name: วัดหนองป่าพง");
});
