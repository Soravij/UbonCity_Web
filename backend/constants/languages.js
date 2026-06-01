export const SUPPORTED_CONTENT_LANGS = ["th", "en", "zh", "lo"];

export const LANGUAGE_LABELS = {
  th: "Thai",
  en: "English",
  zh: "Chinese (Simplified)",
  lo: "Lao",
};

export function normalizeContentLang(rawLang, fallback = "th") {
  const lang = String(rawLang || "").trim().toLowerCase();
  return SUPPORTED_CONTENT_LANGS.includes(lang) ? lang : fallback;
}
