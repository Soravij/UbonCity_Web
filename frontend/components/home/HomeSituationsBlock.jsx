import Link from "next/link";

function SituationCard({ situation, maxPlaces, lang }) {
  const places = situation.places ?? [];
  const limitedPlaces = places.slice(0, maxPlaces);
  const showPlaces = limitedPlaces.length > 0;

  return (
    <article className="home-content-card">
      <h3 className="text-xl font-semibold tracking-[-0.03em]">{situation.title}</h3>
      {situation.description != null && (
        <p className="mt-2 text-sm leading-7 text-[color:var(--muted)]">{situation.description}</p>
      )}
      {showPlaces && (
        <ol className="mt-4 space-y-2">
          {limitedPlaces.map((place, index) => (
            <li key={place.id ?? index} className="editorial-list-line">
              <span className="home-number-chip">{index + 1}</span>
              <Link href={`/${lang}/${place.category}/${place.slug}`} className="line-clamp-1 text-sm font-medium hover:underline">{place.title || "-"}</Link>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export default function HomeSituationsBlock({ situations = [], lang, copy }) {
  if (!situations.length) return null;

  const first = situations[0];
  const second = situations[1] ?? null;
  const third = situations[2] ?? null;
  const rest = situations.slice(3, 7);

  return (
    <section className="editorial-section space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
        <div className="home-section-header">
          <p className="eyebrow-label">Situations</p>
          <h2 className="section-heading">{copy?.situationsTitle ?? ""}</h2>
        </div>
        <p className="section-copy max-w-2xl">{copy?.situationsSubtitle ?? ""}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SituationCard situation={first} maxPlaces={5} lang={lang} />
        <div className="grid gap-6">
          {second && <SituationCard situation={second} maxPlaces={3} lang={lang} />}
          {third && <SituationCard situation={third} maxPlaces={3} lang={lang} />}
        </div>
      </div>

      {rest.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((situation, index) => (
            <SituationCard key={situation.id ?? index} situation={situation} maxPlaces={3} lang={lang} />
          ))}
        </div>
      )}
    </section>
  );
}
