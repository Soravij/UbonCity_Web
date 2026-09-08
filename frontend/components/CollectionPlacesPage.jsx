import HoverCoverCard from "@/components/HoverCoverCard";
import { getCollectionDetail, getCollectionPlaces } from "@/lib/api";
import { getImageSource } from "@/lib/nearby";

export default async function CollectionPlacesPage({ kind, lang, slug }) {
  const [item, places] = await Promise.all([
    getCollectionDetail(kind, slug, lang),
    getCollectionPlaces(kind, slug, lang),
  ]);

  if (!item) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="section-heading">{kind === "shortcuts" ? "Shortcut" : "Situation"}</h1>
        <p className="text-[15px] leading-7 text-slate-700 md:text-base">
          This page could not be found.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6 md:space-y-8">
      <div className="space-y-2">
        <h1 className="section-heading">{item.title}</h1>
        {item.description ? <p className="section-copy">{item.description}</p> : null}
      </div>

      {places.length ? (
        <div className="flex flex-wrap gap-4">
          {places.map((p) => (
            <HoverCoverCard
              key={p.id}
              href={`/${lang}/${p.category}/${p.slug}`}
              imageSrc={getImageSource(p)}
              eyebrow={p.category}
              title={p.title}
              description={p.description || ""}
              className="w-full md:w-[calc(50%_-_0.5rem)] xl:w-[calc(25%_-_0.75rem)]"
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[color:var(--muted)]">No places found.</p>
      )}
    </section>
  );
}
