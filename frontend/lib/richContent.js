function stripQuotes(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeMediaPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/(^|https?:\/\/[^/]+)?\/media\/uploads\//i, "$1/uploads/")
    .replace(/^media\/uploads\//i, "/uploads/")
    .replace(/^uploads\//i, "/uploads/");
}

function sanitizeUrl(value, { allowRelative = false } = {}) {
  const raw = normalizeMediaPath(stripQuotes(value));
  if (!raw) return "";
  if (/^(javascript|data):/i.test(raw)) return "";
  if (allowRelative && raw.startsWith("/")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return allowRelative ? raw : "";
}

function sanitizeIframeUrl(value) {
  const normalized = sanitizeUrl(value, { allowRelative: false });
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    const allowedHosts = new Set([
      "www.youtube.com",
      "youtube.com",
      "www.youtube-nocookie.com",
      "youtube-nocookie.com",
      "player.vimeo.com",
    ]);
    if (!allowedHosts.has(host)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function sanitizeImgTag(tag) {
  const srcMatch = tag.match(/\ssrc\s*=\s*(".*?"|'.*?'|[^\s>]+)/i);
  const altMatch = tag.match(/\salt\s*=\s*(".*?"|'.*?'|[^\s>]+)/i);
  const src = sanitizeUrl(srcMatch?.[1], { allowRelative: true });
  if (!src) return "";
  const alt = stripQuotes(altMatch?.[1] || "");
  return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" loading="lazy">`;
}

function sanitizeIframeTag(tag) {
  const srcMatch = tag.match(/\ssrc\s*=\s*(".*?"|'.*?'|[^\s>]+)/i);
  const src = sanitizeIframeUrl(srcMatch?.[1]);
  if (!src) return "";
  return `<iframe src="${escapeAttribute(src)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

export function hasRichHtmlContent(value) {
  return /<(p|figure|figcaption|img|iframe|h[1-6]|blockquote|ul|ol|li|br)\b/i.test(String(value || ""));
}

export function sanitizeRichContentHtml(value) {
  const input = String(value || "").trim();
  if (!input) return "";

  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[^>]*><\/iframe>/gi, (tag) => sanitizeIframeTag(tag))
    .replace(/<img\b[^>]*>/gi, (tag) => sanitizeImgTag(tag))
    .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/\sstyle\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, (_, hrefValue) => {
      const href = sanitizeUrl(hrefValue, { allowRelative: false });
      return href ? ` href="${escapeAttribute(href)}"` : "";
    })
    .replace(/\ssrc\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, (_, srcValue) => {
      const src = sanitizeUrl(srcValue, { allowRelative: true });
      return src ? ` src="${escapeAttribute(src)}"` : "";
    });
}
