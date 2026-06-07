import Link from "next/link";
import EventDetailContent from "@/components/EventDetailContent";
import { getEventDetail } from "@/lib/api";
import {
  buildAbsoluteUrl,
  buildBreadcrumbJsonLd,
  buildEventJsonLd,
  buildSeoMetadata,
  buildWebPageJsonLd,
  pickPrimaryImage,
} from "@/lib/schemaMetadata";
import { getLangContent, normalizeLang } from "@/lib/site";

function getSiteUrl() {
  return String(process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
}

function JsonLdScript({ data, id }) {
  if (!data || !Object.keys(data).length) return null;
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

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

  return buildSeoMetadata({
    title: event.meta_title || event.title || "Event",
    description: event.meta_description || event.summary || event.description || "",
    canonicalPath: `/${activeLang}/events/${id}`,
    lang: activeLang,
    siteUrl: getSiteUrl(),
    image: pickPrimaryImage(event),
  });
}

export default async function EventDetailPage({ params }) {
  const { lang, id } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const event = await getEventDetail(id, activeLang);
  const canonicalPath = `/${activeLang}/events/${id}`;
  const canonicalUrl = buildAbsoluteUrl(canonicalPath, getSiteUrl());

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

  const webPageJsonLd = buildWebPageJsonLd({
    title: event.meta_title || event.title || "Event",
    description: event.meta_description || event.summary || event.description || "",
    canonicalUrl,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: copy?.siteTitle || "UBONCITY.COM", url: buildAbsoluteUrl(`/${activeLang}`, getSiteUrl()) },
    { name: "Events", url: buildAbsoluteUrl(`/${activeLang}`, getSiteUrl()) },
    { name: String(event?.title || "").trim(), url: canonicalUrl },
  ]);
  const eventJsonLd = buildEventJsonLd({ event, canonicalUrl });

  return (
    <>
      <JsonLdScript id="event-webpage-jsonld" data={webPageJsonLd} />
      <JsonLdScript id="event-breadcrumb-jsonld" data={breadcrumbJsonLd} />
      {(() => {
        if (!eventJsonLd) return null;
        return <JsonLdScript id="event-entity-jsonld" data={eventJsonLd} />;
      })()}
      <EventDetailContent event={event} activeLang={activeLang} />
    </>
  );
}
