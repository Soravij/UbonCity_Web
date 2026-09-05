import Link from "next/link";
import { CATEGORY_KEYS, getLangContent, normalizeLang } from "@/lib/site";
import { getEvents, getHomepageLayout, getPlaces, getUbonWeather } from "@/lib/api";
import { buildHomeDecisionSelections } from "@/lib/phase56-decision-helpers.mjs";
import { getDecisionCopy } from "@/lib/home-copy";
import HomepageLayoutRenderer from "@/components/HomepageLayoutRenderer";
import HomeLandingStage from "@/components/home/HomeLandingStage";
import HomeFeaturedStrip from "@/components/home/HomeFeaturedStrip";
import HomeSituationsBlock from "@/components/home/HomeSituationsBlock";
import HomeTrendingBlock from "@/components/home/HomeTrendingBlock";

export default async function LangHome({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const decisionCopy = getDecisionCopy(activeLang);

  const homeCategories = CATEGORY_KEYS.filter((key) => key !== "transport");

  const [homepageLayout, events, weather, categoryRows] = await Promise.all([
    getHomepageLayout(activeLang, "home"),
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
  const { topTenPlaces } = buildHomeDecisionSelections({
    allPlaces,
    placesByCategory,
  });
  const featuredStripPlaces = topTenPlaces.slice(0, 3);

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

  const resolvedBlocks = Array.isArray(homepageLayout?.resolved_blocks) ? homepageLayout.resolved_blocks : [];
  const hasPublishedCurationLayout =
    Boolean(homepageLayout?.published_at) &&
    homepageLayout?.source !== "draft_fallback" &&
    resolvedBlocks.length > 0;

  return (
    <section className="home-page-flow">
      <div className="home-flow-section home-flow-section--landing">
        <HomeLandingStage
          activeLang={activeLang}
          copy={copy}
          decisionCopy={decisionCopy}
          weather={weather}
          quickActions={quickActions}
          heroBlock={hasPublishedCurationLayout
            ? (resolvedBlocks?.find((b) => b.type === "hero") || null)
            : null}
        />
      </div>

      {hasPublishedCurationLayout ? (
        <div className="home-flow-section home-flow-section--surface-1">
          <HomepageLayoutRenderer
            blocks={resolvedBlocks}
            activeLang={activeLang}
            copy={copy}
            decisionCopy={decisionCopy}
            quickActions={quickActions}
          />
        </div>
      ) : (
        <>
          <div className="home-flow-section home-flow-section--surface-1 home-flow-section--bridge">
            <HomeFeaturedStrip
              places={featuredStripPlaces}
              activeLang={activeLang}
              copy={copy}
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
        </>
      )}

      <HomeSituationsBlock situations={homepageLayout?.situations ?? []} lang={activeLang} />

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
