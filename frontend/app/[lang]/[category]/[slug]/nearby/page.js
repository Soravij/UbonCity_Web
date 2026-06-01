import Link from "next/link";
import HoverCoverCard from "@/components/HoverCoverCard";
import { getNearbyPlaces, getPlaceDetail } from "@/lib/api";
import { getLangContent, normalizeLang } from "@/lib/site";

const NEARBY_PAGE_COPY = {
  en: {
    title: "Nearby Places",
    within10: "Places within 10 km from this location.",
    within20: "No places were found within 10 km, so this page shows places farther than 10 km but still under 20 km.",
    none: "There are no nearby place recommendations in our system for this location.",
    openPlace: "Open place",
    backPlace: "Back to place",
    backCategory: "Back to category",
  },
  th: {
    title: "\u0e2a\u0e16\u0e32\u0e19\u0e17\u0e35\u0e48\u0e43\u0e01\u0e25\u0e49\u0e40\u0e04\u0e35\u0e22\u0e07",
    within10: "\u0e2a\u0e16\u0e32\u0e19\u0e17\u0e35\u0e48\u0e17\u0e35\u0e48\u0e2d\u0e22\u0e39\u0e48\u0e43\u0e19\u0e23\u0e30\u0e22\u0e30\u0e44\u0e21\u0e48\u0e40\u0e01\u0e34\u0e19 10 \u0e01\u0e21. \u0e08\u0e32\u0e01\u0e08\u0e38\u0e14\u0e19\u0e35\u0e49",
    within20:
      "\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e2a\u0e16\u0e32\u0e19\u0e17\u0e35\u0e48\u0e43\u0e19\u0e23\u0e30\u0e22\u0e30 10 \u0e01\u0e21. \u0e08\u0e36\u0e07\u0e41\u0e2a\u0e14\u0e07\u0e40\u0e09\u0e1e\u0e32\u0e30\u0e2a\u0e16\u0e32\u0e19\u0e17\u0e35\u0e48\u0e17\u0e35\u0e48\u0e44\u0e01\u0e25\u0e01\u0e27\u0e48\u0e32 10 \u0e01\u0e21. \u0e41\u0e15\u0e48\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e16\u0e36\u0e07 20 \u0e01\u0e21.",
    none: "\u0e44\u0e21\u0e48\u0e21\u0e35\u0e2a\u0e16\u0e32\u0e19\u0e17\u0e35\u0e48\u0e41\u0e19\u0e30\u0e19\u0e33\u0e43\u0e01\u0e25\u0e49\u0e40\u0e04\u0e35\u0e22\u0e07\u0e43\u0e19\u0e23\u0e30\u0e1a\u0e1a\u0e02\u0e2d\u0e07\u0e40\u0e23\u0e32",
    openPlace: "\u0e40\u0e1b\u0e34\u0e14\u0e2a\u0e16\u0e32\u0e19\u0e17\u0e35\u0e48",
    backPlace: "\u0e01\u0e25\u0e31\u0e1a\u0e44\u0e1b\u0e2b\u0e19\u0e49\u0e32\u0e2a\u0e16\u0e32\u0e19\u0e17\u0e35\u0e48",
    backCategory: "\u0e01\u0e25\u0e31\u0e1a\u0e2b\u0e19\u0e49\u0e32\u0e2b\u0e21\u0e27\u0e14\u0e2b\u0e21\u0e39\u0e48",
  },
  zh: {
    title: "\u9644\u8fd1\u5730\u70b9",
    within10: "\u663e\u793a\u8ddd\u79bb\u6b64\u5730\u70b9 10 \u516c\u91cc\u4ee5\u5185\u7684\u7ed3\u679c\u3002",
    within20: "10 \u516c\u91cc\u5185\u6ca1\u6709\u7ed3\u679c\uff0c\u56e0\u6b64\u8fd9\u91cc\u53ea\u663e\u793a\u5927\u4e8e 10 \u516c\u91cc\u4e14\u5c0f\u4e8e 20 \u516c\u91cc\u7684\u5730\u70b9\u3002",
    none: "\u6211\u4eec\u7684\u7cfb\u7edf\u4e2d\u6ca1\u6709\u8be5\u5730\u70b9\u9644\u8fd1\u7684\u63a8\u8350\u5730\u70b9\u3002",
    openPlace: "\u6253\u5f00\u5730\u70b9",
    backPlace: "\u8fd4\u56de\u5730\u70b9\u9875",
    backCategory: "\u8fd4\u56de\u5206\u7c7b\u9875",
  },
  lo: {
    title: "\u0eaa\u0eb0\u0e96\u0eb2\u0e99\u0e97\u0eb5\u0ec8\u0ec3\u0e81\u0ec9\u0e84\u0ebb\u0ea7",
    within10: "\u0eaa\u0eb0\u0ec1\u0e94\u0e87\u0e9c\u0ebb\u0e99\u0ec3\u0e99\u0ea5\u0eb0\u0e8d\u0eb0\u0e9a\u0ecd\u0ec8\u0ec0\u0e81\u0eb5\u0e99 10 km \u0e88\u0eb2\u0e81\u0e88\u0eb8\u0e94\u0e99\u0eb5\u0ec9",
    within20:
      "\u0e9a\u0ecd\u0ec8\u0e9e\u0ebb\u0e9a\u0eaa\u0eb0\u0e96\u0eb2\u0e99\u0e97\u0eb5\u0ec8\u0ec3\u0e99\u0ea5\u0eb0\u0e8d\u0eb0 10 km \u0e88\u0eb6\u0ec8\u0e87\u0eaa\u0eb0\u0ec1\u0e94\u0e87\u0eaa\u0eb0\u0ec0\u0e9e\u0eb2\u0eb0\u0e88\u0eb8\u0e94\u0e97\u0eb5\u0ec8\u0ec4\u0e81\u0e81\u0ea7\u0ec8\u0eb2 10 km \u0ec1\u0e95\u0ec8\u0e9a\u0ecd\u0ec8\u0ec0\u0e81\u0eb5\u0e99 20 km",
    none: "\u0e9a\u0ecd\u0ec8\u0ea1\u0eb5\u0eaa\u0eb0\u0e96\u0eb2\u0e99\u0e97\u0eb5\u0ec8\u0ec1\u0e99\u0eb0\u0e99\u0eb3\u0ec3\u0e81\u0ec9\u0e84\u0ebb\u0ea7\u0ec3\u0e99\u0ea5\u0eb0\u0e9a\u0ebb\u0e9a\u0e82\u0ead\u0e87\u0e9e\u0ea7\u0e81\u0ec0\u0eae\u0ebb\u0eb2",
    openPlace: "\u0ec0\u0e9b\u0eb5\u0e94\u0eaa\u0eb0\u0e96\u0eb2\u0e99\u0e97\u0eb5\u0ec8",
    backPlace: "\u0e81\u0eb1\u0e9a\u0ec4\u0e9b\u0edc\u0ecd\u0eb2\u0eaa\u0eb0\u0e96\u0eb2\u0e99\u0e97\u0eb5\u0ec8",
    backCategory: "\u0e81\u0eb1\u0e9a\u0edc\u0ecd\u0eb2\u0edd\u0ea7\u0e94",
  },
};

function formatDistance(distanceKm, lang) {
  const value = Number(distanceKm);
  if (!Number.isFinite(value) || value < 0) return "";
  const locale = lang === "th" ? "th-TH" : lang === "zh" ? "zh-CN" : lang === "lo" ? "lo-LA" : "en-US";
  const formatted =
    value < 10
      ? value.toLocaleString(locale, { maximumFractionDigits: 1 })
      : value.toLocaleString(locale, { maximumFractionDigits: 0 });
  return `${formatted} km`;
}

function buildPlaceHref(lang, item) {
  if (!item?.category || !item?.slug) return null;
  return `/${lang}/${item.category}/${item.slug}`;
}

function getImageSource(item, category) {
  if (item?.effective_cover_image || item?.effective_thumbnail_image || item?.image) {
    return item.effective_cover_image || item.effective_thumbnail_image || item.image;
  }
  return category === "transport" ? "/default-transport.svg" : "/default-lotus.svg";
}

export async function generateMetadata({ params }) {
  const { lang, category, slug } = await params;
  const activeLang = normalizeLang(lang);
  const [place, nearbyResult] = await Promise.all([
    getPlaceDetail(category, slug, activeLang),
    getNearbyPlaces(category, slug, activeLang, 8),
  ]);
  const copy = NEARBY_PAGE_COPY[activeLang] || NEARBY_PAGE_COPY.en;
  const titleBase = String(place?.title || copy.title).trim();
  const rangeKey = String(nearbyResult?.rangeKey || "none");
  const description =
    rangeKey === "within_10km" ? copy.within10 : rangeKey === "within_20km" ? copy.within20 : copy.none;

  return {
    title: `${copy.title} | ${titleBase} | UBONCITY.COM`,
    description,
    alternates: {
      canonical: `/${activeLang}/${category}/${slug}/nearby`,
    },
  };
}

export default async function PlaceNearbyPage({ params }) {
  const { lang, category, slug } = await params;
  const activeLang = normalizeLang(lang);
  const [place, nearbyResult, siteCopy] = await Promise.all([
    getPlaceDetail(category, slug, activeLang),
    getNearbyPlaces(category, slug, activeLang, 8),
    Promise.resolve(getLangContent(activeLang)),
  ]);

  const pageCopy = NEARBY_PAGE_COPY[activeLang] || NEARBY_PAGE_COPY.en;
  const categoryLabel = siteCopy?.nav?.[category] || category || "-";

  if (!place) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-[color:var(--muted)]">{categoryLabel}</p>
        <h1 className="section-heading">{pageCopy.title}</h1>
        <p className="text-[15px] leading-7 text-slate-700 md:text-base">{pageCopy.none}</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/${activeLang}/${category}`}
            className="interactive-tile inline-flex rounded-full px-4 py-2 text-sm font-medium"
          >
            {pageCopy.backCategory}
          </Link>
        </div>
      </section>
    );
  }

  const nearbyPlaces = Array.isArray(nearbyResult?.items) ? nearbyResult.items : [];
  const rangeKey = String(nearbyResult?.rangeKey || "none");
  const subtitle =
    rangeKey === "within_10km" ? pageCopy.within10 : rangeKey === "within_20km" ? pageCopy.within20 : pageCopy.none;

  return (
    <section className="space-y-6 md:space-y-8">
      <div className="space-y-2">
        <p className="eyebrow-label">{categoryLabel}</p>
        <h1 className="section-heading">{pageCopy.title}</h1>
        <p className="section-copy">{place.title}</p>
        <p className="text-sm text-[color:var(--muted)]">{subtitle}</p>
      </div>

      {nearbyPlaces.length ? (
        <div className="flex flex-wrap gap-4">
          {nearbyPlaces.map((item) => {
            const href = buildPlaceHref(activeLang, item);
            if (!href) return null;

            return (
              <HoverCoverCard
                key={`nearby-${item.id}`}
                href={href}
                imageSrc={getImageSource(item, item.category || category)}
                eyebrow={siteCopy?.nav?.[item.category] || categoryLabel}
                title={item.title || "-"}
                description={item.excerpt || item.summary || item.description || subtitle}
                meta={item?.distance_km != null ? formatDistance(item.distance_km, activeLang) : ""}
                cta={pageCopy.openPlace}
                className="w-full md:w-[calc(50%_-_0.5rem)] xl:w-[calc(25%_-_0.75rem)]"
              />
            );
          })}
        </div>
      ) : (
        <section className="section-panel p-5 md:p-6">
          <p className="text-sm text-[color:var(--muted)]">{pageCopy.none}</p>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/${activeLang}/${category}/${slug}`}
          className="interactive-tile inline-flex rounded-full px-4 py-2 text-sm font-semibold transition"
        >
          {pageCopy.backPlace}
        </Link>
      </div>
    </section>
  );
}
