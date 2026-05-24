import Card from "@/components/Card";
import { getPlaces } from "@/lib/api";
import { getLangContent, normalizeLang } from "@/lib/site";

export default async function CategoryPage({ lang, category }) {
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const categoryLabel = copy?.nav?.[category] || category;
  const places = await getPlaces(category, activeLang);
  const sortedPlaces = [...(Array.isArray(places) ? places : [])].sort(
    (a, b) => Number(b?.id || 0) - Number(a?.id || 0)
  );

  return (
    <section className="editorial-shell editorial-shell--content space-y-8 md:space-y-10">
      <section className="editorial-section category-hero category-hero--content-light">
        <div className="category-hero-grid">
          <div className="space-y-4 md:space-y-5">
            <p className="hero-banner-eyebrow editorial-kicker">{copy.siteTitle}</p>
            <div className="space-y-3">
              <h1 className="hero-banner-title category-hero-title">{categoryLabel}</h1>
              <p className="hero-banner-copy editorial-subtitle max-w-2xl">{copy.intro}</p>
            </div>
          </div>

          <div className="category-hero-aside">
            <div
              className="category-hero-art"
              style={{ backgroundImage: `url('/explore-patterns/explore-${category}.svg')` }}
              aria-hidden="true"
            />
          </div>
        </div>
      </section>

      <section className="editorial-section space-y-4">
        <div className="space-y-2">
          <p className="eyebrow-label">Category</p>
          <h2 className="section-heading">{categoryLabel}</h2>
          <p className="section-copy max-w-3xl">{copy.intro}</p>
        </div>

        {sortedPlaces.length ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {sortedPlaces.map((item) => (
              <Card key={`${item.category}-${item.slug}`} place={item} lang={activeLang} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-orange-300 bg-white p-5 text-sm text-[color:var(--muted)] md:p-6">
            {copy.empty}
          </p>
        )}
      </section>
    </section>
  );
}
