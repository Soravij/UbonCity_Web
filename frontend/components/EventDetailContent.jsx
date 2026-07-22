import Link from "next/link";
import MediaGallery from "@/components/MediaGallery";
import RotatedImage from "@/components/RotatedImage";
import { sanitizeRichContentHtml } from "@/lib/richContent";
import { getLangContent } from "@/lib/site";

const LOCALE_MAP = { en: "en-US", th: "th-TH", zh: "zh-CN", lo: "lo-LA" };
const EVENT_DETAIL_COPY = {
  en: {
    eventLabel: "Event",
    infoTitle: "Event Details",
    updatedLabel: "Updated",
    periodLabel: "When",
    locationLabel: "Location",
    mapLabel: "Map",
    openMap: "Open map",
    galleryTitle: "More Photos",
  },
  th: {
    eventLabel: "Event",
    infoTitle: "ข้อมูลงาน",
    updatedLabel: "อัปเดตล่าสุด",
    periodLabel: "ช่วงเวลา",
    locationLabel: "สถานที่",
    mapLabel: "แผนที่",
    openMap: "เปิดแผนที่",
    galleryTitle: "ภาพเพิ่มเติม",
  },
  zh: {
    eventLabel: "活动",
    infoTitle: "活动信息",
    updatedLabel: "最近更新",
    periodLabel: "时间",
    locationLabel: "地点",
    mapLabel: "地图",
    openMap: "打开地图",
    galleryTitle: "更多图片",
  },
  lo: {
    eventLabel: "Event",
    infoTitle: "ຂໍ້ມູນງານ",
    updatedLabel: "ອັບເດດລ່າສຸດ",
    periodLabel: "ໄລຍະເວລາ",
    locationLabel: "ສະຖານທີ່",
    mapLabel: "ແຜນທີ່",
    openMap: "ເປີດແຜນທີ່",
    galleryTitle: "ຮູບເພີ່ມເຕີມ",
  },
};

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toMediaProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\/uploads\//i.test(raw)) {
    return `/api/media-proxy?path=${encodeURIComponent(raw)}`;
  }
  if (/^uploads\//i.test(raw)) {
    return `/api/media-proxy?path=${encodeURIComponent(`/${raw}`)}`;
  }
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (!/^\/uploads\//i.test(parsed.pathname)) return raw;
    return `/api/media-proxy?path=${encodeURIComponent(parsed.pathname)}`;
  } catch {
    return raw;
  }
}

function rewriteHtmlMediaToProxy(value) {
  let html = String(value || "").trim();
  if (!html) return html;
  const matches = Array.from(html.matchAll(/\b(src|href)\s*=\s*(["'])([^"'<>]+)\2/gi));
  for (const match of matches) {
    const originalUrl = String(match[3] || "").trim();
    const proxyUrl = toMediaProxyUrl(originalUrl);
    if (!proxyUrl || proxyUrl === originalUrl) continue;
    html = html.replace(new RegExp(escapeRegExp(originalUrl), "g"), proxyUrl);
  }
  return html;
}

function formatUpdatedAt(value, lang) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(LOCALE_MAP[lang] || "en-US", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function cleanMediaUrl(value) {
  return toMediaProxyUrl(value);
}

function stripLegacyGalleryMarkup(value) {
  return String(value || "")
    .replace(/<figure\b[^>]*class="[^"]*\bgallery-block\b[^"]*"[\s\S]*?<\/figure>/gi, "")
    .replace(/<div\b[^>]*class="[^"]*\bpreview-gallery\b[^"]*"[\s\S]*?<\/div>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function EventDetailContent({ event, activeLang = "th", isReviewMode = false }) {
  const copy = getLangContent(activeLang);
  const detailCopy = EVENT_DETAIL_COPY[activeLang] || EVENT_DETAIL_COPY.en;
  const coverImage = cleanMediaUrl(event?.effective_cover_image || event?.image);
  const galleryImages = Array.isArray(event?.media_gallery_images)
    ? event.media_gallery_images
      .map((value) => cleanMediaUrl(value))
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .filter((value) => value !== coverImage)
    : [];
  const galleryItemByUrl = new Map(
    (Array.isArray(event?.media_gallery_items) ? event.media_gallery_items : [])
      .map((item) => ({ ...item, url: cleanMediaUrl(item?.url) }))
      .filter((item) => item.url)
      .map((item) => [item.url, item])
  );
  const rawDescription = galleryImages.length
    ? stripLegacyGalleryMarkup(event?.description || "")
    : String(event?.description || "").trim();
  const descriptionHtml = sanitizeRichContentHtml(rewriteHtmlMediaToProxy(rawDescription));
  const infoRows = [
    { label: detailCopy.updatedLabel, value: formatUpdatedAt(event?.approved_at || event?.updated_at, activeLang) },
    { label: detailCopy.periodLabel, value: String(event?.event_period_text || "").trim() },
    { label: detailCopy.locationLabel, value: String(event?.location_text || "").trim() },
    { label: detailCopy.mapLabel, value: String(event?.map_url || "").trim(), isLink: true },
  ].filter((row) => row.value);

  return (
    <section className="w-full max-w-none space-y-7 md:space-y-9">
      {isReviewMode ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Review Mode: this page is rendered from pending review content and is not publicly published yet.
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="eyebrow-label">{detailCopy.eventLabel}</p>
        <h1 className="section-heading">{event?.title}</h1>
      </div>

      <div className="content-prose text-[15px] md:text-base">
        {coverImage ? <RotatedImage src={coverImage} alt={event?.title || "Event"} width="min(40vw, 100%)" /> : null}
        {descriptionHtml ? (
          <div className="mt-3 flex flex-col gap-3">
            <article dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
          </div>
        ) : null}
      </div>

      {galleryImages.length ? (
        <MediaGallery
          title={detailCopy.galleryTitle}
          items={galleryImages.map((imageUrl, index) => ({
            url: imageUrl,
            alt: `${event?.title || "Event"} gallery image ${index + 1}`,
            caption: galleryItemByUrl.get(imageUrl)?.caption || null,
          }))}
        />
      ) : null}

      {infoRows.length ? (
        <section className="section-panel p-5 md:p-6">
          <h2 className="text-lg font-semibold md:text-xl">{detailCopy.infoTitle}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {infoRows.map((row) => (
              <article key={row.label} className="interactive-tile rounded-[20px] p-3">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{row.label}</p>
                {row.isLink ? (
                  <a href={row.value} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-sm text-[color:var(--accent)] underline-offset-4 hover:underline">
                    {detailCopy.openMap}
                  </a>
                ) : (
                  <p className="mt-1 whitespace-pre-line text-sm">{row.value}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!isReviewMode ? (
        <div className="flex justify-start">
          <Link href={`/${activeLang}`} className="interactive-tile inline-flex rounded-full px-5 py-3 text-sm font-semibold transition">
            {copy.backHome}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
