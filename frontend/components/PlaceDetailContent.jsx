"use client";

import Link from "next/link";
import MediaGallery from "@/components/MediaGallery";
import RotatedImage from "@/components/RotatedImage";
import { hasRichHtmlContent, sanitizeRichContentHtml } from "@/lib/richContent";
import { resolveDecisionSignalFromTags } from "@/lib/phase56-decision-helpers.mjs";
import { buildPlaceCtaRows } from "@/lib/place-cta.mjs";
import { postAnalyticsEvent } from "@/lib/api";

const DETAIL_COPY = {
  en: {
    decisionTitle: "Decision Guide",
    audienceLabel: "Suitable For",
    timeLabel: "Best Time",
    budgetLabel: "Budget",
    galleryTitle: "More Photos",
    nearbyAction: "Nearby Places",
    contactTitle: "Contact",
    contactName: "Contact",
    contactPhone: "Phone",
    contactLink: "Website / Link",
    contactDetails: "Details",
    ctaTitle: "Quick Actions",
    ctaMap: "Open Map",
    ctaPhone: "Call",
    ctaLine: "Open LINE",
    ctaFacebook: "Facebook Page",
    ctaWebsite: "Visit Website",
    audience: { family: "Family / mixed ages", couple: "Couples / photo-friendly trips", solo: "Solo / small groups", all: "Most travelers" },
    time: { morning: "Morning to daytime", evening: "Late afternoon to evening", anytime: "Anytime" },
    budget: { budget: "Budget-friendly", mid: "Mid-range", premium: "Premium / flexible budget" },
  },
  th: {
    decisionTitle: "สรุปช่วยตัดสินใจ",
    audienceLabel: "เหมาะกับใคร",
    timeLabel: "ช่วงเวลาที่แนะนำ",
    budgetLabel: "งบประมาณโดยประมาณ",
    galleryTitle: "ภาพเพิ่มเติม",
    nearbyAction: "สถานที่ใกล้เคียง",
    contactTitle: "ข้อมูลติดต่อ",
    contactName: "ผู้ติดต่อ",
    contactPhone: "เบอร์โทร",
    contactLink: "ลิงก์หลัก",
    contactDetails: "รายละเอียดติดต่อ",
    ctaTitle: "ช่องทางติดต่อ / ไปยังสถานที่",
    ctaMap: "เปิดแผนที่",
    ctaPhone: "โทร",
    ctaLine: "เปิด LINE",
    ctaFacebook: "เปิด Facebook",
    ctaWebsite: "เปิดเว็บไซต์",
    audience: { family: "ครอบครัว / ไปได้หลายช่วงวัย", couple: "คู่รัก / เน้นบรรยากาศและถ่ายรูป", solo: "เดี่ยวหรือกลุ่มเล็ก", all: "เหมาะกับผู้เดินทางทั่วไป" },
    time: { morning: "ช่วงเช้าถึงกลางวัน", evening: "ช่วงเย็นถึงค่ำ", anytime: "ไปได้ทุกช่วงเวลา" },
    budget: { budget: "ประหยัดและคุมงบ", mid: "งบปานกลาง", premium: "งบยืดหยุ่นหรือพรีเมียม" },
  },
};

function cleanMediaUrl(value) {
  return String(value || "").trim();
}

function normalizeRotation(rotation) {
  const n = Number(rotation);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

function parseCoverImageValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return { url: "", rotation: 0 };
  const match = value.match(/^(.*?)(?:#r=(-?\d+))?$/);
  return { url: String(match?.[1] || "").trim(), rotation: normalizeRotation(match?.[2] ?? 0) };
}

function parseAltRotation(rawAlt) {
  const input = String(rawAlt || "").trim();
  const match = input.match(/^(.*?)(?:\|r=(-?\d+))?$/);
  return { alt: String(match?.[1] || "").trim(), rotation: normalizeRotation(match?.[2] ?? 0) };
}

function normalizeTextSpacing(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

function stripLegacyGalleryMarkup(value) {
  return String(value || "")
    .replace(/<figure\b[^>]*class="[^"]*\bgallery-block\b[^"]*"[\s\S]*?<\/figure>/gi, "")
    .replace(/<div\b[^>]*class="[^"]*\bpreview-gallery\b[^"]*"[\s\S]*?<\/div>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDescriptionBlocks(text) {
  const source = String(text || "");
  const regex = /!\[([^\]]*)\]\(((?:https?:\/\/|\/api\/review-media\?[^)\s]+|\/uploads\/[^\s)]+)[^\s)]*)\)/g;
  const blocks = [];
  let lastIndex = 0;
  for (const match of source.matchAll(regex)) {
    const full = match[0];
    const url = (match[2] || "").trim();
    const index = match.index ?? 0;
    const parsedAlt = parseAltRotation(match[1]);
    if (index > lastIndex) {
      const textBlock = normalizeTextSpacing(source.slice(lastIndex, index));
      if (textBlock) blocks.push({ type: "text", value: textBlock });
    }
    if (url) blocks.push({ type: "image", url, alt: parsedAlt.alt || "Content image", rotation: parsedAlt.rotation });
    lastIndex = index + full.length;
  }
  if (lastIndex < source.length) {
    const textBlock = normalizeTextSpacing(source.slice(lastIndex));
    if (textBlock) blocks.push({ type: "text", value: textBlock });
  }
  if (!blocks.length) blocks.push({ type: "text", value: normalizeTextSpacing(source) || "No description provided." });
  return blocks;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function includesAny(text, keywords) {
  const source = normalizeText(text);
  return Boolean(source) && keywords.some((keyword) => source.includes(normalizeText(keyword)));
}

function parseDecisionTagList(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  return String(value || "").split(/[\,\n]/g).map((item) => normalizeText(item)).filter(Boolean);
}

function inferDecisionSignal(place, category) {
  const source = `${place?.title || ""} ${place?.description || ""}`;
  const inCategory = String(category || "").trim().toLowerCase();
  const familyHit = inCategory === "hotels" || includesAny(source, ["family", "kids", "เด็ก", "ครอบครัว"]);
  const coupleHit = inCategory === "cafes" || includesAny(source, ["couple", "romantic", "sunset", "วิว", "date", "ถ่ายรูป"]);
  const easyTravelHit = includesAny(source, ["ใกล้เมือง", "in town", "city", "walk", "เดิน"]);
  const eveningHit = includesAny(source, ["เย็น", "ค่ำ", "กลางคืน", "night", "sunset"]);
  const morningHit = includesAny(source, ["เช้า", "morning", "sunrise"]);
  const budgetHit = includesAny(source, ["budget", "cheap", "500", "ประหยัด", "คุ้ม", "ตลาด"]);
  const premiumHit = includesAny(source, ["luxury", "premium", "fine dining", "resort", "หรู"]);
  return {
    audience: familyHit ? "family" : coupleHit ? "couple" : inCategory === "activities" ? "solo" : "all",
    time: eveningHit ? "evening" : morningHit ? "morning" : "anytime",
    budget: budgetHit ? "budget" : premiumHit ? "premium" : "mid",
    transport: easyTravelHit ? "nearby" : "planned",
  };
}

function resolveDecisionSignal(place, category) {
  const fallback = inferDecisionSignal(place, category);
  const normalized = {
    ...place,
    decision_scenario_tags_list: parseDecisionTagList(place?.decision_scenario_tags_list || place?.decision_scenario_tags),
    decision_trend_flags_list: parseDecisionTagList(place?.decision_trend_flags_list || place?.decision_trend_flags),
    decision_moment_tags_list: parseDecisionTagList(place?.decision_moment_tags_list || place?.decision_moment_tags),
    decision_insight_flags_list: parseDecisionTagList(place?.decision_insight_flags_list || place?.decision_insight_flags),
  };
  return resolveDecisionSignalFromTags(fallback, normalized);
}

function safeRelativePathname() {
  if (typeof window === "undefined") return "/";
  const pathname = String(window.location?.pathname || "").trim();
  if (!pathname || !pathname.startsWith("/")) return "/";
  return pathname;
}

function hasPublishedPlaceIdentity(place) {
  const placeId = Number(place?.id || 0);
  return Number.isFinite(placeId) && placeId > 0;
}

export default function PlaceDetailContent({ place, activeLang = "th", category, categoryLabel = "-", isReviewMode = false }) {
  const detailCopy = DETAIL_COPY[activeLang] || DETAIL_COPY.en;
  const rawGalleryImages = Array.isArray(place?.media_gallery_images)
    ? place.media_gallery_images.map((value) => cleanMediaUrl(value)).filter(Boolean).filter((value, index, list) => list.indexOf(value) === index)
    : [];
  const descriptionSource = rawGalleryImages.length ? stripLegacyGalleryMarkup(place?.description || "") : String(place?.description || "");
  const richDescriptionHtml = hasRichHtmlContent(descriptionSource) ? sanitizeRichContentHtml(descriptionSource) : "";
  const useRichHtmlRenderer = Boolean(richDescriptionHtml);
  const blocks = parseDescriptionBlocks(descriptionSource);
  const firstImageIndex = blocks.findIndex((block) => block.type === "image");
  const firstImage = firstImageIndex >= 0 ? blocks[firstImageIndex] : null;
  const parsedCover = parseCoverImageValue(place?.effective_cover_image || place?.image);
  const matchedCoverImage = blocks.find((block) => block.type === "image" && parsedCover.url && block.url === parsedCover.url);
  const useFallbackCover = !parsedCover.url && Boolean(firstImage);
  const coverImage = parsedCover.url || firstImage?.url || "/default-lotus.svg";
  const coverRotation = parsedCover.url ? parsedCover.rotation || matchedCoverImage?.rotation || 0 : firstImage?.rotation || 0;
  const normalizedGalleryImages = rawGalleryImages.filter((value) => value !== coverImage);
  const contentBlocks = useFallbackCover
    ? blocks.filter((block, index) => !(block.type === "image" && index === firstImageIndex))
    : blocks;
  const decisionSignal = resolveDecisionSignal(place, category);
  const nearbyHref = `/${activeLang}/${category}/${place?.slug}`;
  const ctaRows = buildPlaceCtaRows(place, detailCopy);
  const shouldTrackPublicCtaClick = !isReviewMode && hasPublishedPlaceIdentity(place);
  const isTransportCategory = String(category || "").trim().toLowerCase() === "transport";
  const contactRows = isTransportCategory
    ? [
        { label: detailCopy.contactName, value: place?.transport_contact_name || "" },
        { label: detailCopy.contactPhone, value: place?.transport_contact_phone || "" },
        { label: detailCopy.contactLink, value: place?.transport_link_url || "" },
        { label: detailCopy.contactDetails, value: place?.transport_contact_details || "" },
      ].filter((row) => String(row.value || "").trim())
    : [];

  return (
    <section className="w-full max-w-none space-y-7 md:space-y-9">
      {isReviewMode ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Review Mode: this page is rendered from pending review content and is not publicly published yet.
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="eyebrow-label">{categoryLabel}</p>
        <h1 className="section-heading">{place?.title}</h1>
      </div>

      <div className="content-prose text-[15px] md:text-base">
        <RotatedImage src={coverImage} alt={place?.title || "Place image"} rotation={coverRotation} width="min(40vw, 100%)" />
        <div className="mt-3 flex flex-col gap-3">
          {useRichHtmlRenderer ? (
            <article dangerouslySetInnerHTML={{ __html: richDescriptionHtml }} />
          ) : (
            contentBlocks.map((block, index) => (
              block.type === "image" ? (
                <RotatedImage key={`detail-img-${index}`} src={block.url} alt={block.alt} rotation={block.rotation || 0} width="min(40vw, 100%)" loading="lazy" />
              ) : (
                <div key={`detail-text-${index}`} className="whitespace-pre-line">{block.value}</div>
              )
            ))
          )}
        </div>
      </div>

      {normalizedGalleryImages.length ? (
        <MediaGallery
          title={detailCopy.galleryTitle}
          items={normalizedGalleryImages.map((imageUrl, index) => ({ url: imageUrl, alt: `${place?.title || "Place"} gallery image ${index + 1}` }))}
        />
      ) : null}

      <section className="section-panel p-5 md:p-6">
        <h2 className="text-lg font-semibold md:text-xl">{detailCopy.decisionTitle}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <article className="interactive-tile rounded-[20px] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{detailCopy.audienceLabel}</p>
            <p className="mt-1 text-sm">{detailCopy.audience[decisionSignal.audience]}</p>
          </article>
          <article className="interactive-tile rounded-[20px] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{detailCopy.timeLabel}</p>
            <p className="mt-1 text-sm">{detailCopy.time[decisionSignal.time]}</p>
          </article>
          <article className="interactive-tile rounded-[20px] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{detailCopy.budgetLabel}</p>
            <p className="mt-1 text-sm">{detailCopy.budget[decisionSignal.budget]}</p>
          </article>
        </div>
      </section>

      {contactRows.length ? (
        <section className="section-panel p-5 md:p-6">
          <h2 className="text-lg font-semibold md:text-xl">{detailCopy.contactTitle}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {contactRows.map((row) => (
              <article key={row.label} className="interactive-tile rounded-[20px] p-3">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{row.label}</p>
                {row.label === detailCopy.contactLink ? (
                  <a href={row.value} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-sm text-[color:var(--accent)] underline-offset-4 hover:underline">
                    {row.value}
                  </a>
                ) : (
                  <p className="mt-1 whitespace-pre-line text-sm">{row.value}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {ctaRows.length ? (
        <section className="section-panel p-5 md:p-6">
          <h2 className="text-lg font-semibold md:text-xl">{detailCopy.ctaTitle}</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            {ctaRows.map((row) => (
              <a
                key={row.key}
                href={row.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (!shouldTrackPublicCtaClick) return;
                  void postAnalyticsEvent({
                    event_type: row.eventType,
                    source_path: safeRelativePathname(),
                    entity_type: "place",
                    entity_id: Number(place?.id || 0),
                  });
                }}
                className="interactive-tile inline-flex rounded-full px-5 py-3 text-sm font-semibold transition"
              >
                {row.label}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {!isReviewMode && place?.slug ? (
        <div className="flex justify-start">
          <Link href={`${nearbyHref}/nearby`} className="interactive-tile inline-flex rounded-full px-5 py-3 text-sm font-semibold transition">
            {detailCopy.nearbyAction}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
