import Link from "next/link";
import PlaceDetailContent from "@/components/PlaceDetailContent";
import { getPlaceDetail } from "@/lib/api";
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

export async function generateMetadata({ params }) {
  const { lang, category, slug } = await params;
  const place = await getPlaceDetail(category, slug, lang);
  const copy = getLangContent(lang);

  if (!place) {
    return {
      title: `${copy?.nav?.[category] || category} | UBONCITY.COM`,
      description: "Ubon Ratchathani travel content",
    };
  }

  const title = String(place.meta_title || place.title || "UBONCITY.COM").trim();
  const description = String(place.meta_description || place.description || "").replace(/\s+/g, " ").trim();

  return {
    title: `${title} | UBONCITY.COM`,
    description: description.slice(0, 160),
    alternates: {
      canonical: `/${lang}/${category}/${slug}`,
    },
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

  return <PlaceDetailContent place={place} activeLang={activeLang} category={category} categoryLabel={categoryLabel} />;
}
