const PROFILE_TEXT_LIMIT = 255;
const PROFILE_KEYS = ["display_name", "phone", "email_alt", "line_id"];

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function parseProfileObject(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanText(value) {
  return String(value || "").trim().slice(0, PROFILE_TEXT_LIMIT);
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, PROFILE_TEXT_LIMIT);
}

function collectIncomingProfileFields(body = {}) {
  const nested = parseProfileObject(body?.profile_json);
  const next = {};
  for (const key of PROFILE_KEYS) {
    if (hasOwn(body, key)) {
      next[key] = body[key];
      continue;
    }
    if (hasOwn(nested, key)) {
      next[key] = nested[key];
    }
  }
  return next;
}

export function normalizeUserProfilePayload(rawProfile, { fallbackDisplayName = "" } = {}) {
  const source = parseProfileObject(rawProfile);
  const displayName = cleanText(source.display_name) || cleanText(fallbackDisplayName);
  return {
    display_name: displayName,
    phone: cleanText(source.phone),
    email_alt: cleanEmail(source.email_alt),
    line_id: cleanText(source.line_id),
  };
}

export function buildStoredUserProfile(body = {}, { existingProfileJson = null, fallbackDisplayName = "" } = {}) {
  const existing = normalizeUserProfilePayload(existingProfileJson, { fallbackDisplayName });
  const incoming = collectIncomingProfileFields(body);
  const next = { ...existing };

  if (hasOwn(incoming, "display_name")) {
    next.display_name = cleanText(incoming.display_name) || cleanText(fallbackDisplayName) || existing.display_name;
  }
  if (hasOwn(incoming, "phone")) {
    next.phone = cleanText(incoming.phone);
  }
  if (hasOwn(incoming, "email_alt")) {
    next.email_alt = cleanEmail(incoming.email_alt);
  }
  if (hasOwn(incoming, "line_id")) {
    next.line_id = cleanText(incoming.line_id);
  }

  if (!next.display_name) {
    next.display_name = cleanText(fallbackDisplayName);
  }

  return JSON.stringify(next);
}

export function normalizeUserRowProfile(row = {}) {
  const fallbackDisplayName = cleanText(row?.display_name) || cleanText(row?.email);
  const profile = normalizeUserProfilePayload(row?.profile_json, { fallbackDisplayName });
  return {
    display_name: profile.display_name || fallbackDisplayName,
    phone: profile.phone || "",
    email_alt: profile.email_alt || "",
    line_id: profile.line_id || "",
    profile_json: profile,
  };
}
