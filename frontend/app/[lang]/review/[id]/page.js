import PlaceDetailContent from "@/components/PlaceDetailContent";
import EventDetailContent from "@/components/EventDetailContent";
import { getReviewContentDetail } from "@/lib/api";
import { buildReviewAccessCookieName } from "@/lib/reviewAccess";
import { getLangContent, normalizeLang } from "@/lib/site";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toReviewMediaProxyUrl(entry = {}) {
  const storagePath = String(entry?.storage_path || "").trim().replace(/\\/g, "/");
  const fileName = String(entry?.file_name || "").trim();
  if (storagePath) {
    return `/api/review-media?path=${encodeURIComponent(storagePath)}`;
  }
  if (fileName) {
    return `/api/review-media?path=${encodeURIComponent(`uploads/${fileName}`)}`;
  }
  const rawUrl = String(entry?.url || "").trim();
  if (!rawUrl) return "";
  return `/api/review-media?url=${encodeURIComponent(rawUrl)}`;
}

function normalizeReviewAssetEntry(entry = {}) {
  const proxyUrl = toReviewMediaProxyUrl(entry);
  return {
    ...entry,
    url: proxyUrl || String(entry?.url || "").trim(),
  };
}

function rewriteReviewBodyMedia(html, entries = []) {
  let output = String(html || "");
  if (!output || !entries.length) return output;
  for (const entry of entries) {
    const proxyUrl = String(entry?.url || "").trim();
    if (!proxyUrl) continue;
    const originalUrl = String(entry?.original_url || "").trim();
    const sourceUrl = String(entry?.source_url || "").trim();
    const fileName = String(entry?.file_name || "").trim();
    const candidates = [originalUrl, sourceUrl].filter(Boolean);
    for (const candidate of candidates) {
      output = output.replace(new RegExp(escapeRegExp(candidate), "g"), proxyUrl);
    }
    if (fileName) {
      output = output.replace(
        new RegExp(`https?:\\/\\/[^"'\\s>]+\\/uploads\\/${escapeRegExp(fileName)}`, "g"),
        proxyUrl
      );
    }
  }
  return output;
}

function toReviewRenderModel(item) {
  const originalAssets = item?.assets && typeof item.assets === "object" ? item.assets : {};
  const coverEntry = originalAssets?.cover ? normalizeReviewAssetEntry({ ...originalAssets.cover, original_url: originalAssets.cover.url }) : null;
  const galleryEntries = Array.isArray(originalAssets?.gallery)
    ? originalAssets.gallery.map((entry) => normalizeReviewAssetEntry({ ...entry, original_url: entry?.url }))
    : [];
  const inlineEntries = Array.isArray(originalAssets?.inline)
    ? originalAssets.inline.map((entry) => normalizeReviewAssetEntry({ ...entry, original_url: entry?.url }))
    : [];
  const body = rewriteReviewBodyMedia(item?.body, [coverEntry, ...galleryEntries, ...inlineEntries].filter(Boolean));
  const coverUrl = String(coverEntry?.url || "").trim() || null;
  const galleryUrls = galleryEntries.map((entry) => String(entry?.url || "").trim()).filter(Boolean);
  const inlineUrls = inlineEntries.map((entry) => String(entry?.url || "").trim()).filter(Boolean);
  return {
    ...item,
    body,
    description: String(body || "").trim(),
    assets: {
      cover: coverEntry,
      gallery: galleryEntries,
      inline: inlineEntries,
    },
    image: coverUrl,
    effective_cover_image: coverUrl,
    media_gallery_images: galleryUrls,
    media_inline_images: inlineUrls,
  };
}

function ReviewFallback({ item, reason = "" }) {
  const coverUrl = String(item?.assets?.cover?.url || item?.effective_cover_image || item?.image || "").trim();
  const body = String(item?.body || item?.description || "").trim();
  const gallery = Array.isArray(item?.assets?.gallery) ? item.assets.gallery : [];
  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Review Mode: fallback renderer is being used for this item.
      </div>
      {reason ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          Review renderer failed and fell back to a safe preview. {reason}
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-sm text-slate-500">{String(item?.content_type || "content").trim().toUpperCase()}</p>
        <h1 className="text-2xl font-bold tracking-tight md:text-4xl">{item?.title || "Untitled review content"}</h1>
      </div>
      {(item?.event_period_text || item?.location_text || item?.map_url) ? (
        <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/60 p-4 text-sm text-slate-700">
          {item?.event_period_text ? <p><strong>ช่วงเวลา:</strong> {item.event_period_text}</p> : null}
          {item?.location_text ? <p><strong>สถานที่:</strong> {item.location_text}</p> : null}
          {item?.map_url ? (
            <p>
              <strong>แผนที่:</strong>{" "}
              <a href={item.map_url} target="_blank" rel="noopener noreferrer" className="text-orange-700 underline underline-offset-2">
                เปิดแผนที่
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
      {coverUrl ? <img src={coverUrl} alt={item?.title || "Review cover"} className="mx-auto block h-auto w-full rounded-xl object-contain" /> : null}
      {body ? <article className="content-prose whitespace-pre-line text-[15px] leading-7 text-slate-700 md:text-base">{body}</article> : null}
      {gallery.length ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold md:text-xl">More Photos</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {gallery.map((entry, index) => {
              const url = String(entry?.url || "").trim();
              if (!url) return null;
              return <img key={`${url}-${index}`} src={url} alt={`${item?.title || "Review"} gallery ${index + 1}`} className="h-auto w-full rounded-xl object-cover" loading="lazy" />;
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default async function ReviewContentPage({ params }) {
  const resolvedParams = await params;
  const { lang, id } = resolvedParams || {};
  const activeLang = normalizeLang(lang);
  const cookieStore = await cookies();
  const token = String(cookieStore.get(buildReviewAccessCookieName(id))?.value || "").trim();
  const item = await getReviewContentDetail(id, token);

  if (!item) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight md:text-4xl">Review content not found</h1>
        <p className="text-[15px] text-slate-700">This review link is invalid, expired, or you do not have access.</p>
      </section>
    );
  }

  const copy = getLangContent(activeLang);
  const reviewItem = toReviewRenderModel(item);
  try {
    if (item.content_type === "event") {
      return <EventDetailContent event={reviewItem} activeLang={activeLang} isReviewMode />;
    }

    const category = String(item.category || "attractions").trim().toLowerCase() || "attractions";
    const categoryLabel = copy?.nav?.[category] || category;
    return <PlaceDetailContent place={reviewItem} activeLang={activeLang} category={category} categoryLabel={categoryLabel} isReviewMode />;
  } catch (error) {
    console.error("review route render failed", {
      review_id: Number(item?.id || 0) || null,
      content_type: String(item?.content_type || "").trim().toLowerCase() || null,
      message: String(error?.message || error || "unknown error"),
    });
    return <ReviewFallback item={reviewItem} reason={String(error?.message || "Unknown renderer error")} />;
  }
}
