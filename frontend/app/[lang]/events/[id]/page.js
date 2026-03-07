import Link from "next/link";
import { getEventDetail } from "@/lib/api";
import { getLangContent, normalizeLang } from "@/lib/site";

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
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function EventDetailPage({ params }) {
  const { lang, id } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const event = await getEventDetail(id, activeLang);

  if (!event) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight md:text-4xl">{copy.eventNotFound}</h1>
        <Link
          href={`/${activeLang}`}
          className="inline-flex rounded-lg border border-orange-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100"
        >
          {copy.backHome}
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-[color:var(--muted)]">
        {copy.updatedOn}: {formatUpdatedAt(event.approved_at || event.updated_at, activeLang)}
      </p>
      <h1 className="text-2xl font-bold tracking-tight md:text-4xl">{event.title}</h1>

      {event.image ? (
        <img
          src={event.image}
          alt={event.title || "Event"}
          className="mx-auto block h-auto w-full rounded-xl bg-[#fffaf2] object-contain p-1 shadow-[0_0_22px_rgba(226,168,109,0.18)]"
          style={{ width: "min(40vw, 100%)" }}
        />
      ) : null}

      {event.description ? (
        <article className="whitespace-pre-line text-[15px] leading-7 text-slate-700 md:text-base">
          {event.description}
        </article>
      ) : null}

      <div>
        <Link
          href={`/${activeLang}`}
          className="inline-flex rounded-lg border border-orange-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100"
        >
          {copy.backHome}
        </Link>
      </div>
    </section>
  );
}

