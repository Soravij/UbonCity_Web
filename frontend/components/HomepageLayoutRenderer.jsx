import HomeFeaturedStrip from "@/components/home/HomeFeaturedStrip";
import HomeSituationsBlock from "@/components/home/HomeSituationsBlock";
import HomeTrendingBlock from "@/components/home/HomeTrendingBlock";

function renderPlaceListBlock(block, props) {
  const { activeLang, copy, decisionCopy } = props;
  return (
    <section key={block.key} className="editorial-section space-y-6">
      <div className="space-y-2">
        <p className="eyebrow-label">Places</p>
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
      key={block.key}
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
  const { activeLang, situations, decisionCopy } = props;
  return (
    <HomeSituationsBlock
      key={block.key}
      situations={situations}
      lang={activeLang}
      copy={decisionCopy}
    />
  );
}

export default function HomepageLayoutRenderer({
  blocks,
  activeLang,
  copy,
  decisionCopy,
  quickActions,
  situations = [],
  locale = "en-US",
}) {
  return (
    <section className="editorial-shell space-y-14 md:space-y-20">
      {(Array.isArray(blocks) ? blocks : []).map((block) => {
        if (block.type === "hero") return null;
        if (block.type === "place-list") return renderPlaceListBlock(block, { activeLang, copy, decisionCopy });
        if (block.type === "event-list") return renderEventListBlock(block, { activeLang, locale, copy, decisionCopy });
        if (block.type === "scenario-grid") return renderScenarioGridBlock(block, { activeLang, situations, decisionCopy });
        return null;
      })}
    </section>
  );
}
