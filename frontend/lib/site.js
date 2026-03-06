export const SUPPORTED_LANGS = ["en", "th", "zh", "lo"];

export const CATEGORY_KEYS = [
  "attractions",
  "activities",
  "hotels",
  "cafes",
  "restaurants",
  "transport",
];

const content = {
  en: {
    siteTitle: "UbonCity",
    tagline: "Explore Ubon Ratchathani with trusted local picks",
    intro:
      "Find attractions, activities, hotels, cafes, restaurants, and transport info in one place.",
    explore: "Explore Categories",
    latestEvents: "Latest Event",
    latestEventsEmpty: "No event updates yet.",
    updatedOn: "Approved",
    viewEvent: "View event",
    backHome: "Back to home",
    eventNotFound: "Event not found",
    empty: "No places found for this category yet.",
    readMore: "Read more",
    nav: {
      attractions: "Attractions",
      activities: "Activities",
      hotels: "Hotels",
      cafes: "Cafes",
      restaurants: "Restaurants",
      transport: "Transport",
    },
  },
  th: {
    siteTitle: "UbonCity",
    tagline: "สำรวจอุบลราชธานีกับแหล่งข้อมูลท่องเที่ยวที่เชื่อถือได้",
    intro:
      "รวมสถานที่ท่องเที่ยว กิจกรรม โรงแรม คาเฟ่ ร้านอาหาร และข้อมูลการเดินทางไว้ในที่เดียว",
    explore: "สำรวจหมวดหมู่",
    latestEvents: "Latest Event",
    latestEventsEmpty: "ยังไม่มีการอัปเดต Event",
    updatedOn: "อนุมัติเมื่อ",
    viewEvent: "ดูรายละเอียด Event",
    backHome: "กลับหน้าโฮม",
    eventNotFound: "ไม่พบ Event",
    empty: "ยังไม่พบเนื้อหาในหมวดนี้",
    readMore: "อ่านต่อ",
    nav: {
      attractions: "สถานที่ท่องเที่ยว",
      activities: "กิจกรรม",
      hotels: "โรงแรม",
      cafes: "คาเฟ่",
      restaurants: "ร้านอาหาร",
      transport: "การเดินทาง",
    },
  },
  zh: {
    siteTitle: "UbonCity",
    tagline: "探索乌汶府精选的本地旅行信息",
    intro: "在一个地方找到景点、活动、酒店、咖啡馆、餐厅和交通信息。",
    explore: "浏览分类",
    latestEvents: "最新活动",
    latestEventsEmpty: "暂无活动更新",
    updatedOn: "批准于",
    viewEvent: "查看活动",
    backHome: "返回首页",
    eventNotFound: "未找到活动",
    empty: "该分类暂无内容",
    readMore: "阅读更多",
    nav: {
      attractions: "景点",
      activities: "活动",
      hotels: "酒店",
      cafes: "咖啡馆",
      restaurants: "餐厅",
      transport: "交通",
    },
  },
  lo: {
    siteTitle: "UbonCity",
    tagline: "ສຳຫຼວດເນື້ອຫາທ່ອງທ່ຽວເມືອງອຸບົນທີ່ເຊື່ອຖືໄດ້",
    intro:
      "ຮວບຮວມສະຖານທີ່ທ່ອງທ່ຽວ ກິດຈະກຳ ໂຮງແຮມ ຄາເຟ ຮ້ານອາຫານ ແລະຂໍ້ມູນການເດີນທາງໃນບ່ອນດຽວ",
    explore: "ສຳຫຼວດໝວດໝູ່",
    latestEvents: "ອີເວັນລ່າສຸດ",
    latestEventsEmpty: "ຍັງບໍ່ມີການອັບເດດອີເວັນ",
    updatedOn: "ອະນຸມັດເມື່ອ",
    viewEvent: "ເບິ່ງອີເວັນ",
    backHome: "ກັບໜ້າຫຼັກ",
    eventNotFound: "ບໍ່ພົບອີເວັນ",
    empty: "ຍັງບໍ່ພົບເນື້ອຫາໃນໝວດນີ້",
    readMore: "ອ່ານຕໍ່",
    nav: {
      attractions: "ສະຖານທີ່ທ່ອງທ່ຽວ",
      activities: "ກິດຈະກຳ",
      hotels: "ໂຮງແຮມ",
      cafes: "ຄາເຟ",
      restaurants: "ຮ້ານອາຫານ",
      transport: "ການເດີນທາງ",
    },
  },
};

export function normalizeLang(lang) {
  return SUPPORTED_LANGS.includes(lang) ? lang : "en";
}

export function getLangContent(lang) {
  return content[normalizeLang(lang)];
}
