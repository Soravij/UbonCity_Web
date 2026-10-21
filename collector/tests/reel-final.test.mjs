import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReelScript, buildReelFinalPrompt } from "../services/agent-generation.mjs";
import { formatReelScriptText } from "../services/reel-script-text.mjs";

test("normalizeReelScript keeps file and shot_no", () => {
  const out = normalizeReelScript({ segments: [{ start_sec: 0, end_sec: 3, shot: "a", shot_no: 2, file: " shot-2-__video-item1-001.mp4 " }] });
  assert.equal(out.segments[0].shot_no, 2);
  assert.equal(out.segments[0].file, "shot-2-__video-item1-001.mp4");
});
test("buildReelFinalPrompt lists clips and draft", () => {
  const p = buildReelFinalPrompt({ title: "X" }, { fieldPack: { social_on_camera_points_json: ["ช็อต 1 · draft-line"] }, clips: [{ shot_no: 1, file: "shot-1-__v.mp4" }] });
  assert.match(p, /shot-1-__v\.mp4/);
  assert.match(p, /draft-line/);
});
test("formatReelScriptText writes file names and voiceover", () => {
  const t = formatReelScriptText({ title: "Mighty" }, { duration_sec: 3, segments: [{ start_sec: 0, end_sec: 3, shot_no: 1, file: "shot-1-__v.mp4", shot: "ดริป", voiceover: "สวัสดี", on_screen_text: "" }], caption: "c", hashtags: ["#a"] }, new Date("2026-10-20T00:00:00Z"));
  assert.match(t, /ช็อต 1 → shot-1-__v\.mp4/);
  assert.match(t, /พากย์: "สวัสดี"/);
});
test("normalizeReelScript strips hashtags from caption", () => {
  const out = normalizeReelScript({ segments: [{ start_sec: 0, end_sec: 3, shot: "a" }], caption: "ร้านดี #a #b", hashtags: ["#a"] });
  assert.equal(out.caption, "ร้านดี");
});
test("buildReelFinalPrompt includes shot text", () => {
  const p = buildReelFinalPrompt({ title: "X" }, { clips: [{ shot_no: 1, shot_text: "ดริปกาแฟ", file: "shot-1-__v.mp4" }] });
  assert.match(p, /ช็อต 1 · ดริปกาแฟ · file: shot-1-__v\.mp4/);
});
