// The taxonomy catalog now lives in the neutral shared module so backend can validate curation
// filter keys against the same source without importing from the collector tree. This re-export
// keeps every existing collector import path and public API working unchanged.
export * from "../../shared/taxonomy/taxonomy-catalog.mjs";
