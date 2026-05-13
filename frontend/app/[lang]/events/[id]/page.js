import Link from "next/link";
import EventDetailContent from "@/components/EventDetailContent";
import { getEventDetail } from "@/lib/api";
import { getLangContent, normalizeLang } from "@/lib/site";

export async function generateMetadata({ params }) {
  const { lang, id } = await params;
  const activeLang = normalizeLang(lang);
  const event = await getEventDetail(id, activeLang);

  if (!event) {
    return {
      title: "Event | UBONCITY.COM",
      description: "Ubon Ratchathani events",
    };
  }

  const title = String(event.meta_title || event.title || "Event").trim();
  const description = String(event.meta_description || event.description || "").replace(/\s+/g, " ").trim();

  return {
    title: `${title} | UBONCITY.COM`,
    description: description.slice(0, 160),
    alternates: {
      canonical: `/${activeLang}/events/${id}`,
    },
  };
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
        <Link href={`/${activeLang}`} className="inline-flex rounded-lg border border-orange-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100">
          {copy.backHome}
        </Link>
      </section>
    );
  }

  return <EventDetailContent event={event} activeLang={activeLang} />;
}
