import Link from "next/link";
import DecisionSearchBar from "@/components/DecisionSearchBar";

function buildPlaceHref(lang, place) {
  if (!place?.category || !place?.slug) return null;
  return `/${lang}/${place.category}/${place.slug}`;
}

function formatUpdatedAt(value, locale = "en-US") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseTagList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getScenarioBadge(place, decisionCopy, block) {
  const scenarioMap = new Map(
    (Array.isArray(decisionCopy?.scenarios) ? decisionCopy.scenarios : []).map((item) => [String(item?.key || "").replace(/_/g, "-"), item.title])
  );
  const preferredTags = parseTagList(block?.rule_config?.scenario_tags);
  const itemTags = parseTagList(place?.decision_scenario_tags_list || place?.decision_scenario_tags);
  const matched = preferredTags.find((tag) => itemTags.includes(tag)) || itemTags[0] || "";
  if (!matched) return "";
  return scenarioMap.get(matched) || matched;
}

function renderHeroBlock(block, props) {
  const {
    activeLang,
    decisionCopy,
    copy,
    quickActions,
  } = props;

  return (
    <section
      key={block.key}
      className="editorial-section home-hero hero-banner rounded-[36px] border border-orange-200 p-6 shadow-[0_22px_54px_rgba(91,37,43,0.18)] min-h-[520px] md:min-h-[680px] md:p-10"
      style={{
        backgroundImage:
          "linear-gradient(135deg, rgba(32,14,8,0.42), rgba(87,35,20,0.24)), url('/hero-uboncity.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="home-hero-content flex h-full flex-col justify-between gap-10">
        <div className="max-w-4xl space-y-5 pt-4 md:pt-10">
          <p className="hero-banner-eyebrow editorial-kicker">{copy.siteTitle}</p>
          <h1 className="hero-banner-title editorial-title max-w-4xl" style={{ letterSpacing: "0.01em" }}>
            {block.title || decisionCopy.heroHeading}
          </h1>
          <p className="hero-banner-copy editorial-subtitle max-w-2xl">
            {block.subtitle || decisionCopy.heroHint}
          </p>
        </div>

        <div className="editorial-panel max-w-3xl rounded-[30px] p-4 md:p-5">
          <DecisionSearchBar
            lang={activeLang}
            placeholder={decisionCopy.searchPlaceholder}
            submitLabel={decisionCopy.searchLabel}
            quickActions={quickActions}
          />
        </div>
      </div>
    </section>
  );
}

function renderPlaceListBlock(block, props) {
  const { activeLang, copy } = props;
  const items = Array.isArray(block.resolved_items) ? block.resolved_items : [];
  if (!items.length) return null;
  return (
    <section key={block.key} className="editorial-section space-y-6">
      <div className="space-y-2">
        <p className="eyebrow-label">Places</p>
        <h2 className="section-heading">{block.title || "Featured Places"}</h2>
        {block.subtitle ? <p className="section-copy max-w-2xl">{block.subtitle}</p> : null}
      </div>
      <div className="editorial-open-grid grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((place) => {
          const href = buildPlaceHref(activeLang, place);
          const categoryLabel = copy.nav?.[place.category] || place.category || "-";
          if (!href) return null;
          return (
            <Link
              key={`${block.key}-${place.id}`}
              href={href}
              className="editorial-open-cell home-clickable-surface block p-5 transition hover:bg-white/30 md:p-6"
            >
              <p className="eyebrow-label mb-2">{categoryLabel}</p>
              <p className="line-clamp-1 font-semibold">{place.title || "-"}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function renderEventListBlock(block, props) {
  const { activeLang, locale } = props;
  const items = Array.isArray(block.resolved_items) ? block.resolved_items : [];
  if (!items.length) return null;
  return (
    <section key={block.key} className="editorial-section space-y-6">
      <div className="space-y-2">
        <p className="eyebrow-label">Events</p>
        <h2 className="section-heading">{block.title || "Featured Events"}</h2>
        {block.subtitle ? <p className="section-copy max-w-2xl">{block.subtitle}</p> : null}
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {items.slice(0, 3).map((event) => (
          <Link
            key={`${block.key}-${event.id}`}
            href={`/${activeLang}/events/${event.id}`}
            className="home-event-card group block"
            aria-label={event.title || block.title || "Event"}
          >
            <div className="home-event-media">
              <img
                src={String(event.image || "/hero-uboncity.jpg")}
                alt={event.title || "Event"}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]"
                loading="lazy"
              />
            </div>
            <div className="home-event-panel">
              <p className="text-sm font-bold text-[color:var(--theme-text)]">
                {formatUpdatedAt(event.approved_at || event.updated_at, locale)}
              </p>
              <h3 className="mt-3 line-clamp-2 text-xl font-semibold tracking-[-0.03em] text-[color:var(--theme-text)]">
                {event.title || "-"}
              </h3>
              <span className="home-event-arrow" aria-hidden="true">
                ›
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function renderScenarioGridBlock(block, props) {
  const { activeLang, copy, decisionCopy } = props;
  const items = Array.isArray(block.resolved_items) ? block.resolved_items : [];
  if (!items.length) return null;
  return (
    <section key={block.key} className="editorial-section space-y-6">
      <div className="space-y-2">
        <p className="eyebrow-label">Scenarios</p>
        <h2 className="section-heading">{block.title || "By Scenario"}</h2>
        {block.subtitle ? <p className="section-copy max-w-2xl">{block.subtitle}</p> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((place) => {
          const href = buildPlaceHref(activeLang, place);
          const scenarioBadge = getScenarioBadge(place, decisionCopy, block);
          if (!href) return null;
          return (
            <Link key={`${block.key}-${place.id}`} href={href} className="editorial-card home-clickable-surface home-scenario-card block rounded-[28px] p-5 transition md:p-6">
              {scenarioBadge ? (
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{scenarioBadge}</p>
              ) : null}
              <h3 className="line-clamp-1 font-semibold">{place.title || "-"}</h3>
              <p className="mt-1 text-xs text-[color:var(--muted)]">{copy.nav?.[place.category] || place.category || "-"}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function HomepageLayoutRenderer({
  blocks,
  activeLang,
  copy,
  decisionCopy,
  quickActions,
  locale = "en-US",
}) {
  return (
    <section className="editorial-shell space-y-14 md:space-y-20">
      {(Array.isArray(blocks) ? blocks : []).map((block) => {
        if (block.type === "hero") return renderHeroBlock(block, { activeLang, copy, decisionCopy, quickActions });
        if (block.type === "place-list") return renderPlaceListBlock(block, { activeLang, copy });
        if (block.type === "event-list") return renderEventListBlock(block, { activeLang, locale });
        if (block.type === "scenario-grid") return renderScenarioGridBlock(block, { activeLang, copy, decisionCopy });
        return null;
      })}
    </section>
  );
}
