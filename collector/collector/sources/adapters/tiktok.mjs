import { normalizeRawItem } from "../normalize.mjs";

export async function collectFromTikTokPayload(payload = []) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => normalizeRawItem({ ...row, source_name: row.source_name || "tiktok" }, "tiktok"));
}
