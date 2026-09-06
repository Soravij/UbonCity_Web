import Link from "next/link";

function SituationCard({ situation, maxPlaces, lang, copy, large = false, compact = false }) {
  const places = situation.places ?? [];
  const limitedPlaces = places.slice(0, maxPlaces);
  const showPlaces = limitedPlaces.length > 0;

  return (
    <article className={`home-content-card relative ${large ? "p-6 md:p-7" : "p-5"}`}>
      <div className="relative z-10 mb-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">
          {situation.title}
        </h3>
      </div>
      {situation.description != null && (
        <p className="mb-3 text-sm leading-7 text-[color:var(--muted)]">{situation.description}</p>
      )}
      {showPlaces ? (
        <div className="space-y-0">
          {limitedPlaces.map((place, index) => (
            <Link
              key={place.id ?? index}
              href={`/${lang}/${place.category}/${place.slug}`}
              className="editorial-list-line grid grid-cols-[44px_minmax(0,1fr)] gap-3 py-3 transition hover:translate-x-1 hover:text-[color:var(--accent)]"
            >
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--accent)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={`line-clamp-2 font-medium ${compact ? "text-[13px] leading-5" : "text-sm leading-6 md:text-[15px]"}`}>
                {place.title || "-"}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[color:var(--muted)]">{copy.situationEmpty}</p>
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
        <SituationCard situation={first} maxPlaces={5} lang={lang} copy={copy} large />
        <div className="grid gap-6">
          {second && <SituationCard situation={second} maxPlaces={3} lang={lang} copy={copy} />}
          {third && <SituationCard situation={third} maxPlaces={3} lang={lang} copy={copy} />}
        </div>
      </div>

      {rest.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {rest.map((situation, index) => (
            <SituationCard key={situation.id ?? index} situation={situation} maxPlaces={3} lang={lang} copy={copy} compact />
          ))}
        </div>
      )}
    </section>
  );
}
