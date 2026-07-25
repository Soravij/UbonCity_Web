import path from "node:path";

function sanitizeSegment(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return normalized || fallback;
}

export function assignmentAssetSlotFromOriginalName(originalName) {
  const baseName = path.basename(String(originalName || "").replace(/\\/g, "/"));
  const withoutExtension = baseName.slice(0, Math.max(0, baseName.length - path.extname(baseName).length));
  const candidate = withoutExtension.split("__")[0];
  return sanitizeSegment(candidate, "asset").toLowerCase();
}

export function assignmentAssetExtensionForMime(mimeType) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  const extensionByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
  };
  const extension = extensionByMime[normalized];
  if (!extension) throw new Error("unsupported assignment asset mime type");
  return extension;
}

export function formatAssignmentAssetFileName({ originalName, mimeType, contentItemId, sequence, now = new Date() }) {
  const itemId = Number(contentItemId || 0) || 0;
  const seq = Number(sequence || 0) || 0;
  if (!itemId || !Number.isInteger(seq) || seq < 1) throw new Error("invalid assignment asset naming inputs");
  const kind = String(mimeType || "").trim().toLowerCase().startsWith("video/") ? "vid" : "pic";
  const yyyyMmDd = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("");
  const paddedSequence = String(seq).padStart(seq > 99 ? 3 : 2, "0");
  return `${assignmentAssetSlotFromOriginalName(originalName)}__${kind}-item${itemId}-${paddedSequence}-${yyyyMmDd}${assignmentAssetExtensionForMime(mimeType)}`;
}

export function allocateAssignmentAssetSequence(db, contentItemId) {
  const itemId = Number(contentItemId || 0) || 0;
  if (!itemId) throw new Error("content_item_id is required for asset sequence");
  let began = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    began = true;
    db.prepare(`
      INSERT INTO content_asset_name_sequences (content_item_id, next_sequence, updated_at)
      VALUES (?, 2, CURRENT_TIMESTAMP)
      ON CONFLICT(content_item_id) DO UPDATE SET
        next_sequence=content_asset_name_sequences.next_sequence + 1,
        updated_at=CURRENT_TIMESTAMP
    `).run(itemId);
    const row = db.prepare("SELECT next_sequence - 1 AS sequence FROM content_asset_name_sequences WHERE content_item_id=?").get(itemId);
    const sequence = Number(row?.sequence || 0) || 0;
    if (!sequence) throw new Error("failed to allocate asset sequence");
    db.exec("COMMIT");
    began = false;
    return sequence;
  } catch (error) {
    if (began) {
      try { db.exec("ROLLBACK"); } catch {}
    }
    throw error;
  }
}
