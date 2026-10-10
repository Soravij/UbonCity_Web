import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRawItem } from "../collector/sources/normalize.mjs";
import { buildEvidenceCandidatesForNormalized } from "../server/evidence-candidates.mjs";

test("normalizeRawItem carries metadata_fetch_error from payload_json into normalized_json", () => {
  const out = normalizeRawItem(
    { title: "x", source_url: "https://a.test/p", payload_json: { metadata_fetch_error: "HTTP 403" } },
    "manual"
  );
  assert.equal(out.normalized_json.metadata_fetch_error, "HTTP 403");
});

test("buildEvidenceCandidatesForNormalized returns no candidates when metadata_fetch_error is set", () => {
  const out = buildEvidenceCandidatesForNormalized({
    title: "x",
    source_url: "https://a.test/p",
    metadata_fetch_error: "HTTP 403",
  });
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 0);
});

test("buildEvidenceCandidatesForNormalized still builds candidates without metadata_fetch_error", () => {
  const out = buildEvidenceCandidatesForNormalized({ title: "x", source_url: "https://a.test/p" });
  assert.ok(Array.isArray(out));
  assert.ok(out.length > 0);
});
