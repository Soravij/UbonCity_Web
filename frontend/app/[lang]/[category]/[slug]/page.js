import Link from "next/link";
import PlaceDetailContent from "@/components/PlaceDetailContent";
import { getPlaceDetail } from "@/lib/api";
import {
  buildAbsoluteUrl,
  buildBreadcrumbJsonLd,
  buildPlaceJsonLd,
  buildRobotsMetadata,
  buildSeoMetadata,
  buildWebPageJsonLd,
  pickPrimaryImage,
} from "@/lib/schemaMetadata";
import { getLangContent, normalizeLang } from "@/lib/site";

const DETAIL_COPY = {
  en: {
    notFoundTitle: "Content not found",
    notFoundDetail: "This link may have changed, or the content is not approved for public display yet.",
    backCategory: "Back to category",
  },
  th: {
    notFoundTitle: "ไม่พบเนื้อหา",
    notFoundDetail: "ลิงก์นี้อาจถูกเปลี่ยน slug หรือเนื้อหายังไม่ได้อนุมัติให้แสดงผล",
    backCategory: "กลับหน้าหมวดหมู่",
  },
};

function getSiteUrl() {
  return String(process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
}

function JsonLdScript({ data, id }) {
  if (!data || !Object.keys(data).length) return null;
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export async function generateMetadata({ params }) {
  const { lang, category, slug } = await params;
  const activeLang = normalizeLang(lang);
  const place = await getPlaceDetail(category, slug, activeLang);
  const copy = getLangContent(activeLang);

  if (!place) {
    return {
      title: `${copy?.nav?.[category] || category} | UBONCITY.COM`,
      description: "Ubon Ratchathani travel content",
      robots: buildRobotsMetadata(),
    };
  }

  return {
    ...buildSeoMetadata({
    title: place.meta_title || place.title || "UBONCITY.COM",
    description: place.meta_description || place.summary || place.description || "",
    canonicalPath: `/${activeLang}/${category}/${slug}`,
    lang: activeLang,
    siteUrl: getSiteUrl(),
    image: pickPrimaryImage(place),
    }),
    robots: buildRobotsMetadata(),
  };
}

export default async function PlaceDetailPage({ params }) {
  const { lang, category, slug } = await params;
  const activeLang = normalizeLang(lang);
  const [place, copy] = await Promise.all([
    getPlaceDetail(category, slug, activeLang),
    Promise.resolve(getLangContent(activeLang)),
  ]);
  const categoryLabel = copy?.nav?.[category] || category || "-";
  const detailCopy = DETAIL_COPY[activeLang] || DETAIL_COPY.en;
  const canonicalPath = `/${activeLang}/${category}/${slug}`;
  const canonicalUrl = buildAbsoluteUrl(canonicalPath, getSiteUrl());

  if (!place) {
    return (
      <section className="mx-auto max-w-3xl space-y-3 md:space-y-4">
        <p className="text-sm text-[color:var(--muted)]">{categoryLabel}</p>
        <h1 className="section-heading">{detailCopy.notFoundTitle}</h1>
        <p className="text-[15px] leading-7 text-slate-700 md:text-base">{detailCopy.notFoundDetail}</p>
        <div>
          <Link href={`/${activeLang}/${category}`} className="interactive-tile inline-flex rounded-full px-4 py-2 text-sm font-medium">
            {detailCopy.backCategory}
          </Link>
        </div>
      </section>
    );
  }

  const webPageJsonLd = buildWebPageJsonLd({
    title: place.meta_title || place.title || "UBONCITY.COM",
    description: place.meta_description || place.summary || place.description || "",
    canonicalUrl,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: copy?.siteTitle || "UBONCITY.COM", url: buildAbsoluteUrl(`/${activeLang}`, getSiteUrl()) },
    { name: categoryLabel, url: buildAbsoluteUrl(`/${activeLang}/${category}`, getSiteUrl()) },
    { name: String(place?.title || "").trim(), url: canonicalUrl },
  ]);
  const placeJsonLd = buildPlaceJsonLd({
    place,
    category,
    canonicalUrl,
  });

  return (
    <>
      <JsonLdScript id="place-webpage-jsonld" data={webPageJsonLd} />
      <JsonLdScript id="place-breadcrumb-jsonld" data={breadcrumbJsonLd} />
      <JsonLdScript id="place-entity-jsonld" data={placeJsonLd} />
      <PlaceDetailContent place={place} activeLang={activeLang} category={category} categoryLabel={categoryLabel} />
    </>
  );
}
