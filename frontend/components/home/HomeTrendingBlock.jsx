import Link from "next/link";
import { LOCALE_MAP } from "@/lib/home-copy";

function formatUpdatedAt(value, lang) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat(LOCALE_MAP[lang] || "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getEventCardItems(events, total = 5) {
  const realItems = (Array.isArray(events) ? events : []).slice(0, total);
  const items = [...realItems];
  for (let index = realItems.length; index < total; index += 1) {
    items.push({
      id: `placeholder-${index + 1}`,
      title: "Event update coming soon",
      image: "/empty-event-art.svg",
      isPlaceholder: true,
    });
  }
  return items;
}

export default function HomeTrendingBlock({ activeLang, copy, decisionCopy, latestEvents }) {
  const eventCards = getEventCardItems(latestEvents, 5);
  const featured = eventCards[0];
  const secondary = eventCards.slice(1, 5);

  const renderEventCard = (event, className = "", isFeatured = false) => {
    const cardToneClass = isFeatured ? "is-featured" : "is-secondary";
    const media = (
      <div className={`home-event-media ${cardToneClass}${event.isPlaceholder ? " is-placeholder-media" : ""}`}>
        <img
          src={String(event.image || "/empty-event-art.svg")}
          alt={event.title || "Event"}
          className={`h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]${event.isPlaceholder ? " is-placeholder" : ""}`}
          loading="lazy"
        />
      </div>
    );

    const panel = (
      <div className={`home-event-panel ${cardToneClass}`}>
        {isFeatured ? (
          <p className="text-sm font-bold text-[color:var(--theme-text)]">
            {event.isPlaceholder
              ? decisionCopy.trendingEvents
              : formatUpdatedAt(event.approved_at || event.updated_at, activeLang)}
          </p>
        ) : null}
        <h3 className={`line-clamp-2 font-semibold tracking-[-0.03em] text-[color:var(--theme-text)] ${isFeatured ? "mt-3 text-2xl md:text-[2rem]" : "text-sm md:text-[15px]"}`}>
          {event.isPlaceholder ? copy.latestEventsEmpty : event.title || "-"}
        </h3>
        <span className={`home-event-arrow ${event.isPlaceholder ? "opacity-40" : ""}`} aria-hidden="true">
          {"\u203A"}
        </span>
      </div>
    );

    if (event.isPlaceholder) {
      return (
        <article key={String(event.id)} className={`home-event-card ${className}`.trim()}>
          {media}
          {panel}
        </article>
      );
    }

    return (
      <Link
        key={event.id}
        href={`/${activeLang}/events/${event.id}`}
        className={`home-event-card group block ${className}`.trim()}
        aria-label={event.title || decisionCopy.trendingEvents}
      >
        {media}
        {panel}
      </Link>
    );
  };

  return (
    <section className="editorial-section space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
        <div className="home-section-header">
          <p className="eyebrow-label">Latest</p>
          <h2 className="section-heading">{decisionCopy.trendingTitle}</h2>
        </div>
        <p className="section-copy max-w-2xl">{decisionCopy.trendingSubtitle}</p>
      </div>
      <div className="home-events-layout grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {renderEventCard(featured, "home-event-card--featured", true)}
        <div className="home-events-secondary-grid grid gap-6 sm:grid-cols-2">
          {secondary.map((event) => renderEventCard(event))}
        </div>
      </div>
    </section>
  );
}
