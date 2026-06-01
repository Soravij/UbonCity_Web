import fs from "node:fs/promises";
import path from "node:path";

const BOUNDS = {
  min_lat: 15.1083,
  min_lng: 104.8068,
  max_lat: 15.3117,
  max_lng: 104.9720,
};

const VIEWBOX = {
  x: 0,
  y: 0,
  width: 4000,
  height: 5600,
};

const INPUT_PATH = path.resolve("collector", "tmp", "ubon-city-base-map-v1-overpass.json");
const AREA_INPUT_PATH = path.resolve("collector", "tmp", "ubon-city-base-map-v1-areas.json");
const OUTPUT_DIR = path.resolve("collector", "media", "generated", "transport-v2", "base-maps");
const OUTPUT_BASENAME = "ubon-city-base-map-v1-r1";

const ROAD_GROUPS = [
  {
    id: "roads-motorway",
    highway: new Set(["motorway", "motorway_link", "trunk", "trunk_link"]),
    casing: { stroke: "#cdb385", width: 18, opacity: 0.92 },
    stroke: { stroke: "#f4e3bb", width: 11.5, opacity: 0.98 },
    simplifyTolerance: 1.2,
  },
  {
    id: "roads-primary",
    highway: new Set(["primary", "primary_link"]),
    casing: { stroke: "#ceb181", width: 14, opacity: 0.9 },
    stroke: { stroke: "#f2dfb3", width: 9, opacity: 0.96 },
    simplifyTolerance: 1.6,
  },
  {
    id: "roads-secondary",
    highway: new Set(["secondary", "secondary_link"]),
    casing: { stroke: "#d8c4a0", width: 11, opacity: 0.86 },
    stroke: { stroke: "#f6e7c5", width: 7, opacity: 0.92 },
    simplifyTolerance: 2.1,
  },
  {
    id: "roads-tertiary",
    highway: new Set(["tertiary", "tertiary_link"]),
    casing: { stroke: "#dfd2bc", width: 11, opacity: 0.78 },
    stroke: { stroke: "#fbf1dd", width: 7, opacity: 0.87 },
    simplifyTolerance: 2.8,
  },
  {
    id: "roads-local",
    highway: new Set(["unclassified", "residential", "living_street", "road"]),
    casing: { stroke: "#cfc6b8", width: 6, opacity: 0.62 },
    stroke: { stroke: "#f3eee4", width: 3.2, opacity: 0.9 },
    simplifyTolerance: 3.8,
  },
  {
    id: "roads-service",
    highway: new Set(["service"]),
    casing: { stroke: "#ddd5c8", width: 4, opacity: 0.42 },
    stroke: { stroke: "#f7f2e9", width: 2.2, opacity: 0.68 },
    simplifyTolerance: 4.5,
  },
];

const DRAW_ORDER = [
  "roads-service",
  "roads-local",
  "roads-tertiary",
  "roads-secondary",
  "roads-primary",
  "roads-motorway",
];

const AREA_STYLES = {
  water: { fill: "#b9dbe8", opacity: 0.9 },
  green: { fill: "#d7e5c8", opacity: 0.78 },
  military: { fill: "#e6ddd2", opacity: 0.72 },
  aeroway: { fill: "#ddd5ca", opacity: 0.8 },
  education: { fill: "#dbe7cf", opacity: 0.72 },
  health: { fill: "#ead6d2", opacity: 0.74 },
};

const RAIL_STYLE = {
  casing: { stroke: "#b8aea1", width: 2.6, opacity: 0.75 },
  stroke: { stroke: "#f3efe7", width: 1.2, opacity: 0.9, dasharray: "10 6" },
};

const AREA_FILTERS = {
  water: {
    minPolygonArea: 1800,
    minWidth: 26,
    minHeight: 26,
  },
  green: {
    minPolygonArea: 2200,
    minWidth: 34,
    minHeight: 34,
  },
};

const OVERVIEW_PROFILE = {
  id: "overview-road-hierarchy-r2",
  includeService: true,
  localGridSize: 220,
  localMaxPerCell: 4,
  localMinLength: 0,
  localNamedMinLength: 0,
  tertiaryMinLength: 0,
  serviceMinLength: 0,
  preserveZones: [
    {
      id: "old-town-core-north",
      min_lat: 15.22349,
      min_lng: 104.84459,
      max_lat: 15.24717,
      max_lng: 104.87845,
      localGridSize: 110,
      localMaxPerCell: 9,
      localMinLength: 0,
      localNamedMinLength: 0,
    },
    {
      id: "old-town-core-south",
      min_lat: 15.18133,
      min_lng: 104.84824,
      max_lat: 15.20697,
      max_lng: 104.86918,
      localGridSize: 110,
      localMaxPerCell: 9,
      localMinLength: 0,
      localNamedMinLength: 0,
    },
  ],
};

const INCLUDED_HIGHWAYS = new Set(
  ROAD_GROUPS.flatMap((group) => Array.from(group.highway))
);

function projectPoint(lat, lng) {
  const xRatio = (lng - BOUNDS.min_lng) / (BOUNDS.max_lng - BOUNDS.min_lng || 1);
  const yRatio = 1 - (lat - BOUNDS.min_lat) / (BOUNDS.max_lat - BOUNDS.min_lat || 1);
  return {
    x: VIEWBOX.x + xRatio * VIEWBOX.width,
    y: VIEWBOX.y + yRatio * VIEWBOX.height,
  };
}

function round(value) {
  return Number(value).toFixed(2);
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function distance(a, b) {
  const dx = Number(a.x || 0) - Number(b.x || 0);
  const dy = Number(a.y || 0) - Number(b.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function polylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

function perpendicularDistance(point, start, end) {
  const lineLength = distance(start, end);
  if (!lineLength) return distance(point, start);
  const area = Math.abs(
    (start.x * end.y) + (end.x * point.y) + (point.x * start.y)
    - (start.y * end.x) - (end.y * point.x) - (point.y * start.x)
  );
  return area / lineLength;
}

function simplifyPoints(points, tolerance) {
  if (!Array.isArray(points) || points.length <= 2) return Array.isArray(points) ? points : [];

  const recurse = (segment) => {
    if (segment.length <= 2) return segment;
    const start = segment[0];
    const end = segment[segment.length - 1];
    let maxDistance = 0;
    let splitIndex = -1;
    for (let index = 1; index < segment.length - 1; index += 1) {
      const nextDistance = perpendicularDistance(segment[index], start, end);
      if (nextDistance > maxDistance) {
        maxDistance = nextDistance;
        splitIndex = index;
      }
    }
    if (maxDistance <= tolerance || splitIndex < 0) {
      return [start, end];
    }
    const left = recurse(segment.slice(0, splitIndex + 1));
    const right = recurse(segment.slice(splitIndex));
    return [...left.slice(0, -1), ...right];
  };

  return recurse(points);
}

function toPath(points) {
  if (!Array.isArray(points) || points.length < 2) return "";
  return points.map((point, index) => (
    `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`
  )).join(" ");
}

function toPolygonPath(points) {
  if (!Array.isArray(points) || points.length < 3) return "";
  const path = toPath(points);
  if (!path) return "";
  return `${path} Z`;
}

function polygonBounds(points) {
  if (!Array.isArray(points) || !points.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const x = Number(point.x || 0);
    const y = Number(point.y || 0);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    area += (Number(current.x || 0) * Number(next.y || 0)) - (Number(next.x || 0) * Number(current.y || 0));
  }
  return Math.abs(area) / 2;
}

function shouldKeepArea(category, points) {
  const filter = AREA_FILTERS[category];
  if (!filter) return true;
  const bounds = polygonBounds(points);
  const area = polygonArea(points);
  if (filter.minPolygonArea && area < filter.minPolygonArea) return false;
  if (filter.minWidth && bounds.width < filter.minWidth) return false;
  if (filter.minHeight && bounds.height < filter.minHeight) return false;
  return true;
}

function centroid(points) {
  if (!Array.isArray(points) || !points.length) return { x: 0, y: 0 };
  const sum = points.reduce((accumulator, point) => ({
    x: accumulator.x + Number(point.x || 0),
    y: accumulator.y + Number(point.y || 0),
  }), { x: 0, y: 0 });
  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

function gridKeyForPoint(point, cellSize) {
  const col = Math.floor((Number(point.x || 0) - VIEWBOX.x) / cellSize);
  const row = Math.floor((Number(point.y || 0) - VIEWBOX.y) / cellSize);
  return `${col}:${row}`;
}

function pointInBounds(point, bounds) {
  return (
    Number(point?.lat) >= Number(bounds?.min_lat)
    && Number(point?.lat) <= Number(bounds?.max_lat)
    && Number(point?.lng) >= Number(bounds?.min_lng)
    && Number(point?.lng) <= Number(bounds?.max_lng)
  );
}

function zoneForWay(way, profile) {
  const zones = Array.isArray(profile?.preserveZones) ? profile.preserveZones : [];
  return zones.find((zone) => pointInBounds(way.geoCentroid, zone)) || null;
}

function classifyArea(tags) {
  const amenity = String(tags?.amenity || "").trim().toLowerCase();
  const landuse = String(tags?.landuse || "").trim().toLowerCase();
  const military = String(tags?.military || "").trim().toLowerCase();
  const aeroway = String(tags?.aeroway || "").trim().toLowerCase();
  const natural = String(tags?.natural || "").trim().toLowerCase();
  const water = String(tags?.water || "").trim().toLowerCase();

  if (natural === "water" || water === "river" || water === "lake" || water === "reservoir" || String(tags?.waterway || "").trim().toLowerCase() === "riverbank") {
    return "water";
  }
  if (landuse === "grass" || landuse === "forest" || landuse === "recreation_ground" || String(tags?.leisure || "").trim().toLowerCase() === "park" || natural === "wood") {
    return "green";
  }
  if (landuse === "military" || military) return "military";
  if (aeroway) return "aeroway";
  if (amenity === "school" || amenity === "university" || amenity === "college") return "education";
  if (amenity === "hospital" || amenity === "clinic") return "health";
  return "";
}

function shouldKeepRailway(element) {
  const railway = String(element?.tags?.railway || "").trim().toLowerCase();
  return ["rail", "light_rail", "tram", "narrow_gauge"].includes(railway);
}

function normalizeRailElement(element) {
  if (element?.type !== "way" || !shouldKeepRailway(element)) return null;
  const points = (Array.isArray(element?.geometry) ? element.geometry : [])
    .map((point) => projectPoint(Number(point?.lat), Number(point?.lon)))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 2) return null;
  const simplified = simplifyPoints(points, 2.4);
  if (polylineLength(simplified) < 40) return null;
  return {
    id: `${element.type}-${element.id}`,
    path: toPath(simplified),
  };
}

function normalizeAreaRing(geometry) {
  const points = (Array.isArray(geometry) ? geometry : [])
    .map((point) => ({
      lat: Number(point?.lat),
      lng: Number(point?.lon),
      ...projectPoint(Number(point?.lat), Number(point?.lon)),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length < 3) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (distance(first, last) > 0.01) {
    points.push({ ...first });
  }
  return simplifyPoints(points, 2.2);
}

function normalizeAreaElement(element) {
  const category = classifyArea(element?.tags || {});
  if (!category) return [];

  if (element?.type === "way") {
    const ring = normalizeAreaRing(element?.geometry);
    if (ring.length < 4) return [];
    if (!shouldKeepArea(category, ring)) return [];
    return [{
      id: `${element.type}-${element.id}`,
      category,
      path: toPolygonPath(ring),
    }];
  }

  if (element?.type === "relation") {
    return (Array.isArray(element?.members) ? element.members : [])
      .filter((member) => String(member?.role || "").trim().toLowerCase() === "outer")
      .map((member, index) => {
        const ring = normalizeAreaRing(member?.geometry);
        if (ring.length < 4) return null;
        if (!shouldKeepArea(category, ring)) return null;
        return {
          id: `${element.type}-${element.id}-${index}`,
          category,
          path: toPolygonPath(ring),
        };
      })
      .filter(Boolean);
  }

  return [];
}

function collectAreaLayers(elements) {
  const normalized = (Array.isArray(elements) ? elements : [])
    .flatMap((element) => normalizeAreaElement(element));

  const layers = Object.keys(AREA_STYLES).map((category) => ({
    category,
    style: AREA_STYLES[category],
    shapes: normalized.filter((shape) => shape.category === category),
  }));

  return {
    layers,
    stats: Object.fromEntries(layers.map((layer) => [layer.category, layer.shapes.length])),
  };
}

function collectRailways(elements) {
  const rails = (Array.isArray(elements) ? elements : [])
    .map((element) => normalizeRailElement(element))
    .filter(Boolean);
  return {
    rails,
    stats: {
      railway: rails.length,
    },
  };
}

function scoreWay(way) {
  return (
    (way.named ? 100000 : 0)
    + Math.round(way.length * 10)
    + Math.min(way.points.length, 50) * 10
  );
}

function normalizeWay(way) {
  const highway = String(way?.tags?.highway || "").trim();
  if (!INCLUDED_HIGHWAYS.has(highway)) return null;

  const rawPoints = (Array.isArray(way?.geometry) ? way.geometry : [])
    .map((point) => projectPoint(Number(point.lat), Number(point.lon)))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (rawPoints.length < 2) return null;

  const name = String(way?.tags?.["name:en"] || way?.tags?.name || "").trim();
  const group = ROAD_GROUPS.find((entry) => entry.highway.has(highway));
  if (!group) return null;

  const simplifiedPoints = simplifyPoints(rawPoints, group.simplifyTolerance);
  const length = polylineLength(simplifiedPoints);
  if (length <= 0) return null;

  return {
    id: Number(way.id || 0),
    highway,
    groupId: group.id,
    name,
    named: Boolean(name),
    points: simplifiedPoints,
    length,
    centroid: centroid(simplifiedPoints),
    geoCentroid: {
      lat: Number((Array.isArray(way?.geometry) ? way.geometry : []).reduce((sum, point) => sum + Number(point?.lat || 0), 0) / rawPoints.length),
      lng: Number((Array.isArray(way?.geometry) ? way.geometry : []).reduce((sum, point) => sum + Number(point?.lon || 0), 0) / rawPoints.length),
    },
  };
}

function filterLocalWays(ways, profile) {
  if ((profile.localMinLength || 0) <= 0 && (profile.localNamedMinLength || 0) <= 0) {
    return Array.isArray(ways) ? ways : [];
  }
  const keep = [];
  const buckets = new Map();

  for (const way of ways) {
    const zone = zoneForWay(way, profile);
    const localNamedMinLength = zone?.localNamedMinLength ?? profile.localNamedMinLength;
    const localMinLength = zone?.localMinLength ?? profile.localMinLength;
    const localGridSize = zone?.localGridSize ?? profile.localGridSize;
    if (way.named && way.length >= localNamedMinLength) {
      keep.push(way);
      continue;
    }
    if (way.length < localMinLength) continue;
    const bucketKey = `${zone?.id || "general"}:${gridKeyForPoint(way.centroid, localGridSize)}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey).push(way);
  }

  for (const [bucketKey, bucketWays] of buckets.entries()) {
    const zoneId = String(bucketKey).split(":")[0];
    const zone = (Array.isArray(profile?.preserveZones) ? profile.preserveZones : []).find((item) => item.id === zoneId) || null;
    const localMaxPerCell = zone?.localMaxPerCell ?? profile.localMaxPerCell;
    bucketWays
      .sort((left, right) => scoreWay(right) - scoreWay(left))
      .slice(0, localMaxPerCell)
      .forEach((way) => keep.push(way));
  }

  return keep;
}

function collectGroupedPaths(elements, profile) {
  const normalizedWays = (Array.isArray(elements) ? elements : [])
    .filter((item) => item?.type === "way")
    .map(normalizeWay)
    .filter(Boolean);

  const filteredWays = [];
  for (const way of normalizedWays) {
    if (way.groupId === "roads-service" && !profile.includeService) continue;
    if (way.groupId === "roads-tertiary" && way.length < profile.tertiaryMinLength) continue;
    if (way.groupId === "roads-service" && way.length < profile.serviceMinLength) continue;
    filteredWays.push(way);
  }

  const localWays = filteredWays.filter((way) => way.groupId === "roads-local");
  const nonLocalWays = filteredWays.filter((way) => way.groupId !== "roads-local");
  const keptLocalWays = filterLocalWays(localWays, profile);
  const keptWayIds = new Set([...nonLocalWays, ...keptLocalWays].map((way) => way.id));
  const keptWays = filteredWays.filter((way) => keptWayIds.has(way.id));

  const grouped = ROAD_GROUPS.map((group) => ({
    ...group,
    ways: keptWays.filter((way) => group.id === way.groupId),
  }));

  return {
    grouped,
    stats: {
      total_input_ways: Array.isArray(elements) ? elements.length : 0,
      total_normalized_ways: normalizedWays.length,
      total_rendered_ways: keptWays.length,
      profile: profile.id,
      by_group: Object.fromEntries(grouped.map((group) => [group.id, group.ways.length])),
      dropped_local_ways: localWays.length - keptLocalWays.length,
      preserve_zones: (profile.preserveZones || []).map((zone) => ({
        id: zone.id,
        bounds: {
          min_lat: zone.min_lat,
          min_lng: zone.min_lng,
          max_lat: zone.max_lat,
          max_lng: zone.max_lng,
        },
      })),
    },
  };
}

function buildSvg(grouped, areaLayers, railways, stats, profile) {
  const generatedAt = new Date().toISOString();
  const metadata = {
    base_map_key: "ubon-city-base-map-v1",
    asset_revision: "r1",
    generated_at: generatedAt,
    source: "OpenStreetMap Overpass highways",
    visual_profile: profile.id,
    bounds: BOUNDS,
    viewbox: VIEWBOX,
    projection_type: "linear-bbox-fit",
    stats,
  };

  const orderedGroups = DRAW_ORDER
    .map((id) => grouped.find((group) => group.id === id))
    .filter(Boolean);

  const groupsMarkup = orderedGroups.map((group) => {
    const joinedPaths = group.ways.map((way) => toPath(way.points)).filter(Boolean).join(" ");
    if (!joinedPaths) return `  <g id="${group.id}" />`;
    return [
      `  <g id="${group.id}">`,
      `    <path d="${joinedPaths}" fill="none" stroke="${group.casing.stroke}" stroke-width="${group.casing.width}" stroke-opacity="${group.casing.opacity ?? 1}" stroke-linecap="round" stroke-linejoin="round" />`,
      `    <path d="${joinedPaths}" fill="none" stroke="${group.stroke.stroke}" stroke-width="${group.stroke.width}" stroke-opacity="${group.stroke.opacity ?? 1}" stroke-linecap="round" stroke-linejoin="round" />`,
      "  </g>",
    ].join("\n");
  }).join("\n");

  const areasMarkup = areaLayers.map((layer) => {
    const joinedPaths = layer.shapes.map((shape) => shape.path).filter(Boolean).join(" ");
    if (!joinedPaths) return `  <g id="areas-${layer.category}" />`;
    return [
      `  <g id="areas-${layer.category}">`,
      `    <path d="${joinedPaths}" fill="${layer.style.fill}" fill-opacity="${layer.style.opacity}" stroke="none" fill-rule="evenodd" />`,
      "  </g>",
    ].join("\n");
  }).join("\n");

  const railMarkup = railways.length
    ? [
      "  <g id=\"railway-network\">",
      `    <path d="${railways.map((rail) => rail.path).join(" ")}" fill="none" stroke="${RAIL_STYLE.casing.stroke}" stroke-width="${RAIL_STYLE.casing.width}" stroke-opacity="${RAIL_STYLE.casing.opacity}" stroke-linecap="round" stroke-linejoin="round" />`,
      `    <path d="${railways.map((rail) => rail.path).join(" ")}" fill="none" stroke="${RAIL_STYLE.stroke.stroke}" stroke-width="${RAIL_STYLE.stroke.width}" stroke-opacity="${RAIL_STYLE.stroke.opacity}" stroke-dasharray="${RAIL_STYLE.stroke.dasharray}" stroke-linecap="round" stroke-linejoin="round" />`,
      "  </g>",
    ].join("\n")
    : "  <g id=\"railway-network\" />";

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<!-- ${escapeXml(JSON.stringify(metadata))} -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.width} ${VIEWBOX.height}" role="img" aria-labelledby="title desc">`,
    "  <title id=\"title\">Ubon City Base Map V1</title>",
    "  <desc id=\"desc\">Road hierarchy base map generated from OpenStreetMap within the locked Ubon bbox.</desc>",
    "  <defs>",
    "    <style>",
      "      .map-bg { fill: #f6f1e7; }",
      "      .map-frame { fill: none; stroke: #d5ccbc; stroke-width: 10; }",
    "    </style>",
    "  </defs>",
    `  <rect class="map-bg" x="${VIEWBOX.x}" y="${VIEWBOX.y}" width="${VIEWBOX.width}" height="${VIEWBOX.height}" />`,
    "  <g id=\"area-layers\">",
    areasMarkup,
    "  </g>",
    railMarkup,
    "  <g id=\"road-network\">",
    groupsMarkup,
    "  </g>",
    `  <rect class="map-frame" x="${VIEWBOX.x}" y="${VIEWBOX.y}" width="${VIEWBOX.width}" height="${VIEWBOX.height}" />`,
    "</svg>",
    "",
  ].join("\n");
}

async function main() {
  const [rawRoads, rawAreas] = await Promise.all([
    fs.readFile(INPUT_PATH, "utf8"),
    fs.readFile(AREA_INPUT_PATH, "utf8"),
  ]);
  const overpass = JSON.parse(rawRoads);
  const areaOverpass = JSON.parse(rawAreas);
  const { grouped, stats } = collectGroupedPaths(overpass?.elements, OVERVIEW_PROFILE);
  const { layers: areaLayers, stats: areaStats } = collectAreaLayers(areaOverpass?.elements);
  const { rails, stats: railStats } = collectRailways(areaOverpass?.elements);
  stats.area_layers = areaStats;
  stats.linear_layers = railStats;
  const svg = buildSvg(grouped, areaLayers, rails, stats, OVERVIEW_PROFILE);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const svgPath = path.join(OUTPUT_DIR, `${OUTPUT_BASENAME}.svg`);
  const metaPath = path.join(OUTPUT_DIR, `${OUTPUT_BASENAME}.meta.json`);

  await fs.writeFile(svgPath, svg, "utf8");
  await fs.writeFile(metaPath, JSON.stringify({
    key: "ubon-city-base-map-v1",
    revision: "r1",
    source_file: path.relative(process.cwd(), INPUT_PATH),
    visual_profile: OVERVIEW_PROFILE.id,
    bounds: BOUNDS,
    viewbox: VIEWBOX,
    projection_type: "linear-bbox-fit",
    area_source_file: path.relative(process.cwd(), AREA_INPUT_PATH),
    stats,
  }, null, 2), "utf8");

  process.stdout.write(JSON.stringify({
    svg: svgPath,
    meta: metaPath,
    stats,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
