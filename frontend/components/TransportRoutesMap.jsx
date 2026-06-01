"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const VEHICLE_TYPES = ["songthaew", "minibus", "bus", "van"];

const FALLBACK_COLORS = {
  songthaew: "#f97316",
  minibus: "#eab308",
  bus: "#2563eb",
  van: "#16a34a",
};

const DEFAULT_VEHICLE_IMAGES = {
  songthaew: "/transport-vehicles/songthaew.svg",
  minibus: "/transport-vehicles/minibus.svg",
  van: "/transport-vehicles/van.svg",
  bus: "/transport-vehicles/bus.svg",
};

const UBON_CENTER = { lat: 15.2447, lng: 104.8472 };

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePath(path) {
  if (!Array.isArray(path)) return [];
  return path
    .map((p) => ({ lat: toNumber(p?.lat), lng: toNumber(p?.lng) }))
    .filter((p) => p.lat !== null && p.lng !== null);
}

function hashString(input) {
  let h = 0;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function normalizeHexColor(input, fallback) {
  const value = String(input || "").trim();
  if (!value) return fallback;
  const withHash = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : fallback;
}

function normalizeVehicleType(input) {
  const value = String(input || "songthaew").trim().toLowerCase();
  if (VEHICLE_TYPES.includes(value)) return value;
  if (value === "mini_bus" || value === "mini-bus") return "minibus";
  return "songthaew";
}

function resolveVehicleImage(type, image) {
  const custom = String(image || "").trim();
  if (custom) return custom;
  return DEFAULT_VEHICLE_IMAGES[normalizeVehicleType(type)] || DEFAULT_VEHICLE_IMAGES.songthaew;
}

function offsetPath(path, meters) {
  if (!Array.isArray(path) || path.length < 2 || !meters) return path;

  const result = [];
  for (let i = 0; i < path.length; i += 1) {
    const prev = path[i - 1] || path[i];
    const next = path[i + 1] || path[i];
    const dx = Number(next.lng) - Number(prev.lng);
    const dy = Number(next.lat) - Number(prev.lat);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    const lat = Number(path[i].lat);
    const latRad = (lat * Math.PI) / 180;
    const latMeters = 111320;
    const lngMeters = Math.max(1, 111320 * Math.cos(latRad));

    const offLat = (ny * meters) / latMeters;
    const offLng = (nx * meters) / lngMeters;
    result.push({ lat: lat + offLat, lng: Number(path[i].lng) + offLng });
  }

  return result;
}

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadGoogleMapsScript(apiKey) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Window is not available"));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  const scriptId = "google-maps-js-api";
  const existing = document.getElementById(scriptId);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(window.google?.maps), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps script")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.onload = () => resolve(window.google?.maps);
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });
}

export default function TransportRoutesMap({ routes = [], mapsApiKey = "", labels }) {
  const shellRef = useRef(null);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const infoWindowRef = useRef(null);
  const overlaysRef = useRef([]);

  const [mapError, setMapError] = useState("");
  const [ready, setReady] = useState(false);
  const [activeRouteId, setActiveRouteId] = useState(null);
  const [visibleRouteIds, setVisibleRouteIds] = useState(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);

  const normalizedRoutes = useMemo(
    () =>
      routes.map((route) => {
        const routeId = Number(route?.id || 0);
        const vehicleType = normalizeVehicleType(route?.vehicle_type || route?.route_type);
        const routeName = String(route?.route_name || route?.name || `Route #${routeId}`).trim();
        const routeNumber = String(route?.route_number || route?.route_code || "").trim();
        const path = normalizePath(route?.path);
        const routeKey = `${routeNumber}-${routeName}-${routeId}`;
        const slot = (hashString(routeKey) % 5) - 2;

        return {
          ...route,
          id: routeId,
          route_name: routeName,
          route_number: routeNumber,
          vehicle_type: vehicleType,
          vehicle_image: resolveVehicleImage(vehicleType, route?.vehicle_image),
          path,
          displayPath: offsetPath(path, slot * 8),
          color: normalizeHexColor(route?.color, FALLBACK_COLORS[vehicleType] || "#f97316"),
        };
      }),
    [routes]
  );

  useEffect(() => {
    setVisibleRouteIds(new Set(normalizedRoutes.map((route) => Number(route.id))));
  }, [normalizedRoutes]);

  useEffect(() => {
    let cancelled = false;

    if (!mapsApiKey) {
      setMapError(labels.noApiKey);
      return undefined;
    }

    loadGoogleMapsScript(mapsApiKey)
      .then(() => {
        if (cancelled || !mapRef.current || mapInstanceRef.current) return;

        mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
          center: UBON_CENTER,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });

        infoWindowRef.current = new window.google.maps.InfoWindow();
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setMapError(err.message || labels.loadFailed);
      });

    return () => {
      cancelled = true;
    };
  }, [labels.loadFailed, labels.noApiKey, mapsApiKey]);

  useEffect(() => {
    if (!ready || !mapInstanceRef.current || !window.google?.maps) return;

    for (const overlay of overlaysRef.current) {
      overlay.setMap(null);
    }
    overlaysRef.current = [];

    const bounds = new window.google.maps.LatLngBounds();
    let hasAnyLine = false;

    for (let idx = 0; idx < normalizedRoutes.length; idx += 1) {
      const route = normalizedRoutes[idx];
      if (!visibleRouteIds.has(Number(route.id))) continue;

      const path = route.displayPath || [];
      if (path.length < 2) continue;

      const routeId = Number(route.id || 0);
      const isActive = activeRouteId && routeId === Number(activeRouteId);
      const dimmed = Boolean(activeRouteId) && !isActive;

      if (isActive) {
        const glow = new window.google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: "#111827",
          strokeOpacity: 0.24,
          strokeWeight: 11,
          zIndex: 900,
          map: mapInstanceRef.current,
        });
        overlaysRef.current.push(glow);
      }

      const polyline = new window.google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: route.color,
        strokeOpacity: isActive ? 0.98 : dimmed ? 0.18 : 0.82,
        strokeWeight: isActive ? 7 : dimmed ? 2.5 : 4,
        zIndex: isActive ? 999 : 100 + idx,
        map: mapInstanceRef.current,
      });

      polyline.addListener("click", (event) => {
        setActiveRouteId((prev) => (Number(prev) === routeId ? null : routeId));
        if (!infoWindowRef.current) return;

        const routeName = escapeHtml(route?.route_name || `Route #${route?.id || "-"}`);
        const routeNumber = escapeHtml(route?.route_number || "-");
        const distance = Number(route?.distance_km);
        const distanceText = Number.isFinite(distance) ? `${distance.toFixed(2)} ${labels.km}` : "-";
        const stopCount = Number(route?.stop_count || (Array.isArray(route?.stops) ? route.stops.length : 0));
        const type = normalizeVehicleType(route?.vehicle_type);

        infoWindowRef.current.setContent(
          `<div style="min-width:220px;line-height:1.45">
            <div style="font-weight:700;margin-bottom:4px">${routeName}</div>
            <div>${labels.routeNumber}: ${routeNumber}</div>
            <div>${labels.vehicleType}: ${escapeHtml(labels.typeLabel[type] || type)}</div>
            <div>${labels.distance}: ${distanceText}</div>
            <div>${labels.stops}: ${stopCount}</div>
          </div>`
        );
        infoWindowRef.current.setPosition(event?.latLng || path[0]);
        infoWindowRef.current.open({ map: mapInstanceRef.current });
      });

      overlaysRef.current.push(polyline);
      for (const point of path) bounds.extend(point);
      hasAnyLine = true;
    }

    if (hasAnyLine) {
      mapInstanceRef.current.fitBounds(bounds, 60);
    } else {
      mapInstanceRef.current.setCenter(UBON_CENTER);
      mapInstanceRef.current.setZoom(12);
    }
  }, [activeRouteId, labels.distance, labels.km, labels.routeNumber, labels.stops, labels.typeLabel, labels.vehicleType, normalizedRoutes, ready, visibleRouteIds]);

  const resetFilters = () => {
    setActiveRouteId(null);
    setVisibleRouteIds(new Set(normalizedRoutes.map((route) => Number(route.id))));
    if (infoWindowRef.current) infoWindowRef.current.close();
  };

  const toggleRouteVisibility = (routeId) => {
    setVisibleRouteIds((prev) => {
      const next = new Set(prev);
      const id = Number(routeId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFullscreen = async () => {
    const target = shellRef.current;
    if (!target) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (target.requestFullscreen) {
        await target.requestFullscreen();
      }
    } catch {
      // no-op
    }
  };

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement && document.fullscreenElement === shellRef.current));
    };
    document.addEventListener("fullscreenchange", onChange);
    onChange();
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <section
      ref={shellRef}
      className={`grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] ${isFullscreen ? "transport-map-shell-fullscreen" : ""}`}
    >
      <aside className="transport-route-panel rounded-2xl border border-orange-200 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="transport-route-panel-title text-sm font-bold uppercase tracking-[0.12em]">{labels.routeListTitle}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFullscreen}
              className="transport-route-primary-btn rounded-lg px-3 py-1.5 text-xs font-bold transition"
            >
              {isFullscreen ? labels.exitFullscreen : labels.fullscreen}
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="transport-route-secondary-btn rounded-lg px-2.5 py-1 text-xs font-semibold transition"
            >
              {labels.showAll}
            </button>
          </div>
        </div>

        <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
          {normalizedRoutes.map((route) => {
            const isActive = Number(activeRouteId) === Number(route.id);
            const checked = visibleRouteIds.has(Number(route.id));
            return (
              <article
                key={route.id}
                className={`transport-route-card rounded-xl border p-1 transition ${isActive ? "is-active border-orange-300 bg-orange-50" : "border-orange-200 bg-white"}`}
              >
                <div className="grid grid-cols-[1fr_88px] items-stretch gap-2">
                  <div className="min-w-0">
                    <div className="mb-0.5 flex items-start justify-between gap-1">
                      <p className="truncate text-[9px] font-semibold leading-tight text-[color:var(--muted)]">{labels.routeNumber}: {route.route_number || "-"}</p>
                      <span className="transport-route-dot mt-[2px] inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: route.color }} />
                    </div>
                    <p className="transport-route-name truncate text-[10px] font-semibold leading-tight">{route.route_name || `Route #${route.id}`}</p>
                    <p className="truncate text-[9px] leading-tight text-[color:var(--muted)]">{labels.vehicleType}: {labels.typeLabel[route.vehicle_type] || route.vehicle_type}</p>
                    <label className="mt-0.5 inline-flex items-center gap-1 text-[10px] leading-tight text-[color:var(--muted)]">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRouteVisibility(route.id)}
                      />
                      แสดงเส้นทางนี้
                    </label>
                  </div>

                  <div className="transport-route-thumb overflow-hidden rounded-md border border-orange-100">
                    <img src={route.vehicle_image} alt={route.route_name || "vehicle"} className="h-full min-h-[56px] w-full object-contain" loading="lazy" />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </aside>

      {mapError ? (
        <p className="rounded-xl border border-dashed border-orange-300 bg-white p-5 text-sm text-[color:var(--muted)]">{mapError}</p>
      ) : (
        <div className="transport-route-map-shell overflow-hidden rounded-2xl border border-orange-200">
          <div ref={mapRef} className={`w-full ${isFullscreen ? "transport-map-fullscreen-canvas" : "h-[72vh] min-h-[500px]"}`} />
        </div>
      )}
    </section>
  );
}

