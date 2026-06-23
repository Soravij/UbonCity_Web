import { isKnownTaxonomyCatalogKey } from "../constants/taxonomyCatalog.js";

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseCuratedTaxonomy(curatedTaxonomy) {
  if (curatedTaxonomy == null) return null;
  if (typeof curatedTaxonomy === "string") {
    try {
      const parsed = JSON.parse(curatedTaxonomy);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(curatedTaxonomy) ? curatedTaxonomy : null;
}

function normalizeFilterKey(key) {
  return String(key || "").trim().toLowerCase();
}

function isFilterableTaxonomyKey(key) {
  if (!key) return false;
  if (key.startsWith("custom.")) return false;
  if (key === "category" || key === "subtype" || key === "tags") return false;
  return isKnownTaxonomyCatalogKey(key);
}

function isExactObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepExactMatch(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left == null || right == null) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => deepExactMatch(entry, right[index]));
  }

  if (isExactObject(left) || isExactObject(right)) {
    if (!isExactObject(left) || !isExactObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepExactMatch(left[key], right[key]));
  }

  return false;
}

function isExactFilterValueMatch(storedValue, filterValue) {
  if (typeof filterValue === "boolean") {
    return typeof storedValue === "boolean" && storedValue === filterValue;
  }

  if (typeof filterValue === "number") {
    return typeof storedValue === "number" && storedValue === filterValue;
  }

  if (typeof filterValue === "string") {
    if (typeof storedValue === "string") return storedValue === filterValue;
    if (Array.isArray(storedValue)) {
      return storedValue.some((entry) => deepExactMatch(entry, filterValue));
    }
    return false;
  }

  if (Array.isArray(filterValue)) {
    if (!Array.isArray(storedValue)) return false;
    return filterValue.every((requestedValue) =>
      storedValue.some((candidate) => deepExactMatch(candidate, requestedValue))
    );
  }

  if (isExactObject(filterValue)) {
    return isExactObject(storedValue) && deepExactMatch(storedValue, filterValue);
  }

  return false;
}

function normalizeFilters(filters) {
  if (!isPlainObject(filters)) return null;
  return Object.entries(filters).reduce((acc, [rawKey, rawValue]) => {
    const key = normalizeFilterKey(rawKey);
    if (!isFilterableTaxonomyKey(key)) return acc;
    acc[key] = rawValue;
    return acc;
  }, {});
}

export function matchesCuratedTaxonomy(curatedTaxonomy, filters) {
  const normalizedFilters = normalizeFilters(filters);
  if (!normalizedFilters) return false;
  const filterKeys = Object.keys(normalizedFilters);
  if (filterKeys.length === 0) return true;

  const taxonomy = parseCuratedTaxonomy(curatedTaxonomy);
  if (!taxonomy) return false;

  return filterKeys.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(taxonomy, key)) return false;
    return isExactFilterValueMatch(taxonomy[key], normalizedFilters[key]);
  });
}

export function filterPlacesByCuratedTaxonomy(places, filters) {
  if (!Array.isArray(places)) return [];
  return places.filter((place) => matchesCuratedTaxonomy(place?.curated_taxonomy_json ?? null, filters));
}
