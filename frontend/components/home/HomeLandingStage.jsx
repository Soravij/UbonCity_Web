import DecisionSearchBar from "@/components/DecisionSearchBar";
import HomeFeaturedStrip from "./HomeFeaturedStrip";

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

export default function HomeLandingStage({
  activeLang,
  copy,
  decisionCopy,
  weather,
  quickActions,
  featuredStripPlaces,
}) {
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
    <section className="home-landing-stage">
      <div className="home-landing-body">
        <div className="home-landing-mid">
          <div className="home-landing-left">
            <div className="home-landing-headline-group">
              <p className="hero-banner-eyebrow editorial-kicker">{copy.siteTitle}</p>
              <h1 className="hero-banner-title editorial-title max-w-4xl">{decisionCopy.heroHeading}</h1>
              <p className="hero-banner-copy editorial-subtitle max-w-2xl">{decisionCopy.heroHint}</p>
            </div>

            <div className="home-landing-search-panel rounded-[24px] p-5 md:p-6">
              <DecisionSearchBar
                lang={activeLang}
                placeholder={decisionCopy.searchPlaceholder}
                submitLabel={decisionCopy.searchLabel}
                quickActions={quickActions}
              />
            </div>
          </div>

          <div className="home-landing-right">
            <div className="home-landing-info-card">
              <p className="home-landing-info-card-label">
                {decisionCopy.temperatureBlock}
              </p>
              <p className="home-landing-info-card-value">
                {temperature ?? "-"}{"\u00B0"}C
              </p>
              <p className="home-landing-info-card-caption">
                {copy.weatherFeel}: {apparent ?? "-"}{"\u00B0"}C
              </p>
            </div>
            <div className="home-landing-info-card">
              <p className="home-landing-info-card-label">
                {decisionCopy.conditionBlock}
              </p>
              <p className="home-landing-info-card-value">{weatherLabel}</p>
              <p className="home-landing-info-card-caption">
                {copy.weatherRange}: {minTemp ?? "-"}{"\u00B0"}C - {maxTemp ?? "-"}{"\u00B0"}C
              </p>
            </div>
            <div className="home-landing-info-card">
              <p className="home-landing-info-card-label">
                {decisionCopy.aqiBlock}
              </p>
              <div className="home-landing-info-card-value-wrap">
                <span className={`aqi-pill ${aqiToneClass}`}>
                  {aqi ?? "-"} {"\u00B7"} {airLabel}
                </span>
              </div>
              <p className="home-landing-info-card-caption">{copy.weatherWind}: {wind ?? "-"} km/h</p>
            </div>
          </div>
        </div>

        <div className="home-landing-bottom">
          <HomeFeaturedStrip places={featuredStripPlaces} activeLang={activeLang} />
        </div>
      </div>
    </section>
  );
}
