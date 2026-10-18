import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReelScript, buildReelScriptPrompt } from "../services/agent-generation.mjs";

test("normalizeReelScript keeps valid segments and fixes hashtags", () => {
  const out = normalizeReelScript({ segments: [
    { start_sec: 0, end_sec: 3, shot: "ชงกาแฟ", capture_type: "VIDEO", voiceover: "a", on_screen_text: "b" },
    { start_sec: 3, end_sec: 2, shot: "bad" },
    { start_sec: 3, end_sec: 7, shot: "" },
    { start_sec: 3, end_sec: 7, shot: "หน้าร้าน", capture_type: "x" },
  ], caption: " c ", hashtags: ["อุบล", "#cafe", ""] });
  assert.equal(out.segments.length, 2);
  assert.equal(out.segments[0].capture_type, "video");
  assert.equal(out.segments[1].capture_type, "video");
  assert.equal(out.duration_sec, 7);
  assert.equal(out.caption, "c");
  assert.deepEqual(out.hashtags, ["#อุบล", "#cafe"]);
});
test("normalizeReelScript returns null without segments", () => {
  assert.equal(normalizeReelScript({ segments: [] }), null);
  assert.equal(normalizeReelScript(null), null);
});
test("buildReelScriptPrompt includes title and field pack", () => {
  const p = buildReelScriptPrompt({ title: "Mighty Coffee" }, { social_hook: "hook-x" });
  assert.match(p, /Mighty Coffee/);
  assert.match(p, /hook-x/);
});
