export const TAXONOMY_CATALOG_VERSION = "taxonomy_catalog_v1";

export const SUPPORTED_TAXONOMY_CATEGORIES = Object.freeze([
  "attractions",
  "activities",
  "hotels",
  "cafes",
  "restaurants",
  "transport",
]);

const CATEGORY_ALIAS_MAP = Object.freeze({
  attraction: "attractions",
  attractions: "attractions",
  activity: "activities",
  activities: "activities",
  hotel: "hotels",
  hotels: "hotels",
  resort: "hotels",
  cafe: "cafes",
  cafes: "cafes",
  coffee_shop: "cafes",
  restaurant: "restaurants",
  restaurants: "restaurants",
  food: "restaurants",
  transport: "transport",
});

const DEFAULT_DOWNSTREAM_CONSUMERS = Object.freeze([
  "homepage_signals",
  "content_pool",
]);

const BOOLEAN_WITH_CONDITIONS_KEYS = new Set([
  "waterfront",
  "air_conditioning",
  "parking",
  "outdoor_seating",
  "pet_friendly",
  "work_power_outlets",
  "wheelchair_accessible",
  "toilet_available",
  "entry_fee_required",
  "child_friendly",
  "swimming_allowed",
  "hiking_required",
  "religious_dress_code",
  "booking_required",
  "age_restriction",
  "equipment_provided",
  "weather_dependent",
  "guide_available",
  "private_group_available",
  "wifi_available",
  "breakfast_available",
  "swimming_pool",
  "family_room_available",
  "airport_shuttle",
  "onsite_restaurant",
  "gym_available",
  "meeting_room_available",
  "specialty_coffee",
  "meal_available",
  "kids_area",
  "reservation_available",
  "private_room_available",
  "group_seating_available",
  "delivery_available",
  "luggage_supported",
  "cashless_payment",
  "airport_transfer",
  "charter_available",
  "child_seat_available",
  "pet_transport_allowed",
]);

const EVIDENCE_REQUIRED_KEYS = new Set([
  "pet_friendly",
  "wheelchair_accessible",
  "swimming_allowed",
  "age_restriction",
  "religious_dress_code",
]);

const TAXONOMY_DEFINITIONS = Object.freeze({
  waterfront: {
    label: "ติดริมน้ำ",
    instruction: "ยืนยันว่ามีบรรยากาศติดริมน้ำที่ผู้ใช้เข้าถึงได้จริง",
    condition_prompt: "ถ้าติดริมน้ำเฉพาะบางโซน ให้ระบุเงื่อนไข",
  },
  parking: {
    label: "มีที่จอดรถ",
    instruction: "ยืนยันว่ามีที่จอดรถสำหรับผู้ใช้จริง",
    condition_prompt: "ถ้าที่จอดจำกัด ร่วมใช้ หรือมีค่าใช้จ่าย ให้ระบุเงื่อนไข",
  },
  pet_friendly: {
    label: "สัตว์เลี้ยงเข้าได้",
    instruction: "ยืนยันว่าสัตว์เลี้ยงเข้าได้จริง",
    condition_prompt: "ถ้าเข้าได้เฉพาะบางพื้นที่หรือมีข้อจำกัด ให้ระบุเงื่อนไข",
  },
  wheelchair_accessible: {
    label: "รถเข็นเข้าถึงได้",
    instruction: "ยืนยันว่าสามารถเข้าถึงด้วยรถเข็นได้จริง",
    condition_prompt: "ถ้าเข้าถึงได้เฉพาะบางจุดหรือมีข้อจำกัด ให้ระบุเงื่อนไข",
  },
  toilet_available: {
    label: "มีห้องน้ำ",
    instruction: "ยืนยันว่ามีห้องน้ำให้ผู้ใช้ใช้งานจริง",
    condition_prompt: "ถ้าห้องน้ำมีเฉพาะบางจุดหรือบางเวลา ให้ระบุเงื่อนไข",
  },
  entry_fee_required: {
    label: "มีค่าเข้าหรือไม่",
    instruction: "ยืนยันว่าต้องเสียค่าเข้าหรือไม่",
    condition_prompt: "ถ้าฟรีเฉพาะบางช่วงหรือบางกลุ่ม ให้ระบุเงื่อนไข",
  },
  setting_type: {
    label: "ลักษณะสถานที่",
    instruction: "เลือกว่าพื้นที่ใช้งานหลักเป็นในร่ม กลางแจ้ง หรือผสม",
    condition_prompt: "ถ้าพื้นที่เด่นขึ้นกับช่วงเวลา ให้ระบุเงื่อนไข",
    allowed_values: ["indoor", "outdoor", "mixed"],
  },
  child_friendly: {
    label: "เหมาะกับเด็ก",
    instruction: "ยืนยันว่าพาเด็กไปได้สะดวกจริง",
    condition_prompt: "ถ้าเหมาะเฉพาะบางวัยหรือบางโซน ให้ระบุเงื่อนไข",
  },
  swimming_allowed: {
    label: "ลงเล่นน้ำได้",
    instruction: "ยืนยันว่ามีพื้นที่ที่ลงเล่นน้ำได้จริง",
    condition_prompt: "ถ้าลงได้เฉพาะบางจุดหรือบางฤดูกาล ให้ระบุเงื่อนไข",
  },
  hiking_required: {
    label: "ต้องเดินเท้าหรือเดินป่า",
    instruction: "ยืนยันว่าต้องเดินเท้าหรือเดินป่าก่อนถึงจุดใช้งานหลัก",
    condition_prompt: "ถ้าระยะเดินขึ้นกับเส้นทางหรือฤดูกาล ให้ระบุเงื่อนไข",
  },
  religious_dress_code: {
    label: "มีข้อกำหนดการแต่งกาย",
    instruction: "ยืนยันว่ามีข้อกำหนดการแต่งกายจริง",
    condition_prompt: "ถ้ามีเฉพาะบางพื้นที่หรือบางช่วงพิธี ให้ระบุเงื่อนไข",
  },
  booking_required: {
    label: "ต้องจองล่วงหน้า",
    instruction: "ยืนยันว่าควรหรือจำเป็นต้องจองล่วงหน้า",
    condition_prompt: "ถ้าต้องจองเฉพาะบางรอบหรือบางวัน ให้ระบุเงื่อนไข",
  },
  price_level: {
    label: "ระดับราคา",
    instruction: "เลือกภาพรวมระดับราคาที่ผู้ใช้เจอจริง",
    condition_prompt: "ถ้าราคาขึ้นกับช่วงเวลา แพ็กเกจ หรือเมนู ให้ระบุเงื่อนไข",
    allowed_values: ["budget", "standard", "premium"],
  },
  average_price_per_person: {
    label: "ราคาเฉลี่ยต่อคน",
    instruction: "กรอกราคาเฉลี่ยต่อคนที่ใช้งานจริง",
    condition_prompt: "ถ้าราคานี้ใช้ได้เฉพาะบางแพ็กเกจหรือบางเมนู ให้ระบุเงื่อนไข",
    unit_options: ["THB/person"],
  },
  typical_duration: {
    label: "ระยะเวลาโดยทั่วไป",
    instruction: "กรอกเวลาที่มักใช้โดยทั่วไป",
    condition_prompt: "ถ้าระยะเวลาขึ้นกับรูปแบบกิจกรรม ให้ระบุเงื่อนไข",
    unit_options: ["minutes", "hours"],
  },
  physical_difficulty: {
    label: "ความใช้แรง",
    instruction: "เลือกระดับความใช้แรงของกิจกรรม",
    condition_prompt: "ถ้าความยากขึ้นกับเส้นทางหรือสภาพอากาศ ให้ระบุเงื่อนไข",
    allowed_values: ["easy", "moderate", "hard"],
  },
  age_restriction: {
    label: "มีข้อจำกัดอายุ",
    instruction: "ยืนยันว่ามีข้อจำกัดด้านอายุจริง",
    condition_prompt: "ถ้าจำกัดเฉพาะบางกิจกรรมหรือบางรอบ ให้ระบุเงื่อนไข",
  },
  equipment_provided: {
    label: "มีอุปกรณ์ให้",
    instruction: "ยืนยันว่ามีอุปกรณ์ให้ผู้ใช้จริง",
    condition_prompt: "ถ้ามีเฉพาะบางแพ็กเกจหรือบางกิจกรรม ให้ระบุเงื่อนไข",
  },
  weather_dependent: {
    label: "ขึ้นกับสภาพอากาศ",
    instruction: "ยืนยันว่าการใช้งานขึ้นกับสภาพอากาศจริง",
    condition_prompt: "ถ้ากระทบเฉพาะบางฤดูหรือบางช่วง ให้ระบุเงื่อนไข",
  },
  guide_available: {
    label: "มีไกด์",
    instruction: "ยืนยันว่ามีไกด์หรือผู้นำกิจกรรมให้จริง",
    condition_prompt: "ถ้ามีเฉพาะบางแพ็กเกจหรือบางภาษา ให้ระบุเงื่อนไข",
  },
  private_group_available: {
    label: "รองรับกรุ๊ปส่วนตัว",
    instruction: "ยืนยันว่าจองแบบกรุ๊ปส่วนตัวได้จริง",
    condition_prompt: "ถ้ามีเฉพาะบางขนาดกลุ่มหรือบางเวลา ให้ระบุเงื่อนไข",
  },
  air_conditioning: {
    label: "มีแอร์",
    instruction: "ยืนยันว่าพื้นที่ใช้งานหลักมีแอร์จริง",
    condition_prompt: "ถ้ามีแอร์เฉพาะบางห้องหรือบางโซน ให้ระบุเงื่อนไข",
  },
  wifi_available: {
    label: "มี Wi-Fi",
    instruction: "ยืนยันว่ามี Wi-Fi ให้ผู้ใช้จริง",
    condition_prompt: "ถ้ามีเฉพาะบางโซนหรือต้องขอรหัส ให้ระบุเงื่อนไข",
  },
  breakfast_available: {
    label: "มีอาหารเช้า",
    instruction: "ยืนยันว่ามีอาหารเช้าให้จริง",
    condition_prompt: "ถ้ามีเฉพาะบางแพ็กเกจหรือบางวัน ให้ระบุเงื่อนไข",
  },
  swimming_pool: {
    label: "มีสระว่ายน้ำ",
    instruction: "ยืนยันว่ามีสระว่ายน้ำให้ใช้งานจริง",
    condition_prompt: "ถ้ามีเฉพาะบางอาคารหรือบางช่วงเวลา ให้ระบุเงื่อนไข",
  },
  family_room_available: {
    label: "มีห้องพักแบบครอบครัว",
    instruction: "ยืนยันว่ามีห้องพักที่เหมาะกับครอบครัวจริง",
    condition_prompt: "ถ้ามีเฉพาะบางประเภทห้องหรือบางช่วง ให้ระบุเงื่อนไข",
  },
  airport_shuttle: {
    label: "มีรถรับส่งสนามบิน",
    instruction: "ยืนยันว่ามีบริการรถรับส่งสนามบินจริง",
    condition_prompt: "ถ้ามีเฉพาะบางช่วงเวลาหรือมีค่าใช้จ่ายเพิ่ม ให้ระบุเงื่อนไข",
  },
  onsite_restaurant: {
    label: "มีร้านอาหารในที่พัก",
    instruction: "ยืนยันว่ามีร้านอาหารในพื้นที่จริง",
    condition_prompt: "ถ้าเปิดเฉพาะบางเวลา ให้ระบุเงื่อนไข",
  },
  gym_available: {
    label: "มีฟิตเนส",
    instruction: "ยืนยันว่ามีฟิตเนสให้ใช้งานจริง",
    condition_prompt: "ถ้าเปิดเฉพาะบางเวลา หรือจำกัดผู้ใช้ ให้ระบุเงื่อนไข",
  },
  meeting_room_available: {
    label: "มีห้องประชุม",
    instruction: "ยืนยันว่ามีห้องประชุมหรือพื้นที่ประชุมจริง",
    condition_prompt: "ถ้ามีเฉพาะบางขนาดหรือบางแพ็กเกจ ให้ระบุเงื่อนไข",
  },
  outdoor_seating: {
    label: "มีที่นั่งกลางแจ้ง",
    instruction: "ยืนยันว่ามีที่นั่งกลางแจ้งให้ใช้งานจริง",
    condition_prompt: "ถ้ามีเฉพาะบางโซนหรือบางเวลา ให้ระบุเงื่อนไข",
  },
  work_power_outlets: {
    label: "มีปลั๊กทำงาน",
    instruction: "ยืนยันว่ามีปลั๊กไฟที่ใช้นั่งทำงานได้จริง",
    condition_prompt: "ถ้ามีเฉพาะบางโต๊ะหรือบางโซน ให้ระบุเงื่อนไข",
  },
  specialty_coffee: {
    label: "มี Specialty Coffee",
    instruction: "ยืนยันว่ามีเมล็ดหรือเมนูสาย specialty จริง",
    condition_prompt: "ถ้ามีเฉพาะบางช่วงหรือบางเมล็ด ให้ระบุเงื่อนไข",
  },
  meal_available: {
    label: "มีอาหารมื้อหลัก",
    instruction: "ยืนยันว่ามีอาหารมื้อหลักจริง",
    condition_prompt: "ถ้ามีเฉพาะบางช่วงเวลา ให้ระบุเงื่อนไข",
  },
  kids_area: {
    label: "มีมุมเด็ก",
    instruction: "ยืนยันว่ามีพื้นที่สำหรับเด็กจริง",
    condition_prompt: "ถ้ามีเฉพาะบางโซนหรือบางวัน ให้ระบุเงื่อนไข",
  },
  reservation_available: {
    label: "รับจองโต๊ะ",
    instruction: "ยืนยันว่าจองล่วงหน้าได้จริง",
    condition_prompt: "ถ้าจองได้เฉพาะบางช่วงหรือบางช่องทาง ให้ระบุเงื่อนไข",
  },
  dietary_options: {
    label: "ตัวเลือกอาหารพิเศษ",
    instruction: "เลือกตัวเลือกอาหารพิเศษที่มีจริง",
    condition_prompt: "ถ้ามีเฉพาะบางเมนูหรือบางวัน ให้ระบุเงื่อนไข",
    allowed_values: ["vegetarian", "vegan", "halal", "gluten_free"],
  },
  private_room_available: {
    label: "มีห้องส่วนตัว",
    instruction: "ยืนยันว่ามีห้องส่วนตัวหรือโซนส่วนตัวจริง",
    condition_prompt: "ถ้ามีเฉพาะบางขนาดกลุ่มหรือมีค่าใช้จ่ายเพิ่ม ให้ระบุเงื่อนไข",
  },
  group_seating_available: {
    label: "รองรับโต๊ะกลุ่ม",
    instruction: "ยืนยันว่ารองรับโต๊ะกลุ่มหรือกรุ๊ปใหญ่จริง",
    condition_prompt: "ถ้ารองรับเฉพาะบางช่วงเวลา ให้ระบุเงื่อนไข",
  },
  delivery_available: {
    label: "มีบริการเดลิเวอรี",
    instruction: "ยืนยันว่ามีบริการเดลิเวอรีจริง",
    condition_prompt: "ถ้ามีเฉพาะบางแพลตฟอร์มหรือบางเวลา ให้ระบุเงื่อนไข",
  },
  pricing_model: {
    label: "รูปแบบคิดราคา",
    instruction: "เลือกรูปแบบคิดราคาหลักที่ใช้จริง",
    condition_prompt: "ถ้ามีหลายแบบตามบริการ ให้ระบุเงื่อนไข",
    allowed_values: ["meter", "fixed_trip", "distance_based", "per_person", "hourly", "daily"],
  },
  service_scope: {
    label: "ขอบเขตพื้นที่บริการ",
    instruction: "เลือกพื้นที่บริการที่ครอบคลุมจริง",
    condition_prompt: "ถ้าขอบเขตขึ้นกับรถหรือแพ็กเกจ ให้ระบุเงื่อนไข",
    allowed_values: ["city", "district", "province", "interprovince", "airport"],
  },
  luggage_supported: {
    label: "รองรับสัมภาระ",
    instruction: "ยืนยันว่ารองรับสัมภาระจริง",
    condition_prompt: "ถ้ารองรับเฉพาะบางขนาดหรือบางประเภทรถ ให้ระบุเงื่อนไข",
  },
  cashless_payment: {
    label: "รองรับจ่ายแบบไม่ใช้เงินสด",
    instruction: "ยืนยันว่าจ่ายแบบไม่ใช้เงินสดได้จริง",
    condition_prompt: "ถ้ารับเฉพาะบางช่องทาง ให้ระบุเงื่อนไข",
  },
  airport_transfer: {
    label: "มีรับส่งสนามบิน",
    instruction: "ยืนยันว่ามีบริการรับส่งสนามบินจริง",
    condition_prompt: "ถ้ามีเฉพาะบางสนามบินหรือบางเวลา ให้ระบุเงื่อนไข",
  },
  charter_available: {
    label: "เช่าเหมาได้",
    instruction: "ยืนยันว่าเช่าเหมาได้จริง",
    condition_prompt: "ถ้าเช่าเหมาได้เฉพาะบางเส้นทางหรือบางช่วง ให้ระบุเงื่อนไข",
  },
  child_seat_available: {
    label: "มีคาร์ซีทเด็ก",
    instruction: "ยืนยันว่าสามารถขอคาร์ซีทเด็กได้จริง",
    condition_prompt: "ถ้าต้องจองล่วงหน้าหรือมีเฉพาะบางรุ่นรถ ให้ระบุเงื่อนไข",
  },
  pet_transport_allowed: {
    label: "รับส่งสัตว์เลี้ยงได้",
    instruction: "ยืนยันว่าสามารถพาสัตว์เลี้ยงขึ้นรถได้จริง",
    condition_prompt: "ถ้ารับเฉพาะบางขนาดหรือมีเงื่อนไขเพิ่ม ให้ระบุเงื่อนไข",
  },
});

export const TAXONOMY_CATEGORY_MATRIX = Object.freeze({
  attractions: Object.freeze({
    required: Object.freeze([
      "parking",
      "pet_friendly",
      "wheelchair_accessible",
      "toilet_available",
      "entry_fee_required",
      "setting_type",
    ]),
    agent_triggered: Object.freeze([
      "waterfront",
      "child_friendly",
      "swimming_allowed",
      "hiking_required",
      "religious_dress_code",
    ]),
  }),
  activities: Object.freeze({
    required: Object.freeze([
      "booking_required",
      "price_level",
      "average_price_per_person",
      "typical_duration",
      "physical_difficulty",
      "age_restriction",
      "equipment_provided",
      "weather_dependent",
    ]),
    agent_triggered: Object.freeze([
      "guide_available",
      "private_group_available",
      "parking",
      "wheelchair_accessible",
      "child_friendly",
    ]),
  }),
  hotels: Object.freeze({
    required: Object.freeze([
      "parking",
      "pet_friendly",
      "air_conditioning",
      "price_level",
      "wifi_available",
      "breakfast_available",
      "swimming_pool",
      "wheelchair_accessible",
    ]),
    agent_triggered: Object.freeze([
      "family_room_available",
      "airport_shuttle",
      "onsite_restaurant",
      "gym_available",
      "meeting_room_available",
      "waterfront",
    ]),
  }),
  cafes: Object.freeze({
    required: Object.freeze([
      "price_level",
      "average_price_per_person",
      "air_conditioning",
      "parking",
      "outdoor_seating",
      "pet_friendly",
      "work_power_outlets",
      "wifi_available",
    ]),
    agent_triggered: Object.freeze([
      "waterfront",
      "specialty_coffee",
      "meal_available",
      "kids_area",
      "reservation_available",
    ]),
  }),
  restaurants: Object.freeze({
    required: Object.freeze([
      "price_level",
      "average_price_per_person",
      "air_conditioning",
      "parking",
      "outdoor_seating",
      "pet_friendly",
      "reservation_available",
      "dietary_options",
    ]),
    agent_triggered: Object.freeze([
      "waterfront",
      "private_room_available",
      "group_seating_available",
      "delivery_available",
    ]),
  }),
  transport: Object.freeze({
    required: Object.freeze([
      "booking_required",
      "pricing_model",
      "service_scope",
      "luggage_supported",
      "air_conditioning",
      "wheelchair_accessible",
    ]),
    agent_triggered: Object.freeze([
      "cashless_payment",
      "airport_transfer",
      "charter_available",
      "child_seat_available",
      "pet_transport_allowed",
    ]),
  }),
});

const KEY_TO_CATEGORIES = buildKeyToCategories();
const TAXONOMY_CATALOG_KEY_SET = new Set(Object.keys(TAXONOMY_DEFINITIONS));

function buildKeyToCategories() {
  const mapping = new Map();
  for (const category of SUPPORTED_TAXONOMY_CATEGORIES) {
    const config = TAXONOMY_CATEGORY_MATRIX[category];
    for (const taxonomyKey of [...config.required, ...config.agent_triggered]) {
      if (!mapping.has(taxonomyKey)) mapping.set(taxonomyKey, new Set());
      mapping.get(taxonomyKey).add(category);
    }
  }
  return mapping;
}

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function buildAnswerType(key, definition = {}) {
  if (BOOLEAN_WITH_CONDITIONS_KEYS.has(key)) return "boolean_with_conditions";
  if (Array.isArray(definition.allowed_values) && definition.allowed_values.length > 0) {
    return key === "dietary_options" || key === "service_scope" ? "multi_select" : "select";
  }
  if (Array.isArray(definition.unit_options) && definition.unit_options.length > 0) return "number_with_unit";
  throw new Error(`Missing answer_type contract for taxonomy key "${key}"`);
}

function buildBaseCatalogDefinition(taxonomyKey) {
  const definition = TAXONOMY_DEFINITIONS[taxonomyKey];
  if (!definition) throw new Error(`Unknown taxonomy key "${taxonomyKey}"`);
  const categories = Array.from(KEY_TO_CATEGORIES.get(taxonomyKey) || []).sort();
  if (!categories.length) {
    throw new Error(`Taxonomy key "${taxonomyKey}" has no category applicability`);
  }
  return Object.freeze({
    catalog_version: TAXONOMY_CATALOG_VERSION,
    taxonomy_key: taxonomyKey,
    label: definition.label,
    instruction: definition.instruction,
    answer_type: buildAnswerType(taxonomyKey, definition),
    categories,
    item_types: Object.freeze(["place"]),
    condition_prompt: definition.condition_prompt,
    evidence_required: EVIDENCE_REQUIRED_KEYS.has(taxonomyKey),
    required: false,
    activation_mode: "agent_triggered",
    allowed_values: Array.isArray(definition.allowed_values) ? Object.freeze([...definition.allowed_values]) : null,
    unit_options: Array.isArray(definition.unit_options) ? Object.freeze([...definition.unit_options]) : null,
    downstream_consumers: Object.freeze([...DEFAULT_DOWNSTREAM_CONSUMERS]),
  });
}

const BASE_CATALOG_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.keys(TAXONOMY_DEFINITIONS).map((taxonomyKey) => [taxonomyKey, buildBaseCatalogDefinition(taxonomyKey)])
  )
);

export function normalizeTaxonomyCatalogCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CATEGORY_ALIAS_MAP[normalized] || normalized || "";
}

export function isKnownTaxonomyCatalogKey(value) {
  return TAXONOMY_CATALOG_KEY_SET.has(String(value || "").trim().toLowerCase());
}

export function getTaxonomyBaseDefinition(taxonomyKey = "") {
  const normalizedKey = String(taxonomyKey || "").trim().toLowerCase();
  const definition = BASE_CATALOG_DEFINITIONS[normalizedKey];
  return definition ? cloneValue(definition) : null;
}

export function getTaxonomyCatalogEntriesForCategory(category = "", itemType = "place") {
  const normalizedItemType = String(itemType || "").trim().toLowerCase();
  if (normalizedItemType !== "place") return [];
  const normalizedCategory = normalizeTaxonomyCatalogCategory(category);
  const matrix = TAXONOMY_CATEGORY_MATRIX[normalizedCategory];
  if (!matrix) return [];
  return [
    ...matrix.required.map((taxonomyKey) => ({
      ...cloneValue(BASE_CATALOG_DEFINITIONS[taxonomyKey]),
      activation_mode: "required",
      required: true,
    })),
    ...matrix.agent_triggered.map((taxonomyKey) => ({
      ...cloneValue(BASE_CATALOG_DEFINITIONS[taxonomyKey]),
      activation_mode: "agent_triggered",
      required: false,
    })),
  ];
}

export function getTaxonomyCatalogEntriesForItem(item = {}) {
  const itemType = String(item?.type || "").trim().toLowerCase();
  const category = normalizeTaxonomyCatalogCategory(item?.category || item?.niche || "");
  return getTaxonomyCatalogEntriesForCategory(category, itemType);
}

export function normalizeTaxonomyCatalogSuggestedValue(entryOrKey, rawValue) {
  const entry = typeof entryOrKey === "string"
    ? getTaxonomyBaseDefinition(entryOrKey)
    : (entryOrKey && typeof entryOrKey === "object" ? cloneValue(entryOrKey) : null);
  if (!entry || rawValue == null) return null;
  const answerType = String(entry.answer_type || "").trim().toLowerCase();
  if (answerType === "boolean" || answerType === "boolean_with_conditions") {
    return typeof rawValue === "boolean" ? rawValue : null;
  }
  if (answerType === "select") {
    const value = String(rawValue || "").trim();
    return Array.isArray(entry.allowed_values) && entry.allowed_values.includes(value) ? value : null;
  }
  if (answerType === "multi_select") {
    if (!Array.isArray(rawValue) || !Array.isArray(entry.allowed_values)) return null;
    const seen = new Set();
    const values = [];
    for (const item of rawValue) {
      const value = String(item || "").trim();
      if (!value || seen.has(value)) continue;
      if (!entry.allowed_values.includes(value)) continue;
      seen.add(value);
      values.push(value);
    }
    return values.length ? values : null;
  }
  if (answerType === "number_with_unit") {
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return null;
    const numberValue = Number(rawValue.number);
    const unitValue = String(rawValue.unit || "").trim();
    if (!Number.isFinite(numberValue)) return null;
    if (!unitValue || !Array.isArray(entry.unit_options) || !entry.unit_options.includes(unitValue)) return null;
    return { number: numberValue, unit: unitValue };
  }
  return null;
}

export function getTaxonomyCatalogEntryMapForItem(item = {}) {
  return new Map(
    getTaxonomyCatalogEntriesForItem(item).map((entry) => [entry.taxonomy_key, entry])
  );
}

export function isTaxonomyCatalogKeyApplicableToItem(taxonomyKey = "", item = {}) {
  const normalizedKey = String(taxonomyKey || "").trim().toLowerCase();
  if (!isKnownTaxonomyCatalogKey(normalizedKey)) return false;
  return getTaxonomyCatalogEntryMapForItem(item).has(normalizedKey);
}
