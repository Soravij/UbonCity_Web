import HoverCoverCard from "@/components/HoverCoverCard";
import { getCollectionDetail, getCollectionPlaces } from "@/lib/api";
import { getImageSource } from "@/lib/nearby";
import { normalizeLang } from "@/lib/site";

const COLLECTION_PAGE_COPY = {
  en: {
    notFound: "This page could not be found.",
    noPlaces: "No places found.",
  },
  th: {
    notFound: "ไม่พบหน้านี้",
    noPlaces: "ยังไม่มีสถานที่",
  },
  zh: {
    notFound: "未找到此页面。",
    noPlaces: "暂无地点",
  },
  lo: {
    notFound: "ບໍ່ພົບໜ້ານີ້",
    noPlaces: "ຍັງບໍ່ມີສະຖານທີ່",
  },
};

export function pickTranslation(item, lang) {
  const list = Array.isArray(item?.translations) ? item.translations : [];
  return (
    list.find((t) => t.lang === lang) ||
    list.find((t) => t.lang === "en") ||
    list[0] ||
    {}
  );
}

export default async function CollectionPlacesPage({ kind, lang, slug }) {
  const activeLang = normalizeLang(lang);
  const copy = COLLECTION_PAGE_COPY[activeLang] || COLLECTION_PAGE_COPY.en;

  const [item, places] = await Promise.all([
    getCollectionDetail(kind, slug, activeLang),
    getCollectionPlaces(kind, slug, activeLang),
  ]);

  if (!item) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="section-heading">{kind}</h1>
        <p className="text-[15px] leading-7 text-slate-700 md:text-base">
          {copy.notFound}
        </p>
      </section>
    );
  }

  const tr = pickTranslation(item, activeLang);

  return (
    <section className="space-y-6 md:space-y-8">
      <div className="space-y-2">
        <h1 className="section-heading">{tr.title}</h1>
        {tr.description ? <p className="section-copy">{tr.description}</p> : null}
      </div>

      {places.length ? (
        <div className="flex flex-wrap gap-4">
          {places.map((p) => (
            <HoverCoverCard
              key={p.id}
              href={`/${activeLang}/${p.category}/${p.slug}`}
              imageSrc={getImageSource(p, p.category)}
              eyebrow={p.category}
              title={p.title || "-"}
              description={p.excerpt || p.summary || p.description || ""}
              descriptionClassName="content-hover-card__description--clamped"
              className="w-full md:w-[calc(50%_-_0.5rem)] xl:w-[calc(25%_-_0.75rem)]"
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[color:var(--muted)]">{copy.noPlaces}</p>
      )}
    </section>
  );
}
