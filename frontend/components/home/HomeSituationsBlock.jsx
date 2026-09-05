function SituationCard({ situation, maxPlaces }) {
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
              <span className="line-clamp-1 text-sm font-medium">{place.title || "-"}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export default function HomeSituationsBlock({ situations = [], lang }) {
  if (!situations.length) return null;

  const first = situations[0];
  const second = situations[1] ?? null;
  const third = situations[2] ?? null;
  const rest = situations.slice(3, 7);

  return (
    <section className="home-flow-section">
      <div className="editorial-shell">
        <div className="grid gap-6 lg:grid-cols-2">
          <SituationCard situation={first} maxPlaces={5} />
          <div className="grid gap-6">
            {second && <SituationCard situation={second} maxPlaces={3} />}
            {third && <SituationCard situation={third} maxPlaces={3} />}
          </div>
        </div>

        {rest.length > 0 && (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {rest.map((situation, index) => (
              <SituationCard key={situation.id ?? index} situation={situation} maxPlaces={3} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
