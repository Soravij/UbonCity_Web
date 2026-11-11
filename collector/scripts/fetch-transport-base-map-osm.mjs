import fs from "node:fs/promises";
import path from "node:path";

const KEY = "ubon-city-v2";
const BBOX = "15.0743,104.7632,15.3054,105.0056"; // south,west,north,east
const OUT_DIR = path.resolve("collector", "tmp");
const ENDPOINT = "https://overpass-api.de/api/interpreter";

const ROADS = `[out:json][timeout:180];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|road|service)$"](${BBOX});
out tags geom;`;

const AREAS = `[out:json][timeout:180];
(
  way["natural"~"^(water|wood)$"](${BBOX});
  relation["natural"="water"](${BBOX});
  way["waterway"="riverbank"](${BBOX});
  relation["waterway"="riverbank"](${BBOX});
  way["landuse"~"^(grass|forest|recreation_ground|military)$"](${BBOX});
  relation["landuse"~"^(grass|forest|recreation_ground|military)$"](${BBOX});
  way["leisure"="park"](${BBOX});
  relation["leisure"="park"](${BBOX});
  way["aeroway"~"^(aerodrome|apron|runway)$"](${BBOX});
  way["amenity"~"^(school|university|college|hospital|clinic)$"](${BBOX});
  relation["amenity"~"^(university|hospital)$"](${BBOX});
  way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"](${BBOX});
);
out tags geom;`;

async function fetchQuery(query) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "uboncity-collector/transport-base-map" },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(240000),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.text();
}

await fs.mkdir(OUT_DIR, { recursive: true });
const roads = await fetchQuery(ROADS);
await fs.writeFile(path.join(OUT_DIR, `${KEY}-overpass.json`), roads, "utf8");
const areas = await fetchQuery(AREAS);
await fs.writeFile(path.join(OUT_DIR, `${KEY}-areas.json`), areas, "utf8");
process.stdout.write(JSON.stringify({
  roads_elements: JSON.parse(roads).elements.length,
  area_elements: JSON.parse(areas).elements.length,
}, null, 2));
