import Link from "next/link";

function buildPlaceHref(lang, place) {
  if (!place?.category || !place?.slug) return null;
  return `/${lang}/${place.category}/${place.slug}`;
}

export default function HomeScenariosBlock({ activeLang, copy, decisionCopy, scenarioPicks }) {
  return (
    <section className="editorial-section space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
        <div className="home-section-header">
          <p className="eyebrow-label">Scenarios</p>
          <h2 className="section-heading">{decisionCopy.scenariosTitle}</h2>
        </div>
        <p className="section-copy max-w-2xl">{decisionCopy.scenariosSubtitle}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {decisionCopy.scenarios.map((scenario) => (
          <article key={scenario.key} className="home-content-card group relative p-5 md:p-6">
            <Link
              href={`/${activeLang}/${scenario.href}`}
              aria-label={scenario.title}
              className="absolute inset-0 rounded-[inherit]"
            />
            <div className="relative z-10 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow-label mb-2">{copy.siteTitle}</p>
                  <h3 className="text-xl font-semibold tracking-[-0.03em]">{scenario.title}</h3>
                </div>
              </div>
              <p className="text-sm leading-7 text-[color:var(--muted)]">{scenario.description}</p>
              <div className="relative z-20 space-y-3">
                {(scenarioPicks[scenario.key] || []).map((place, index) => {
                  const href = buildPlaceHref(activeLang, place);
                  if (!href) return null;
                  return (
                    <Link key={`${scenario.key}-${place.id}`} href={href} className="flex items-center gap-3 transition hover:translate-x-1 hover:text-[color:var(--accent)]">
                      <span className="home-number-chip">{index + 1}</span>
                      <span className="line-clamp-1 text-sm font-medium">{place.title || "-"}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
