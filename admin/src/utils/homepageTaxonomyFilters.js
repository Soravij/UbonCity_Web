function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeAllowedKeys(allowedKeys) {
  const set = new Set();
  for (const key of Array.isArray(allowedKeys) ? allowedKeys : []) {
    const normalized = String(key || "").trim().toLowerCase();
    if (normalized) set.add(normalized);
  }
  return set;
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStringValue(value) {
  return String(value ?? "").trim();
}

function normalizeListValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeValueByType(valueType, rawValue) {
  const normalizedType = String(valueType || "string").trim().toLowerCase();

  if (normalizedType === "boolean") {
    if (rawValue === true || rawValue === false) {
      return { value: rawValue };
    }
    const normalized = String(rawValue ?? "").trim().toLowerCase();
    if (normalized === "true") return { value: true };
    if (normalized === "false") return { value: false };
    return { error: "Invalid boolean value" };
  }

  if (normalizedType === "number") {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return { value: rawValue };
    }
    const normalized = String(rawValue ?? "").trim();
    if (!normalized) return { error: "Invalid number value" };
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return { error: "Invalid number value" };
    return { value: parsed };
  }

  if (normalizedType === "multi_select") {
    const values = normalizeListValue(rawValue);
    if (!values.length) return { error: "Invalid multi-select value" };
    return { value: values };
  }

  const normalized = normalizeStringValue(rawValue);
  if (!normalized) return { error: "Invalid string value" };
  return { value: normalized };
}

function hasMeaningfulValue(valueType, rawValue) {
  const normalizedType = String(valueType || "string").trim().toLowerCase();
  if (normalizedType === "boolean") {
    return rawValue === true || rawValue === false || String(rawValue ?? "").trim().toLowerCase() === "true" || String(rawValue ?? "").trim().toLowerCase() === "false";
  }
  if (normalizedType === "number") {
    return String(rawValue ?? "").trim().length > 0 || (typeof rawValue === "number" && Number.isFinite(rawValue));
  }
  if (normalizedType === "multi_select") {
    return normalizeListValue(rawValue).length > 0;
  }
  return normalizeStringValue(rawValue).length > 0;
}

export function createTaxonomyFilterRow() {
  return {
    key: "",
    value_type: "string",
    value: "",
  };
}

export function buildTaxonomyFilters(rows, allowedKeys = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { filters: null, error: "" };
  }

  const allowedKeySet = normalizeAllowedKeys(allowedKeys);
  const filters = {};
  const seen = new Set();

  for (const row of rows) {
    if (!isPlainObject(row)) continue;

    const key = normalizeKey(row.key);
    const valueType = String(row.value_type || "string").trim().toLowerCase();
    const hasRawValue = Object.prototype.hasOwnProperty.call(row, "value");
    const rawValue = row.value;

    if (!key && !hasRawValue) continue;
    if (!key && !hasMeaningfulValue(valueType, rawValue)) continue;
    if (!key) return { filters: null, error: "Select a taxonomy key" };
    if (!allowedKeySet.has(key)) return { filters: null, error: "Unsupported taxonomy key" };
    if (seen.has(key)) return { filters: null, error: "Duplicate taxonomy key" };
    if (!hasRawValue) return { filters: null, error: "Missing taxonomy value" };

    const normalized = normalizeValueByType(valueType, rawValue);
    if (normalized.error) return { filters: null, error: normalized.error };

    seen.add(key);
    filters[key] = normalized.value;
  }

  return Object.keys(filters).length ? { filters, error: "" } : { filters: null, error: "" };
}

export function formatTaxonomyValue(value) {
  if (value == null) return "-";
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[object]";
    }
  }
  return String(value);
}
