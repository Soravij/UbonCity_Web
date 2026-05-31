function weatherCodeToKey(code) {
  const n = Number(code);
  if (n === 0) return "clear";
  if ([1, 2, 3].includes(n)) return "cloudy";
  if ([45, 48].includes(n)) return "fog";
  if ([51, 53, 55, 56, 57].includes(n)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(n)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(n)) return "snow";
  if ([95, 96, 99].includes(n)) return "storm";
  return "unknown";
}

function aqiLevelKey(aqiValue) {
  const aqi = Number(aqiValue);
  if (!Number.isFinite(aqi)) return "unknown";
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "sensitive";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very_unhealthy";
  return "hazardous";
}

const DEFAULT_API_TIMEOUT_MS = 2500;
const DEFAULT_WEATHER_TIMEOUT_MS = 3500;

async function fetchJsonWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...fetchOptions } = options;
  const signal = fetchOptions.signal || AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { ...fetchOptions, signal });
  if (!res.ok) return null;
  return res.json();
}

function getApiUrl() {
  const raw = String(process.env.NEXT_PUBLIC_API_URL || "").trim();
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  const hostname =
    typeof window !== "undefined" ? String(window.location.hostname || "").trim().toLowerCase() : "";

  if (raw && !raw.includes("your-backend-domain")) {
    return raw;
  }

  if (env === "production") {
    // Prefer reverse-proxy routing in production when env is missing.
    return "/api";
  }

  if (hostname) {
    return `http://${hostname}:5000/api`;
  }

  // Server-side development requests do not have window.location. Default to the local backend.
  return "http://127.0.0.1:5000/api";
}

export async function postAnalyticsEvent(payload = {}) {
  const apiUrl = getApiUrl();
  const body = {
    event_type: payload?.event_type,
    source_path: payload?.source_path,
    entity_type: payload?.entity_type || null,
    entity_id: payload?.entity_id || null,
    referrer_path: payload?.referrer_path || null,
    metadata_json: payload?.metadata_json && typeof payload.metadata_json === "object" ? payload.metadata_json : null,
  };

  try {
    const res = await fetch(`${apiUrl}/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getPlaces(category, lang) {
  const apiUrl = getApiUrl();

  try {
    const data = await fetchJsonWithTimeout(
      `${apiUrl}/places?category=${encodeURIComponent(category)}&lang=${encodeURIComponent(lang)}`,
      { cache: "no-store" }
    );
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function getPlaceDetail(category, slug, lang) {
  const apiUrl = getApiUrl();

  try {
    const data = await fetchJsonWithTimeout(
      `${apiUrl}/places/${encodeURIComponent(category)}/${encodeURIComponent(slug)}?lang=${encodeURIComponent(lang)}`,
      { cache: "no-store" }
    );
    return data?.item || null;
  } catch {
    return null;
  }
}

export async function getNearbyPlaces(category, slug, lang, limit = 4) {
  const apiUrl = getApiUrl();

  try {
    const data = await fetchJsonWithTimeout(
      `${apiUrl}/places/${encodeURIComponent(category)}/${encodeURIComponent(slug)}/nearby?lang=${encodeURIComponent(lang)}&limit=${encodeURIComponent(limit)}`,
      { cache: "no-store" }
    );
    if (!data) {
      return { items: [], rangeKey: "none" };
    }
    return {
      items: Array.isArray(data.items) ? data.items : [],
      rangeKey: String(data?.range_key || "none"),
    };
  } catch {
    return { items: [], rangeKey: "none" };
  }
}

export async function getEvents(lang = "th") {
  const apiUrl = getApiUrl();

  try {
    const data = await fetchJsonWithTimeout(`${apiUrl}/events?lang=${encodeURIComponent(lang)}`, {
      cache: "no-store",
    });
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function getHomepageLayout(lang = "th", layoutKey = "home") {
  const apiUrl = getApiUrl();

  try {
    const data = await fetchJsonWithTimeout(
      `${apiUrl}/homepage-layout?layout_key=${encodeURIComponent(layoutKey)}&lang=${encodeURIComponent(lang)}`,
      { cache: "no-store" }
    );
    return data?.item || null;
  } catch {
    return null;
  }
}

export async function getEventDetail(id, lang = "th") {
  const apiUrl = getApiUrl();

  try {
    const data = await fetchJsonWithTimeout(`${apiUrl}/events/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`, {
      cache: "no-store",
    });
    return data?.item || null;
  } catch {
    return null;
  }
}

export async function getReviewContentDetail(reviewId, token) {
  const apiUrl = getApiUrl();
  const id = Number(reviewId || 0);
  const authToken = String(token || "").trim();
  if (!id || !authToken) return null;

  try {
    const data = await fetchJsonWithTimeout(`${apiUrl}/review-content/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    return data?.item || null;
  } catch {
    return null;
  }
}

export async function getTransportRoutes(options = {}) {
  const apiUrl = getApiUrl();
  const includePath = options?.includePath ? "1" : "0";
  const includeStops = options?.includeStops ? "1" : "0";

  try {
    const data = await fetchJsonWithTimeout(
      `${apiUrl}/transport-routes?include_path=${includePath}&include_stops=${includeStops}`,
      { cache: "no-store" }
    );
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

export async function getTransportMapsConfig() {
  const apiUrl = getApiUrl();

  try {
    const data = await fetchJsonWithTimeout(`${apiUrl}/transport/config`, { cache: "no-store" });
    if (!data) return { mapsApiKey: "" };
    return { mapsApiKey: String(data?.mapsApiKey || "") };
  } catch {
    return { mapsApiKey: "" };
  }
}

export async function getUbonWeather() {
  const lat = 15.2447;
  const lon = 104.8472;

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FBangkok&forecast_days=1`;
  const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=Asia%2FBangkok`;

  try {
    const [weatherData, airData] = await Promise.all([
      fetchJsonWithTimeout(weatherUrl, { cache: "no-store", timeoutMs: DEFAULT_WEATHER_TIMEOUT_MS }),
      fetchJsonWithTimeout(airUrl, { cache: "no-store", timeoutMs: DEFAULT_WEATHER_TIMEOUT_MS }),
    ]);

    if (!weatherData) return null;
    const current = weatherData?.current || {};
    const daily = weatherData?.daily || {};

    let aqiValue = NaN;
    if (airData) {
      aqiValue = Number(airData?.current?.us_aqi);
    }

    return {
      temperature: Number(current?.temperature_2m),
      apparent: Number(current?.apparent_temperature),
      wind: Number(current?.wind_speed_10m),
      max: Number(Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max[0] : NaN),
      min: Number(Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min[0] : NaN),
      codeKey: weatherCodeToKey(current?.weather_code),
      aqi: Number.isFinite(aqiValue) ? aqiValue : null,
      aqiKey: aqiLevelKey(aqiValue),
    };
  } catch {
    return null;
  }
}

