export function formatReelScriptText(item, script, now = new Date()) {
  const title = String(item?.title || "").trim();
  const lines = [`📍 ${title} — Reel ~${script?.duration_sec ?? "?"} วิ`, `สร้างเมื่อ: ${now.toISOString()}`, ""];
  for (const s of script?.segments || []) {
    lines.push(`[${s.start_sec}–${s.end_sec} วิ] ช็อต ${s.shot_no ?? "?"} → ${s.file}`);
    if (s.shot) lines.push(`  ภาพ: ${s.shot}`);
    if (s.voiceover) lines.push(`  พากย์: "${s.voiceover}"`);
    if (s.on_screen_text) lines.push(`  จอ: "${s.on_screen_text}"`);
    lines.push("");
  }
  if (script?.caption) lines.push("แคปชัน:", script.caption, "");
  if (Array.isArray(script?.hashtags) && script.hashtags.length) lines.push(script.hashtags.join(" "));
  return lines.join("\n") + "\n";
}
