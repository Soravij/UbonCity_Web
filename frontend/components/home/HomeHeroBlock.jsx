import DecisionSearchBar from "@/components/DecisionSearchBar";

function roundValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function getAqiToneClass(aqi) {
  const value = Number(aqi);
  if (!Number.isFinite(value)) return "aqi-unknown";
  if (value <= 50) return "aqi-good";
  if (value <= 100) return "aqi-moderate";
  if (value <= 150) return "aqi-sensitive";
  if (value <= 200) return "aqi-unhealthy";
  if (value <= 300) return "aqi-very-unhealthy";
  return "aqi-hazardous";
}

export default function HomeHeroBlock({ activeLang, copy, decisionCopy, weather, quickActions }) {
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
  const aqiToneClass = getAqiToneClass(aqi);

  return (
    <div
      className="editorial-section home-hero hero-banner p-8 min-h-[600px] md:min-h-[760px] md:p-16"
      style={{
        backgroundImage:
          "linear-gradient(180deg, rgba(11, 17, 25, 0.46) 0%, rgba(11, 17, 25, 0.12) 56%, rgba(11, 17, 25, 0.4) 100%), var(--home-hero-bg-image)",
        backgroundSize: "cover",
        backgroundPosition: "center center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="home-hero-content flex h-full flex-col justify-between gap-10">
        <div className="max-w-4xl space-y-5 pt-4 md:pt-10">
          <p className="hero-banner-eyebrow editorial-kicker">{copy.siteTitle}</p>
          <h1 className="hero-banner-title editorial-title max-w-4xl">{decisionCopy.heroHeading}</h1>
          <p className="hero-banner-copy editorial-subtitle max-w-2xl">{decisionCopy.heroHint}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)] lg:items-end">
          <div className="editorial-panel rounded-[20px] p-4 md:p-5">
            <DecisionSearchBar
              lang={activeLang}
              placeholder={decisionCopy.searchPlaceholder}
              submitLabel={decisionCopy.searchLabel}
              quickActions={quickActions}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="home-hero-stat rounded-[12px] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/72">{decisionCopy.temperatureBlock}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{temperature ?? "-"}{"\u00B0"}C</p>
              <p className="mt-1 text-sm text-white/80">{copy.weatherFeel}: {apparent ?? "-"}{"\u00B0"}C</p>
            </div>
            <div className="home-hero-stat rounded-[12px] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/72">{decisionCopy.conditionBlock}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{weatherLabel}</p>
              <p className="mt-1 text-sm text-white/80">{copy.weatherRange}: {minTemp ?? "-"}{"\u00B0"}C - {maxTemp ?? "-"}{"\u00B0"}C</p>
            </div>
            <div className="home-hero-stat rounded-[12px] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/72">{decisionCopy.aqiBlock}</p>
              <div className="mt-2">
                <span className={`aqi-pill ${aqiToneClass}`}>{aqi ?? "-"} {"\u00B7"} {airLabel}</span>
              </div>
              <p className="mt-1 text-sm text-white/80">{copy.weatherWind}: {wind ?? "-"} km/h</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
