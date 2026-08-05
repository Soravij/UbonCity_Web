function parseObjectCandidate(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

// Payloads that went through fetchUrlMetadata carry extracted_article one level
// under `.payload_json` (see adapters/manual.mjs); payloads already unwrapped by
// the caller carry it directly. Check both so callers don't need to know which.
export function resolveExtractedArticle(payload = {}) {
  return (
    parseObjectCandidate(payload?.extracted_article)
    || parseObjectCandidate(payload?.payload_json?.extracted_article)
    || {}
  );
}
