import Link from "next/link";

import HomeFeaturedStrip from "@/components/home/HomeFeaturedStrip";
import HomeTrendingBlock from "@/components/home/HomeTrendingBlock";

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

function renderPlaceListBlock(block, props) {
  const { activeLang, copy, decisionCopy } = props;
  return (
    <section key={block.key} className="editorial-section space-y-6">
      <div className="space-y-2">
        <p className="eyebrow-label">Scenarios</p>
        <h2 className="section-heading">{decisionCopy.highlightTitle}</h2>
        <p className="section-copy max-w-2xl">{decisionCopy.highlightSubtitle}</p>
      </div>
      <HomeFeaturedStrip places={block.resolved_items || []} activeLang={activeLang} copy={copy} />
    </section>
  );
}

function renderEventListBlock(block, props) {
  const { activeLang, locale, copy, decisionCopy } = props;
  return (
    <HomeTrendingBlock
      activeLang={activeLang}
      copy={copy}
      decisionCopy={decisionCopy}
      latestEvents={block.resolved_items || []}
      title={block.title}
      subtitle={block.subtitle}
    />
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
        if (block.type === "hero") return null;
        if (block.type === "place-list") return renderPlaceListBlock(block, { activeLang, copy, decisionCopy });
        if (block.type === "event-list") return renderEventListBlock(block, { activeLang, locale, copy, decisionCopy });
        if (block.type === "scenario-grid") return renderScenarioGridBlock(block, { activeLang, copy, decisionCopy });
        return null;
      })}
    </section>
  );
}
