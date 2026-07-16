// Scraped/pasted evidence text sometimes still carries an un-decoded HTML entity (most often a
// numeric character reference like "&#233;" for "e" in a name such as "café"). The WHATWG URL
// parser treats a bare '#' as the start of the fragment no matter what precedes it, so leaving an
// entity's '#' undecoded causes new URL(...) to silently truncate everything from that point on.
// Run this on any raw string before handing it to `new URL(...)` so a leftover entity is resolved
// to its real character first, instead of being misread as a fragment delimiter.
export function decodeUrlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    });
}
