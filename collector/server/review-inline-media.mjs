export function absolutizeCollectorMediaUrl(value, baseUrl) {
  const raw = String(value || "").trim();
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (base && /^\/(?:media\/)?uploads\//i.test(parsed.pathname)) {
        return new URL(parsed.pathname, `${base}/`).toString();
      }
      return parsed.toString();
    } catch {
      return raw;
    }
  }
  if (!base) return raw;
  try {
    return new URL(raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`, `${base}/`).toString();
  } catch {
    return raw;
  }
}

export function rewriteCollectorHtmlMediaUrls(html, baseUrl) {
  const markup = String(html || "").trim();
  const base = String(baseUrl || "").trim();
  if (!markup || !base) return markup;
  return markup.replace(
    /\b(src|href)\s*=\s*(["'])([^"'<>]+)\2/gi,
    (_match, attrName, quote, rawUrl) => {
      const rewritten = absolutizeCollectorMediaUrl(rawUrl, base);
      return `${attrName}=${quote}${rewritten}${quote}`;
    }
  );
}

function extractInlineImageUrlsFromHtml(html, baseUrl) {
  const markup = String(html || "").trim();
  if (!markup) return [];
  const urls = [];
  const seen = new Set();
  const pattern = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"'<>]+)\1/gi;
  let match;
  while ((match = pattern.exec(markup))) {
    const resolved = absolutizeCollectorMediaUrl(match[2], baseUrl);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved);
  }
  return urls;
}

function collectUploadsAliases(value) {
  const aliases = new Set();
  const push = (nextValue) => {
    const text = String(nextValue || "").trim();
    if (text) aliases.add(text);
  };
  const pushUploadPathAliases = (pathname, origin = "") => {
    const rawPath = String(pathname || "").trim();
    if (!rawPath) return;
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath.replace(/^\/+/, "")}`;
    let uploadsPath = "";
    let mediaUploadsPath = "";
    if (/^\/uploads\//i.test(normalizedPath)) {
      uploadsPath = normalizedPath;
      mediaUploadsPath = `/media${normalizedPath}`;
    } else if (/^\/media\/uploads\//i.test(normalizedPath)) {
      mediaUploadsPath = normalizedPath;
      uploadsPath = normalizedPath.replace(/^\/media/i, "");
    } else {
      return;
    }
    push(uploadsPath);
    push(mediaUploadsPath);
    const normalizedOrigin = String(origin || "").trim().replace(/\/+$/, "");
    if (normalizedOrigin) {
      push(`${normalizedOrigin}${uploadsPath}`);
      push(`${normalizedOrigin}${mediaUploadsPath}`);
    }
  };

  const text = String(value || "").trim();
  if (!text) return aliases;
  try {
    const parsed = new URL(text);
    push(parsed.toString());
    pushUploadPathAliases(parsed.pathname, parsed.origin);
  } catch {
    pushUploadPathAliases(text, "");
  }
  return aliases;
}

function isCollectorLocalImageAsset(asset) {
  const storageDisk = String(asset?.storage_disk || "").trim().toLowerCase();
  const storagePath = String(asset?.storage_path || "").trim();
  const mimeType = String(asset?.mime_type || "").trim().toLowerCase();
  if (!["local", "nas"].includes(storageDisk)) return false;
  if (!storagePath || /^https?:\/\//i.test(storagePath)) return false;
  if (mimeType && !mimeType.startsWith("image/")) return false;
  return true;
}

export function mergeInlineMediaManifestFromBody({
  mediaManifest,
  bodyHtml,
  baseUrl,
  allAssets,
  createInlineEntry,
}) {
  const manifest = mediaManifest && typeof mediaManifest === "object" ? mediaManifest : {};
  const existingInline = Array.isArray(manifest?.inline) ? manifest.inline : [];
  const existingUrls = new Set();
  const pushExistingAliases = (value) => {
    for (const alias of collectUploadsAliases(value)) existingUrls.add(alias);
    const normalized = absolutizeCollectorMediaUrl(value, baseUrl);
    if (normalized) existingUrls.add(normalized);
  };

  pushExistingAliases(manifest?.cover?.source_url || manifest?.cover?.url || "");
  (Array.isArray(manifest?.gallery) ? manifest.gallery : []).forEach((entry) => pushExistingAliases(entry?.source_url || entry?.url));
  existingInline.forEach((entry) => pushExistingAliases(entry?.source_url || entry?.url));

  const assetByUrl = new Map();
  for (const asset of Array.isArray(allAssets) ? allAssets : []) {
    if (!isCollectorLocalImageAsset(asset)) continue;
    const publicUrl = absolutizeCollectorMediaUrl(asset?.public_url || "", baseUrl);
    if (!publicUrl) continue;
    for (const alias of collectUploadsAliases(publicUrl)) {
      if (!assetByUrl.has(alias)) assetByUrl.set(alias, asset);
    }
    assetByUrl.set(publicUrl, asset);
  }

  const mergedInline = [...existingInline];
  const unresolvedCollectorUploadUrls = [];
  const bodyImageUrls = extractInlineImageUrlsFromHtml(bodyHtml, baseUrl);
  for (const sourceUrl of bodyImageUrls) {
    const aliases = collectUploadsAliases(sourceUrl);
    const isCollectorUpload = aliases.size > 0;
    if (!isCollectorUpload) continue;
    const alreadyPresent = [...aliases].some((alias) => existingUrls.has(alias)) || existingUrls.has(sourceUrl);
    if (alreadyPresent) continue;
    const matchedAsset = assetByUrl.get(sourceUrl) || [...aliases].map((alias) => assetByUrl.get(alias)).find(Boolean) || null;
    if (!matchedAsset) {
      unresolvedCollectorUploadUrls.push(sourceUrl);
      continue;
    }
    const inlineEntry = createInlineEntry(matchedAsset, mergedInline.length);
    if (!inlineEntry) {
      unresolvedCollectorUploadUrls.push(sourceUrl);
      continue;
    }
    mergedInline.push(inlineEntry);
    pushExistingAliases(inlineEntry.source_url || inlineEntry.url || "");
  }

  return {
    mediaManifest: {
      ...manifest,
      inline: mergedInline,
    },
    diagnostics: {
      body_image_urls: bodyImageUrls,
      unresolved_collector_upload_urls: unresolvedCollectorUploadUrls,
    },
  };
}

export function buildAdminReviewMultipartUploadPlan({
  payload,
  selectedAssets,
  allAssets,
  resolveStoragePath,
  fileExists,
}) {
  const selectedRows = Array.isArray(selectedAssets) ? selectedAssets : [];
  const allRows = Array.isArray(allAssets) ? allAssets : [];
  const byAssetId = new Map();
  const byUrl = new Map();
  const registerAsset = (asset) => {
    const assetId = Number(asset?.asset_id || asset?.id || 0) || 0;
    const publicUrl = String(asset?.public_url || "").trim();
    if (assetId > 0 && !byAssetId.has(assetId)) byAssetId.set(assetId, asset);
    if (publicUrl && !byUrl.has(publicUrl)) byUrl.set(publicUrl, asset);
  };
  selectedRows.forEach(registerAsset);
  allRows.forEach(registerAsset);

  const mediaEntries = [];
  if (payload?.media_manifest?.cover) mediaEntries.push({ usage_type: "cover", position: 0, entry: payload.media_manifest.cover });
  (Array.isArray(payload?.media_manifest?.gallery) ? payload.media_manifest.gallery : []).forEach((entry, index) => {
    mediaEntries.push({ usage_type: "gallery", position: index, entry });
  });
  (Array.isArray(payload?.media_manifest?.inline) ? payload.media_manifest.inline : []).forEach((entry, index) => {
    mediaEntries.push({ usage_type: "inline", position: index, entry });
  });

  const uploadPlan = [];
  const diagnostics = [];
  for (const mediaRow of mediaEntries) {
    const entry = mediaRow?.entry && typeof mediaRow.entry === "object" ? mediaRow.entry : null;
    if (!entry) continue;
    const sourceUrl = String(entry.source_url || entry.url || "").trim();
    const assetId = Number(entry.source_asset_id || 0) || 0;
    const role = String(entry.role || mediaRow.usage_type || "gallery").trim().toLowerCase() || "gallery";
    const clientMediaUid = String(entry.client_media_uid || "").trim();
    const asset = (assetId > 0 ? byAssetId.get(assetId) : null) || byUrl.get(sourceUrl) || null;
    const diagnostic = {
      asset_id: assetId || Number(asset?.asset_id || 0) || null,
      client_media_uid: clientMediaUid || null,
      role,
      has_file: false,
      reason: null,
    };
    if (!clientMediaUid) {
      diagnostic.reason = "client_media_uid_missing";
      diagnostics.push(diagnostic);
      throw new Error("eligible collector media client_media_uid missing for admin review upload");
    }
    if (!asset) {
      diagnostic.reason = "selected_asset_mapping_missing";
      diagnostics.push(diagnostic);
      throw new Error("eligible collector media file missing for admin review upload");
    }
    const storageDisk = String(asset?.storage_disk || "").trim().toLowerCase();
    const storagePath = String(asset?.storage_path || "").trim();
    const mimeType = String(entry.mime_type || asset?.mime_type || "").trim().toLowerCase();
    if (!["local", "nas"].includes(storageDisk) || !storagePath || /^https?:\/\//i.test(storagePath)) {
      diagnostic.reason = "asset_not_local_storage";
      diagnostics.push(diagnostic);
      throw new Error("eligible collector media file missing for admin review upload");
    }
    if (mimeType && !mimeType.startsWith("image/")) {
      diagnostic.reason = "asset_not_image";
      diagnostics.push(diagnostic);
      throw new Error("eligible collector media file missing for admin review upload");
    }
    const absolutePath = resolveStoragePath(storagePath);
    const hasFile = fileExists(absolutePath);
    diagnostic.has_file = hasFile;
    if (!hasFile) {
      diagnostic.reason = "local_file_missing";
      diagnostics.push(diagnostic);
      throw new Error("eligible collector media file missing for admin review upload");
    }
    diagnostics.push(diagnostic);
    uploadPlan.push({
      asset_id: Number(asset?.asset_id || 0) || null,
      client_media_uid: clientMediaUid,
      role,
      position: Number(mediaRow.position || 0) || 0,
      source_url: sourceUrl || null,
      mime_type: mimeType || "application/octet-stream",
      original_file_name: String(entry.original_file_name || asset?.file_name || "").trim() || `asset-${assetId || "media"}`,
      absolute_path: absolutePath,
    });
  }

  return {
    uploadPlan,
    diagnostics,
    eligibleSelectedAssetCount: selectedRows.filter((asset) => {
      const mimeType = String(asset?.mime_type || "").trim().toLowerCase();
      return String(asset?.public_url || "").trim() && (!mimeType || mimeType.startsWith("image/"));
    }).length,
  };
}
