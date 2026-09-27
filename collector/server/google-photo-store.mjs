import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const GOOGLE_PHOTO_PROXY_PATH = "/api/google-maps/photo";
export const GOOGLE_PHOTO_NAME_RE = /^places\/[^/?#]+\/photos\/[^/?#]+$/i;

function clampPhotoPx(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1400;
  return Math.min(n, 1600);
}

export function parseGooglePhotoProxyUrl(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text.includes(GOOGLE_PHOTO_PROXY_PATH)) return null;
  let u;
  try { u = new URL(text, "http://local"); } catch { return null; }
  if (u.pathname !== GOOGLE_PHOTO_PROXY_PATH) return null;
  const name = String(u.searchParams.get("name") || "").trim();
  if (!GOOGLE_PHOTO_NAME_RE.test(name)) return null;
  return {
    name,
    maxWidthPx: clampPhotoPx(u.searchParams.get("maxWidthPx")),
    maxHeightPx: clampPhotoPx(u.searchParams.get("maxHeightPx")),
  };
}

const EXT_BY_TYPE = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const TYPE_BY_EXT = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export function createGooglePhotoStore({ mediaDir, apiKeyProvider = () => process.env.GOOGLE_MAPS_API_KEY, fetchImpl = fetch } = {}) {
  const dir = path.join(mediaDir, "googleRef");
  const inflight = new Map();

  function keyOf(name, w, h) {
    return crypto.createHash("sha256").update(`${name}|${w}|${h}`).digest("hex").slice(0, 40);
  }

  async function readCached(name, w, h) {
    const key = keyOf(name, w, h);
    for (const ext of Object.keys(TYPE_BY_EXT)) {
      try {
        const body = await fs.readFile(path.join(dir, key + ext));
        return { body, contentType: TYPE_BY_EXT[ext] };
      } catch (err) {
        if (err?.code !== "ENOENT") console.error("[google-photo-store.read]", name, err?.message || err);
      }
    }
    return null;
  }

  async function fetchAndStore(name, w, h) {
    const apiKey = String(apiKeyProvider() || "").trim();
    if (!apiKey) {
      const e = new Error("GOOGLE_MAPS_API_KEY is missing");
      e.status = 503;
      throw e;
    }
    const googleUrl = new URL(`https://places.googleapis.com/v1/${name}/media`);
    googleUrl.searchParams.set("maxWidthPx", String(w));
    googleUrl.searchParams.set("maxHeightPx", String(h));
    googleUrl.searchParams.set("key", apiKey);
    const upstream = await fetchImpl(googleUrl, { method: "GET", redirect: "follow" });
    if (!upstream.ok) {
      const e = new Error("Unable to fetch Google photo");
      e.status = upstream.status;
      throw e;
    }
    const contentType = String(upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const body = Buffer.from(await upstream.arrayBuffer());
    const ext = EXT_BY_TYPE[contentType];
    if (ext && body.length) {
      const target = path.join(dir, keyOf(name, w, h) + ext);
      const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(tmp, body);
        await fs.rename(tmp, target);
      } catch (err) {
        await fs.unlink(tmp).catch(() => {});
        console.error("[google-photo-store.write]", name, err?.message || err);
      }
    }
    return { body, contentType: contentType || "image/jpeg" };
  }

  async function getOrFetch(name, w, h) {
    const cached = await readCached(name, w, h);
    if (cached) return { ...cached, cache: "hit" };
    const key = keyOf(name, w, h);
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchAndStore(name, w, h).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const fresh = await pending;
    return { ...fresh, cache: "miss" };
  }

  async function prefetchUrls(urls = []) {
    let stored = 0;
    let failed = 0;
    const seen = new Set();
    for (const url of urls) {
      const p = parseGooglePhotoProxyUrl(url);
      if (!p) continue;
      const key = keyOf(p.name, p.maxWidthPx, p.maxHeightPx);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (await readCached(p.name, p.maxWidthPx, p.maxHeightPx)) continue;
        await fetchAndStore(p.name, p.maxWidthPx, p.maxHeightPx);
        stored += 1;
      } catch (err) {
        failed += 1;
        console.error("[google-photo-store.prefetch]", p.name, err?.message || err);
      }
    }
    return { stored, failed };
  }

  async function deleteUrls(urls = []) {
    let deleted = 0;
    const seen = new Set();
    for (const url of urls) {
      const p = parseGooglePhotoProxyUrl(url);
      if (!p) continue;
      const key = keyOf(p.name, p.maxWidthPx, p.maxHeightPx);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const ext of Object.keys(TYPE_BY_EXT)) {
        try {
          await fs.unlink(path.join(dir, key + ext));
          deleted += 1;
        } catch (err) {
          if (err?.code !== "ENOENT") console.error("[google-photo-store.delete]", p.name, err?.message || err);
        }
      }
    }
    return { deleted };
  }

  return { getOrFetch, prefetchUrls, deleteUrls, keyOf };
}
