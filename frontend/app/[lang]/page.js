import Link from "next/link";
import { CATEGORY_KEYS, getLangContent, normalizeLang } from "@/lib/site";
import { getEvents, getPlaces, getUbonWeather } from "@/lib/api";
import { buildHomeDecisionSelections } from "@/lib/phase56-decision-helpers.mjs";
import { getDecisionCopy } from "@/lib/home-copy";
import HomeLandingStage from "@/components/home/HomeLandingStage";
import HomeSelectedBlock from "@/components/home/HomeSelectedBlock";
import HomeScenariosBlock from "@/components/home/HomeScenariosBlock";
import HomeTrendingBlock from "@/components/home/HomeTrendingBlock";

function parseDecisionTagList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getDecisionTags(item, field) {
  const listField = `${field}_list`;
  const list = parseDecisionTagList(item?.[listField]);
  if (list.length) return list;
  return parseDecisionTagList(item?.[field]);
}

function getFeaturedScore(item) {
  const score = Number(item?.decision_featured_score);
  return Number.isFinite(score) ? score : 0;
}

function sortByFeaturedThenRecent(items) {
  return [...items].sort((a, b) => {
    const scoreDiff = getFeaturedScore(b) - getFeaturedScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function pickUniquePlaces(groups, limit = 3) {
  const seen = new Set();
  const out = [];

  for (const group of groups) {
    for (const item of group) {
      const id = Number(item?.id || 0);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

export default async function LangHome({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const decisionCopy = getDecisionCopy(activeLang);

  const homeCategories = CATEGORY_KEYS.filter((key) => key !== "transport");

  const [events, weather, categoryRows] = await Promise.all([
    getEvents(activeLang),
    getUbonWeather(),
    Promise.all(homeCategories.map(async (category) => [category, await getPlaces(category, activeLang)])),
  ]);

  const placesByCategory = Object.fromEntries(
    categoryRows.map(([category, items]) => [
      category,
      (Array.isArray(items) ? items : []).map((item) => ({ ...item, category: item?.category || category })),
    ])
  );

  const decisionCategories = homeCategories;
  const allPlaces = decisionCategories.flatMap((category) => placesByCategory[category] || []);
  const latestEvents = events.slice(0, 5);
  const { topTenPlaces, topCafePlaces, eveningSpots } = buildHomeDecisionSelections({
    allPlaces,
    placesByCategory,
  });
  const featuredStripPlaces = topTenPlaces.slice(0, 3);

  const scenarioPicks = {
    day_trip: pickUniquePlaces(
      [
        sortByFeaturedThenRecent(
          allPlaces.filter((place) => getDecisionTags(place, "decision_scenario_tags").includes("day-trip"))
        ),
        placesByCategory.attractions || [],
        placesByCategory.activities || [],
      ],
      3
    ),
    budget: pickUniquePlaces(
      [
        sortByFeaturedThenRecent(
          allPlaces.filter((place) => getDecisionTags(place, "decision_scenario_tags").includes("budget-500"))
        ),
        placesByCategory.restaurants || [],
        placesByCategory.cafes || [],
      ],
      3
    ),
    couple: pickUniquePlaces(
      [
        sortByFeaturedThenRecent(
          allPlaces.filter((place) => getDecisionTags(place, "decision_scenario_tags").includes("couple"))
        ),
        placesByCategory.cafes || [],
        placesByCategory.attractions || [],
      ],
      3
    ),
    family: pickUniquePlaces(
      [
        sortByFeaturedThenRecent(
          allPlaces.filter((place) => getDecisionTags(place, "decision_scenario_tags").includes("family"))
        ),
        placesByCategory.attractions || [],
        placesByCategory.activities || [],
        placesByCategory.hotels || [],
      ],
      3
    ),
  };

  const quickActions = decisionCopy.quickActions.map((action) => {
    const prebuiltHref = String(action?.href || "").trim();
    if (prebuiltHref) {
      return { label: action.label, href: `/${activeLang}/${prebuiltHref}` };
    }
    return {
      label: action.label,
      href: `/${activeLang}/${action.category}?scenario=${encodeURIComponent(action.scenario)}`,
    };
  });

  return (
    <section className="home-page-flow">
      <div className="home-flow-section home-flow-section--landing">
        <HomeLandingStage
          activeLang={activeLang}
          copy={copy}
          decisionCopy={decisionCopy}
          weather={weather}
          quickActions={quickActions}
          featuredStripPlaces={featuredStripPlaces}
        />
      </div>

      <div className="home-flow-section home-flow-section--surface-1 home-flow-section--bridge">
        <HomeSelectedBlock
          activeLang={activeLang}
          copy={copy}
          decisionCopy={decisionCopy}
          topTenPlaces={topTenPlaces}
          topCafePlaces={topCafePlaces}
          eveningSpots={eveningSpots}
        />
      </div>

      <div className="home-flow-section home-flow-section--surface-2">
        <HomeScenariosBlock
          activeLang={activeLang}
          copy={copy}
          decisionCopy={decisionCopy}
          scenarioPicks={scenarioPicks}
        />
      </div>

      <div className="home-flow-section home-flow-section--surface-2">
        <HomeTrendingBlock
          activeLang={activeLang}
          copy={copy}
          decisionCopy={decisionCopy}
          latestEvents={latestEvents}
        />
      </div>

      <div className="home-flow-section home-flow-section--surface-1">
        <section className="editorial-section space-y-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end">
            <div className="home-section-header">
              <p className="eyebrow-label">Explore</p>
              <h2 className="section-heading">{decisionCopy.exploreTitle}</h2>
            </div>
            <p className="section-copy max-w-2xl">{decisionCopy.exploreSubtitle}</p>
          </div>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORY_KEYS.map((key) => (
              <Link
                key={key}
                href={`/${activeLang}/${key}`}
                className={`home-explore-link home-explore-link--${key} block p-5 text-base font-semibold text-[color:var(--theme-text)] md:px-5 md:py-6 md:text-lg`}
              >
                <span className="home-explore-content">
                  <span className="eyebrow-label mb-2 block">Category</span>
                  <span className="home-explore-name block">{copy.nav[key]}</span>
                </span>
                <span aria-hidden="true" className="home-explore-art" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
