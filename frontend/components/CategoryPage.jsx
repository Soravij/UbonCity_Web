import Card from "@/components/Card";
import { getPlaces } from "@/lib/api";
import { getLangContent } from "@/lib/site";

export default async function CategoryPage({ lang, category }) {
  const [items, copy] = await Promise.all([
    getPlaces(category, lang),
    Promise.resolve(getLangContent(lang)),
  ]);

  return (
    <section className="space-y-5 md:space-y-6">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{copy.nav[category]}</h1>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-orange-300 bg-white p-5 text-sm text-[color:var(--muted)] md:p-6">
          {copy.empty}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {items.map((place) => (
            <Card key={place.id ?? `${category}-${place.title}`} place={place} lang={lang} />
          ))}
        </div>
      )}
    </section>
  );
}
