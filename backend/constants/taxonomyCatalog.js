const TAXONOMY_V1_KEYS = Object.freeze([
  "age_restriction",
  "air_conditioning",
  "airport_shuttle",
  "airport_transfer",
  "average_price_per_person",
  "booking_required",
  "breakfast_available",
  "cashless_payment",
  "charter_available",
  "child_friendly",
  "child_seat_available",
  "delivery_available",
  "dietary_options",
  "entry_fee_required",
  "equipment_provided",
  "family_room_available",
  "group_seating_available",
  "guide_available",
  "gym_available",
  "hiking_required",
  "kids_area",
  "luggage_supported",
  "meal_available",
  "meeting_room_available",
  "onsite_restaurant",
  "outdoor_seating",
  "parking",
  "pet_friendly",
  "pet_transport_allowed",
  "physical_difficulty",
  "price_level",
  "pricing_model",
  "private_group_available",
  "private_room_available",
  "religious_dress_code",
  "reservation_available",
  "service_scope",
  "setting_type",
  "specialty_coffee",
  "swimming_allowed",
  "swimming_pool",
  "toilet_available",
  "typical_duration",
  "waterfront",
  "weather_dependent",
  "wheelchair_accessible",
  "wifi_available",
  "work_power_outlets",
]);

const TAXONOMY_V1_KEY_SET = new Set(TAXONOMY_V1_KEYS);

export function isKnownTaxonomyCatalogKey(key) {
  return TAXONOMY_V1_KEY_SET.has(String(key || "").trim().toLowerCase());
}

export function getTaxonomyV1KeyList() {
  return [...TAXONOMY_V1_KEYS];
}
