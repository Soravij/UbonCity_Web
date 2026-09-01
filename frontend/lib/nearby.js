export function formatDistance(distanceKm, lang) {
  const value = Number(distanceKm);
  if (!Number.isFinite(value) || value < 0) return "";
  const locale = lang === "th" ? "th-TH" : lang === "zh" ? "zh-CN" : lang === "lo" ? "lo-LA" : "en-US";
  const formatted =
    value < 10
      ? value.toLocaleString(locale, { maximumFractionDigits: 1 })
      : value.toLocaleString(locale, { maximumFractionDigits: 0 });
  return `${formatted} km`;
}

export function getImageSource(item, category) {
  if (item?.effective_cover_image || item?.effective_thumbnail_image || item?.image) {
    return item.effective_cover_image || item.effective_thumbnail_image || item.image;
  }
  return category === "transport" ? "/default-transport.svg" : "/default-lotus.svg";
}
