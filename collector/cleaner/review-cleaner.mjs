function normalizeSpace(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dedupeTags(tags) {
  const seen = new Set();
  const out = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const key = String(tag || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(tag).trim());
  }
  return out;
}

export function cleanReviewsAndContent(items) {
  return items.map((item) => ({
    ...item,
    description: normalizeSpace(item.description),
    title: normalizeSpace(item.title),
    tags: dedupeTags(item.tags),
  }));
}
