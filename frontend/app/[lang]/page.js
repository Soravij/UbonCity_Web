import Link from "next/link";
import { CATEGORY_KEYS, getLangContent, normalizeLang } from "@/lib/site";
import { getEvents, getUbonWeather } from "@/lib/api";

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

function roundValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function getAqiTone(aqi) {
  const value = Number(aqi);
  if (!Number.isFinite(value)) {
    return {
      bg: "#f3f4f6",
      text: "#374151",
      border: "#d1d5db",
    };
  }

  if (value <= 50) {
    return { bg: "#dcfce7", text: "#166534", border: "#86efac" };
  }
  if (value <= 100) {
    return { bg: "#fef9c3", text: "#854d0e", border: "#fde047" };
  }
  if (value <= 150) {
    return { bg: "#ffedd5", text: "#9a3412", border: "#fdba74" };
  }
  if (value <= 200) {
    return { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" };
  }
  if (value <= 300) {
    return { bg: "#f3e8ff", text: "#6b21a8", border: "#d8b4fe" };
  }

  return { bg: "#ffe4e6", text: "#881337", border: "#fda4af" };
}

export default async function LangHome({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const [events, weather] = await Promise.all([getEvents(activeLang), getUbonWeather()]);
  const latestEvents = events.slice(0, 5);

  const weatherLabelKey = weather?.codeKey || "unknown";
  const weatherLabel = copy.weatherLabel?.[weatherLabelKey] || copy.weatherLabel?.unknown || "-";

  const airLabelKey = weather?.aqiKey || "unknown";
  const airLabel = copy.airQualityLabel?.[airLabelKey] || copy.airQualityLabel?.unknown || "-";

  const temperature = roundValue(weather?.temperature);
  const apparent = roundValue(weather?.apparent);
  const maxTemp = roundValue(weather?.max);
  const minTemp = roundValue(weather?.min);
  const wind = roundValue(weather?.wind);
  const aqi = roundValue(weather?.aqi);
  const aqiTone = getAqiTone(aqi);

  return (
    <section className="space-y-8 md:space-y-10">
      <div
        className="rounded-3xl border border-orange-200 p-6 shadow-[0_12px_30px_rgba(240,122,34,0.12)] min-h-[420px] md:min-h-[620px] md:p-10 flex flex-col justify-center"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(32,14,8,0.42), rgba(87,35,20,0.24)), url('/hero-uboncity.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-100 md:text-sm"
          style={{ textShadow: "0 0 8px rgba(255,245,220,0.95), 0 0 18px rgba(255,220,170,0.8), 0 4px 12px rgba(120,60,15,0.35)" }}
        >
          {copy.siteTitle}
        </p>
        <h1
          className="mt-3 max-w-3xl text-3xl font-black leading-tight tracking-tight text-[#fffdf3] md:text-5xl"
          style={{
            textShadow:
              "0 2px 0 rgba(84,31,11,0.95), 0 4px 0 rgba(84,31,11,0.78), 0 10px 22px rgba(0,0,0,0.65)",
            letterSpacing: "0.01em",
          }}
        >
          {copy.tagline}
        </h1>
        <p
          className="mt-4 max-w-2xl text-sm leading-7 text-orange-50/95 md:text-base"
          style={{ textShadow: "0 0 8px rgba(255,245,225,0.92), 0 0 16px rgba(255,220,170,0.75), 0 4px 12px rgba(120,60,15,0.32)" }}
        >
          {copy.intro}
        </p>
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

      <section className="rounded-3xl border border-orange-200 bg-white/75 p-4 shadow-[0_10px_30px_rgba(192,128,129,0.12)] md:p-6">
        <div className="space-y-3">
          <h2 className="text-xl font-semibold md:text-2xl">{copy.weatherTitle}</h2>

          {!weather ? (
            <p className="rounded-xl border border-dashed border-orange-300 bg-white p-4 text-sm text-[color:var(--muted)]">
              {copy.weatherUnavailable}
            </p>
          ) : (
            <div className="rounded-2xl border border-orange-200 bg-white p-4 shadow-[0_8px_20px_rgba(75,1,80,0.08)]">
              <p className="text-sm font-semibold text-[color:var(--accent)]">{weatherLabel}</p>
              <p className="mt-1 text-3xl font-bold">{temperature ?? "-"}°C</p>
              <div className="mt-3 grid gap-2 text-sm text-[color:var(--muted)] md:grid-cols-2">
                <p>
                  {copy.weatherFeel}: {apparent ?? "-"}°C
                </p>
                <p>
                  {copy.weatherRange}: {minTemp ?? "-"}°C - {maxTemp ?? "-"}°C
                </p>
                <p>
                  {copy.weatherWind}: {wind ?? "-"} km/h
                </p>
                <div className="flex items-center gap-2">
                  <span>{copy.weatherAir}:</span>
                  <span
                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                    style={{
                      backgroundColor: aqiTone.bg,
                      color: aqiTone.text,
                      borderColor: aqiTone.border,
                    }}
                  >
                    {aqi ?? "-"} · {airLabel}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

