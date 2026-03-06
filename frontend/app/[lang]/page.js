import Link from "next/link";
import { CATEGORY_KEYS, getLangContent, normalizeLang } from "@/lib/site";
import { getEvents } from "@/lib/api";

const LOCALE_MAP = {
  en: "en-US",
  th: "th-TH",
  zh: "zh-CN",
  lo: "lo-LA",
};

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

export default async function LangHome({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const events = await getEvents();
  const latestEvents = events.slice(0, 5);

  return (
    <section className="space-y-8 md:space-y-10">
      <div className="rounded-3xl border border-orange-200 bg-[color:var(--card)] p-6 shadow-[0_12px_30px_rgba(240,122,34,0.08)] md:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[color:var(--accent)] md:text-sm">
          {copy.siteTitle}
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-bold leading-tight tracking-tight md:text-5xl">
          {copy.tagline}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[color:var(--muted)] md:text-base">{copy.intro}</p>
      </div>

      <section className="rounded-3xl border border-orange-200 bg-white/75 p-4 shadow-[0_10px_30px_rgba(192,128,129,0.12)] md:p-6">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold md:text-2xl">{copy.latestEvents}</h2>

          {latestEvents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-orange-300 bg-white p-4 text-sm text-[color:var(--muted)]">
              {copy.latestEventsEmpty}
            </p>
          ) : (
            <div className="flex w-full flex-col gap-3">
              {latestEvents.map((event) => (
                <Link
                  key={event.id}
                  href={`/${activeLang}/events/${event.id}`}
                  className="group block w-full rounded-2xl border border-orange-200 bg-white p-4 shadow-[0_8px_20px_rgba(75,1,80,0.08)] transition-all duration-300 hover:-translate-y-1.5 hover:border-orange-300 hover:bg-gray-50 hover:shadow-[0_16px_34px_rgba(75,1,80,0.22)]"
                >
                  {event.image ? (
                    <div className="mb-3 h-48 w-full overflow-hidden rounded-xl">
                      <img
                        src={event.image}
                        alt={event.title || "Event"}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                  <h3 className="text-base font-semibold md:text-lg">{event.title}</h3>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                    {copy.updatedOn}: {formatUpdatedAt(event.approved_at || event.updated_at, activeLang)}
                  </p>
                  {event.description ? (
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{event.description}</p>
                  ) : null}
                  <p className="mt-3 text-sm font-semibold text-[color:var(--accent)]">{copy.viewEvent}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold md:text-2xl">{copy.explore}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORY_KEYS.map((key) => (
            <Link
              key={key}
              href={`/${activeLang}/${key}`}
              className="rounded-2xl border border-orange-200 bg-white p-4 text-base font-semibold text-orange-900 shadow-[0_8px_18px_rgba(75,1,80,0.08)] transition-all duration-300 hover:-translate-y-1 hover:border-orange-300 hover:bg-gray-100 hover:shadow-[0_14px_28px_rgba(75,1,80,0.18)] md:p-5 md:text-lg"
            >
              {copy.nav[key]}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
