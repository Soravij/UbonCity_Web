import Link from "next/link";

function buildPlaceHref(lang, place) {
  if (!place?.category || !place?.slug) return null;
  return `/${lang}/${place.category}/${place.slug}`;
}

function renderLinkList(items, activeLang, emptyText, limit = 3) {
  if (!items.length) {
    return <p className="text-sm text-[color:var(--muted)]">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {items.slice(0, limit).map((place, index) => {
        const href = buildPlaceHref(activeLang, place);
        const content = (
          <>
            <span className="home-number-chip">{index + 1}</span>
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-semibold leading-6 md:text-[15px]">
                {place.title || "-"}
              </p>
            </div>
          </>
        );

        if (!href) {
          return (
            <div key={`fallback-${place.id || index}`} className="flex items-start gap-3">
              {content}
            </div>
          );
        }

        return (
          <Link
            key={`linked-${place.id || index}`}
            href={href}
            className="flex items-start gap-3 transition hover:translate-x-1 hover:text-[color:var(--accent)]"
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

function renderSimpleLinkItems(items, activeLang, emptyText, limit = 3) {
  if (!items.length) {
    return <p className="text-sm text-[color:var(--muted)]">{emptyText}</p>;
  }

  return (
    <div className="space-y-0">
      {items.slice(0, limit).map((place, index) => {
        const href = buildPlaceHref(activeLang, place);
        const content = (
          <>
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--accent)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="line-clamp-2 text-sm font-medium leading-6 md:text-[15px]">
              {place.title || "-"}
            </span>
          </>
        );

        if (!href) {
          return (
            <div key={`simple-fallback-${place.id || index}`} className="editorial-list-line grid grid-cols-[44px_minmax(0,1fr)] gap-3 py-3">
              {content}
            </div>
          );
        }

        return (
          <Link
            key={`simple-linked-${place.id || index}`}
            href={href}
            className="editorial-list-line grid grid-cols-[44px_minmax(0,1fr)] gap-3 py-3 transition hover:translate-x-1 hover:text-[color:var(--accent)]"
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

export default function HomeSelectedBlock({ activeLang, copy, decisionCopy, topTenPlaces, topCafePlaces, eveningSpots }) {
  return (
    <section className="editorial-section space-y-6">
      <div className="home-section-header">
        <p className="eyebrow-label">Selected</p>
        <h2 className="section-heading">{decisionCopy.selectedTitle}</h2>
        <p className="section-copy max-w-2xl">{decisionCopy.selectedSubtitle}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.9fr)]">
        <article className="home-content-card group relative p-6 md:p-7">
          <Link
            href={`/${activeLang}/attractions`}
            aria-label={decisionCopy.selectedTop10}
            className="absolute inset-0 rounded-[inherit]"
          />
          <div className="relative z-10 mb-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{decisionCopy.selectedTop10}</h3>
          </div>
          <p className="relative z-10 mb-5 max-w-lg text-sm leading-7 text-[color:var(--muted)]">
            {decisionCopy.selectedCardSummary}
          </p>
          <div className="relative z-20">{renderLinkList(topTenPlaces, activeLang, copy.empty, 5)}</div>
        </article>

        <div className="grid gap-5">
          <article className="home-content-card group relative p-5">
            <Link
              href={`/${activeLang}/cafes`}
              aria-label={decisionCopy.selectedCafe}
              className="absolute inset-0 rounded-[inherit]"
            />
            <div className="relative z-10 mb-3">
              <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{decisionCopy.selectedCafe}</h3>
            </div>
            <div className="relative z-20">{renderSimpleLinkItems(topCafePlaces, activeLang, copy.empty)}</div>
          </article>

          <article className="home-content-card p-5">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{decisionCopy.selectedEvening}</h3>
            {renderSimpleLinkItems(eveningSpots, activeLang, copy.empty)}
          </article>
        </div>
      </div>
    </section>
  );
}
