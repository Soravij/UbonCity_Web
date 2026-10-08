const VALID = new Set(["attractions","activities","hotels","cafes","restaurants","transport"]);
const CAFES = new Set(["cafe","coffee_shop","bakery","tea_house","cafeteria"]);
const RESTAURANTS = new Set(["restaurant","bar","meal_takeaway","meal_delivery","food_court"]);
const HOTELS = new Set(["lodging","hotel","resort_hotel","motel","guest_house","hostel","bed_and_breakfast"]);
const TRANSPORT = new Set(["bus_station","airport","transit_station","train_station","taxi_stand"]);
const ATTRACTIONS = new Set(["tourist_attraction","buddhist_temple","place_of_worship","museum","park","state_park","zoo"]);

function mapOne(t) {
  const s = String(t || "").trim().toLowerCase();
  if (!s) return null;
  if (CAFES.has(s)) return "cafes";
  if (RESTAURANTS.has(s) || s.endsWith("_restaurant")) return "restaurants";
  if (HOTELS.has(s)) return "hotels";
  if (TRANSPORT.has(s)) return "transport";
  if (ATTRACTIONS.has(s)) return "attractions";
  return null;
}

export function mapGoogleTypesToCategory(primaryType, types) {
  const first = mapOne(primaryType);
  if (first) return first;
  for (const t of Array.isArray(types) ? types : []) {
    const m = mapOne(t);
    if (m) return m;
  }
  return null;
}

export function normalizeCategoryHint(hint) {
  const s = String(hint || "").trim().toLowerCase();
  return VALID.has(s) ? s : null;
}

export function applyGoogleCategory(item, hint) {
  const n = item?.normalized_json;
  if (!n || typeof n !== "object") return;
  const p = item.payload_json && typeof item.payload_json === "object" ? item.payload_json : {};
  const inner = p.payload_json && typeof p.payload_json === "object" ? p.payload_json : {};
  const primaryType = inner.primaryType ?? p.primaryType;
  const types = inner.types ?? p.types ?? n.tags;
  n.category = mapGoogleTypesToCategory(primaryType, types) || normalizeCategoryHint(hint) || "attractions";
}
