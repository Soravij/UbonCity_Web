import Link from "next/link";
import DecisionSearchBar from "@/components/DecisionSearchBar";
import HomepageLayoutRenderer from "@/components/HomepageLayoutRenderer";
import { CATEGORY_KEYS, getLangContent, normalizeLang } from "@/lib/site";
import { getEvents, getHomepageLayout, getPlaces, getUbonWeather } from "@/lib/api";
import { buildHomeDecisionSelections } from "@/lib/phase56-decision-helpers.mjs";
import { resolveHomepageLayout } from "@/lib/homepage-layout-resolver.mjs";

const LOCALE_MAP = {
  en: "en-US",
  th: "th-TH",
  zh: "zh-CN",
  lo: "lo-LA",
};

const DECISION_COPY = {
  th: {
    heroHeading: "ไปเที่ยวอุบล ไปไหนดีวันนี้?",
    heroHint: "เริ่มจากโจทย์ของคุณ แล้วระบบจะพาไปหมวดที่เหมาะทันที",
    searchPlaceholder: "พิมพ์: คาเฟ่ / ที่เที่ยว / งบ 500",
    searchLabel: "เริ่มเลือก",
    quickActions: [
      { label: "เที่ยววันเดียว", href: "attractions" },
      { label: "คาเฟ่วิวสวย", href: "cafes?scenario=scenic-cafe" },
      { label: "ร้านอาหารเด็ด", href: "restaurants?scenario=signature-food" },
    ],
    selectedTitle: "เลือกให้แล้ว",
    selectedSubtitle: "ชุดแนะนำที่กดต่อได้ทันทีเพื่อช่วยตัดสินใจเร็วขึ้น",
    selectedTop10: "เริ่มจากที่เที่ยวเหล่านี้",
    selectedCafe: "เริ่มจากคาเฟ่เหล่านี้",
    selectedEvening: "ตัวเลือกช่วงเย็น",
    trendingTitle: "อัปเดตล่าสุด",
    trendingSubtitle: "อัปเดตจากอีเวนต์และสถานที่ที่เพิ่งอนุมัติ",
    trendingEvents: "อีเวนต์มาใหม่",
    trendingPlaces: "สถานที่เพิ่งเข้าระบบ",
    scenariosTitle: "ตามสถานการณ์",
    scenariosSubtitle: "เลือกตามเวลา งบประมาณ และคนที่เดินทางด้วย",
    scenarios: [
      { key: "day_trip", title: "เที่ยววันเดียว", description: "แพลนจบในวันเดียว เดินทางไม่ซับซ้อน", href: "attractions" },
      { key: "budget", title: "งบ 500", description: "คุมงบแบบเที่ยวได้ กินได้ และยังสนุก", href: "restaurants?scenario=budget-500" },
      { key: "couple", title: "มากับแฟน", description: "บรรยากาศดี ถ่ายรูปสวย เหมาะกับคู่รัก", href: "cafes?scenario=couple" },
      { key: "family", title: "มากับครอบครัว", description: "เดินง่าย เด็กและผู้ใหญ่ไปด้วยกันได้", href: "attractions?scenario=family" },
    ],
    exploreTitle: "Explore",
    exploreSubtitle: "หมวดทั้งหมดสำหรับคนที่อยากสำรวจเอง",
    insightsTitle: "ก่อนออกไป",
    insightsSubtitle: "ข้อมูลสั้น ๆ ที่ช่วยตัดสินใจก่อนเลือกที่ไปต่อ",
    weatherBlock: "สภาพอากาศวันนี้",
    temperatureBlock: "อุณหภูมิ",
    conditionBlock: "สภาพอากาศ",
    aqiBlock: "คุณภาพอากาศ",
    updatedOn: "อัปเดตเมื่อ",
    openAll: "เปิดทั้งหมด",
    viewMore: "ดูเพิ่มเติม",
    dataPending: "ใช้ข้อมูลจริงจากอากาศ หมวดที่เด่น และความพร้อมของข้อมูลเดินทาง",
    publishedPlaces: "เนื้อหาที่ approved แล้ว",
    transportReady: "ข้อมูลการเดินทางที่พร้อมใช้งาน",
  },
  en: {
    heroHeading: "Where should I go in Ubon today?",
    heroHint: "Start with your intent and jump straight to the right picks.",
    searchPlaceholder: "Type: cafe / attractions / budget 500",
    searchLabel: "Start",
    quickActions: [
      { label: "Day Trip", href: "attractions" },
      { label: "Scenic Cafes", href: "cafes?scenario=scenic-cafe" },
      { label: "Top Food Spots", href: "restaurants?scenario=signature-food" },
    ],
    selectedTitle: "Picked For You",
    selectedSubtitle: "Curated shortcuts to help you decide quickly",
    selectedTop10: "Start With These Places",
    selectedCafe: "Start With These Cafes",
    selectedEvening: "Evening Options",
    trendingTitle: "Latest Updates",
    trendingSubtitle: "Freshly approved content and latest events",
    trendingEvents: "New Events",
    trendingPlaces: "Recently Added Places",
    scenariosTitle: "By Situation",
    scenariosSubtitle: "Choose by time, budget, and who you travel with",
    scenarios: [
      { key: "day_trip", title: "One-day Trip", description: "Simple plan you can finish in one day", href: "attractions" },
      { key: "budget", title: "Budget 500", description: "Keep costs tight without losing fun", href: "restaurants?scenario=budget-500" },
      { key: "couple", title: "With Partner", description: "Photo-friendly spots with good atmosphere", href: "cafes?scenario=couple" },
      { key: "family", title: "With Family", description: "Comfortable options for all ages", href: "attractions?scenario=family" },
    ],
    exploreTitle: "Explore",
    exploreSubtitle: "All categories for self-guided browsing",
    insightsTitle: "Before You Go",
    insightsSubtitle: "Quick facts that help you decide before opening the next page",
    weatherBlock: "Today's Weather",
    temperatureBlock: "Temperature",
    conditionBlock: "Conditions",
    aqiBlock: "Air Quality",
    updatedOn: "Updated",
    openAll: "Open All",
    viewMore: "View more",
    dataPending: "Built from live weather, the strongest category, and transport coverage already in the system.",
    publishedPlaces: "Approved places already published",
    transportReady: "Transport entries ready for public utility",
  },
  zh: {
    heroHeading: "今天去乌汶哪里好？",
    heroHint: "先从你的需求开始，系统会带你到更合适的内容。",
    searchPlaceholder: "输入：咖啡馆 / 景点 / 预算 500",
    searchLabel: "开始选择",
    quickActions: [
      { label: "一日游", href: "attractions" },
      { label: "风景咖啡馆", href: "cafes?scenario=scenic-cafe" },
      { label: "精选美食", href: "restaurants?scenario=signature-food" },
    ],
    selectedTitle: "已经帮你选好",
    selectedSubtitle: "先看这些快捷入口，更快做决定",
    selectedTop10: "先从这些地点开始",
    selectedCafe: "先看这些咖啡馆",
    selectedEvening: "傍晚可去",
    trendingTitle: "最新更新",
    trendingSubtitle: "来自最新通过审核并已发布的内容",
    trendingEvents: "新活动",
    trendingPlaces: "最近加入的地点",
    scenariosTitle: "按情境选择",
    scenariosSubtitle: "按时间、预算和同行对象来选",
    scenarios: [
      { key: "day_trip", title: "一日游", description: "一天内可完成，路线不复杂", href: "attractions" },
      { key: "budget", title: "预算 500", description: "控制花费，也能玩得尽兴", href: "restaurants?scenario=budget-500" },
      { key: "couple", title: "和伴侣同行", description: "氛围好，适合拍照和约会", href: "cafes?scenario=couple" },
      { key: "family", title: "家庭同行", description: "适合各年龄层，走动更轻松", href: "attractions?scenario=family" },
    ],
    exploreTitle: "Explore",
    exploreSubtitle: "想自己逛分类时可从这里进入",
    insightsTitle: "出发前",
    insightsSubtitle: "在继续浏览前，先看几条真正有用的提示",
    weatherBlock: "今日天气",
    temperatureBlock: "气温",
    conditionBlock: "天气",
    aqiBlock: "空气质量",
    updatedOn: "更新于",
    openAll: "查看全部",
    viewMore: "查看更多",
    dataPending: "基于实时天气、当前最强分类，以及系统内已可用的交通信息。",
    publishedPlaces: "已发布并通过审核的地点",
    transportReady: "可公开使用的交通条目",
  },
  lo: {
    heroHeading: "ມື້ນີ້ໄປທ່ຽວອຸບົນທີ່ໃດດີ?",
    heroHint: "ເລີ່ມຈາກສິ່ງທີ່ທ່ານຕ້ອງການ ແລ້ວລະບົບຈະພາໄປຫາຕົວເລືອກທີ່ເໝາະກວ່າ.",
    searchPlaceholder: "ພິມ: ຄາເຟ່ / ສະຖານທີ່ທ່ຽວ / ງົບ 500",
    searchLabel: "ເລີ່ມເລືອກ",
    quickActions: [
      { label: "ທ່ຽວມື້ດຽວ", href: "attractions" },
      { label: "ຄາເຟ່ວິວງາມ", href: "cafes?scenario=scenic-cafe" },
      { label: "ຮ້ານອາຫານເດັ່ນ", href: "restaurants?scenario=signature-food" },
    ],
    selectedTitle: "ເລືອກໄວ້ໃຫ້ແລ້ວ",
    selectedSubtitle: "ທາງລັດທີ່ຊ່ວຍໃຫ້ຕັດສິນໃຈໄດ້ໄວຂຶ້ນ",
    selectedTop10: "ເລີ່ມຈາກສະຖານທີ່ເຫຼົ່ານີ້",
    selectedCafe: "ເລີ່ມຈາກຄາເຟ່ເຫຼົ່ານີ້",
    selectedEvening: "ຕົວເລືອກຕອນແລງ",
    trendingTitle: "ອັບເດດຫຼ້າສຸດ",
    trendingSubtitle: "ຈາກເນື້ອຫາທີ່ອະນຸມັດແລະເຜີຍແຜ່ແລ້ວລ່າສຸດ",
    trendingEvents: "ອີເວັນໃໝ່",
    trendingPlaces: "ສະຖານທີ່ເພີ່ມໃໝ່",
    scenariosTitle: "ຕາມສະຖານະການ",
    scenariosSubtitle: "ເລືອກຕາມເວລາ ງົບປະມານ ແລະ ຄົນທີ່ໄປນຳ",
    scenarios: [
      { key: "day_trip", title: "ທ່ຽວມື້ດຽວ", description: "ຈົບແຜນໄດ້ໃນມື້ດຽວ ເດີນທາງບໍ່ຊັບຊ້ອນ", href: "attractions" },
      { key: "budget", title: "ງົບ 500", description: "ຄຸມຄ່າໃຊ້ຈ່າຍແຕ່ຍັງທ່ຽວໄດ້ສະບາຍ", href: "restaurants?scenario=budget-500" },
      { key: "couple", title: "ມາກັບແຟນ", description: "ບັນຍາກາດດີ ແລະ ເໝາະກັບການຖ່າຍຮູບ", href: "cafes?scenario=couple" },
      { key: "family", title: "ມາກັບຄອບຄົວ", description: "ຕົວເລືອກທີ່ໄປໄດ້ຫຼາຍຊ່ວງອາຍຸ", href: "attractions?scenario=family" },
    ],
    exploreTitle: "Explore",
    exploreSubtitle: "ໝວດທັງໝົດສຳລັບຄົນທີ່ຢາກສຳຫຼວດເອງ",
    insightsTitle: "ກ່ອນອອກໄປ",
    insightsSubtitle: "ຂໍ້ມູນສັ້ນໆ ທີ່ຊ່ວຍຕັດສິນໃຈກ່ອນເຂົ້າໄປດູລາຍລະອຽດ",
    weatherBlock: "ອາກາດມື້ນີ້",
    temperatureBlock: "ອຸນຫະພູມ",
    conditionBlock: "ສະພາບອາກາດ",
    aqiBlock: "ຄຸນນະພາບອາກາດ",
    updatedOn: "ອັບເດດ",
    openAll: "ເປີດທັງໝົດ",
    viewMore: "ເບິ່ງເພີ່ມ",
    dataPending: "ສ້າງຈາກຂໍ້ມູນອາກາດຈິງ, ໝວດທີ່ເດັ່ນ ແລະ ຄວາມພ້ອມຂອງຂໍ້ມູນການເດີນທາງ.",
    publishedPlaces: "ສະຖານທີ່ທີ່ອະນຸມັດແລະເຜີຍແຜ່ແລ້ວ",
    transportReady: "ຂໍ້ມູນການເດີນທາງທີ່ພ້ອມໃຊ້ສາທາລະນະ",
  },
};

function getDecisionCopy(lang) {
  return DECISION_COPY[normalizeLang(lang)] || DECISION_COPY.en;
}

function formatUpdatedAt(value, lang) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat(LOCALE_MAP[lang] || "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function roundValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function getEventCardItems(events, total = 5) {
  const realItems = (Array.isArray(events) ? events : []).slice(0, total);
  const items = [...realItems];
  for (let index = realItems.length; index < total; index += 1) {
    items.push({
      id: `placeholder-${index + 1}`,
      title: "Event update coming soon",
      image: "/empty-event-art.svg",
      isPlaceholder: true,
    });
  }
  return items;
}

function buildPlaceHref(lang, place) {
  if (!place?.category || !place?.slug) return null;
  return `/${lang}/${place.category}/${place.slug}`;
}

function hasAnyKeyword(text, keywords) {
  const source = String(text || "").toLowerCase();
  return keywords.some((keyword) => source.includes(keyword));
}

function parseDecisionTagList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getDecisionTags(item, field) {
  const listField = `${field}_list`;
  const list = parseDecisionTagList(item?.[listField]);
  if (list.length) return list;
  return parseDecisionTagList(item?.[field]);
}

function getFeaturedScore(item) {
  const score = Number(item?.decision_featured_score);
  return Number.isFinite(score) ? score : 0;
}

function sortByFeaturedThenRecent(items) {
  return [...items].sort((a, b) => {
    const scoreDiff = getFeaturedScore(b) - getFeaturedScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function pickUniquePlaces(groups, limit = 3) {
  const seen = new Set();
  const out = [];

  for (const group of groups) {
    for (const item of group) {
      const id = Number(item?.id || 0);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
      if (out.length >= limit) return out;
    }
  }

  return out;
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

function renderLinkList(items, activeLang, emptyText, limit = 3) {
  if (!items.length) {
    return <p className="text-sm text-[color:var(--muted)]">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {items.slice(0, limit).map((place, index) => {
        const href = buildPlaceHref(activeLang, place);
        const content = (
          <>
            <span className="home-number-chip">{index + 1}</span>
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-semibold leading-6 md:text-[15px]">
                {place.title || "-"}
              </p>
            </div>
          </>
        );

        if (!href) {
          return (
            <div key={`fallback-${place.id || index}`} className="flex items-start gap-3">
              {content}
            </div>
          );
        }

        return (
          <Link
            key={`linked-${place.id || index}`}
            href={href}
            className="flex items-start gap-3 transition hover:translate-x-1 hover:text-[color:var(--accent)]"
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

function renderSimpleLinkItems(items, activeLang, emptyText, limit = 3) {
  if (!items.length) {
    return <p className="text-sm text-[color:var(--muted)]">{emptyText}</p>;
  }

  return (
    <div className="space-y-0">
      {items.slice(0, limit).map((place, index) => {
        const href = buildPlaceHref(activeLang, place);
        const content = (
          <>
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--accent)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="line-clamp-2 text-sm font-medium leading-6 md:text-[15px]">
              {place.title || "-"}
            </span>
          </>
        );

        if (!href) {
          return (
            <div key={`simple-fallback-${place.id || index}`} className="editorial-list-line grid grid-cols-[44px_minmax(0,1fr)] gap-3 py-3">
              {content}
            </div>
          );
        }

        return (
          <Link
            key={`simple-linked-${place.id || index}`}
            href={href}
            className="editorial-list-line grid grid-cols-[44px_minmax(0,1fr)] gap-3 py-3 transition hover:translate-x-1 hover:text-[color:var(--accent)]"
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

export default async function LangHome({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const decisionCopy = getDecisionCopy(activeLang);

  const [events, weather, categoryRows] = await Promise.all([
    getEvents(activeLang),
    getUbonWeather(),
    Promise.all(CATEGORY_KEYS.map(async (category) => [category, await getPlaces(category, activeLang)])),
  ]);

  const placesByCategory = Object.fromEntries(
    categoryRows.map(([category, items]) => [
      category,
      (Array.isArray(items) ? items : []).map((item) => ({ ...item, category: item?.category || category })),
    ])
  );

  const decisionCategories = CATEGORY_KEYS.filter((key) => key !== "transport");
  const allPlaces = decisionCategories.flatMap((category) => placesByCategory[category] || []);
  const sortedPlaces = [...allPlaces].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));

  const latestEvents = events.slice(0, 5);
  const { topTenPlaces, topCafePlaces, eveningSpots, trendingPlaces } = buildHomeDecisionSelections({
    allPlaces,
    placesByCategory,
  });

  const scenarioPicks = {
    day_trip: pickUniquePlaces(
      [
        sortByFeaturedThenRecent(
          allPlaces.filter((place) => getDecisionTags(place, "decision_scenario_tags").includes("day-trip"))
        ),
        placesByCategory.attractions || [],
        placesByCategory.activities || [],
      ],
      3
    ),
    budget: pickUniquePlaces(
      [
        sortByFeaturedThenRecent(
          allPlaces.filter((place) => getDecisionTags(place, "decision_scenario_tags").includes("budget-500"))
        ),
        placesByCategory.restaurants || [],
        placesByCategory.cafes || [],
      ],
      3
    ),
    couple: pickUniquePlaces(
      [
        sortByFeaturedThenRecent(
          allPlaces.filter((place) => getDecisionTags(place, "decision_scenario_tags").includes("couple"))
        ),
        placesByCategory.cafes || [],
        placesByCategory.attractions || [],
      ],
      3
    ),
    family: pickUniquePlaces(
      [
        sortByFeaturedThenRecent(
          allPlaces.filter((place) => getDecisionTags(place, "decision_scenario_tags").includes("family"))
        ),
        placesByCategory.attractions || [],
        placesByCategory.activities || [],
        placesByCategory.hotels || [],
      ],
      3
    ),
  };

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

  const topCategory =
    decisionCategories
      .map((category) => ({ category, count: (placesByCategory[category] || []).length }))
      .sort((a, b) => b.count - a.count)[0] || { category: "attractions", count: 0 };

  const quickActions = decisionCopy.quickActions.map((action) => {
    const prebuiltHref = String(action?.href || "").trim();
    if (prebuiltHref) {
      return { label: action.label, href: `/${activeLang}/${prebuiltHref}` };
    }
    return {
      label: action.label,
      href: `/${activeLang}/${action.category}?scenario=${encodeURIComponent(action.scenario)}`,
    };
  });

  const publishedLayout = await getHomepageLayout(activeLang, "home");
  const resolvedBlocks = Array.isArray(publishedLayout?.resolved_blocks) && publishedLayout.resolved_blocks.length
    ? publishedLayout.resolved_blocks
    : resolveHomepageLayout({
        layout: publishedLayout,
        allPlaces,
        allEvents: events,
      });
  const usePublishedLayout = false;

  if (usePublishedLayout) {
    return (
      <HomepageLayoutRenderer
        blocks={resolvedBlocks}
        activeLang={activeLang}
        copy={copy}
        decisionCopy={decisionCopy}
        quickActions={quickActions}
        locale={LOCALE_MAP[activeLang] || "en-US"}
      />
    );
  }

  return (
    <section className="editorial-shell space-y-14 md:space-y-20">
      <div
        className="editorial-section home-hero hero-banner rounded-[24px] border border-orange-200 p-6 shadow-[0_22px_54px_rgba(91,37,43,0.18)] min-h-[520px] md:min-h-[680px] md:p-10"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(32,14,8,0.42), rgba(87,35,20,0.24)), url('/hero-uboncity.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
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
                <p className="mt-2 text-2xl font-semibold text-white">{temperature ?? "-"}°C</p>
                <p className="mt-1 text-sm text-white/80">{copy.weatherFeel}: {apparent ?? "-"}°C</p>
              </div>
              <div className="home-hero-stat rounded-[12px] p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/72">{decisionCopy.conditionBlock}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{weatherLabel}</p>
                <p className="mt-1 text-sm text-white/80">{copy.weatherRange}: {minTemp ?? "-"}°C - {maxTemp ?? "-"}°C</p>
              </div>
              <div className="home-hero-stat rounded-[12px] p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/72">{decisionCopy.aqiBlock}</p>
                <div className="mt-2">
                  <span className={`aqi-pill ${aqiToneClass}`}>{aqi ?? "-"} · {airLabel}</span>
                </div>
                <p className="mt-1 text-sm text-white/80">{copy.weatherWind}: {wind ?? "-"} km/h</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="editorial-section space-y-6">
        <div className="space-y-2">
          <p className="eyebrow-label">Selected</p>
          <h2 className="section-heading">{decisionCopy.selectedTitle}</h2>
          <p className="section-copy max-w-2xl">{decisionCopy.selectedSubtitle}</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.9fr)]">
          <article className="editorial-card home-clickable-surface group relative rounded-[20px] p-6 transition md:p-7">
            <Link
              href={`/${activeLang}/attractions`}
              aria-label={decisionCopy.selectedTop10}
              className="absolute inset-0 rounded-[20px]"
            />
            <div className="relative z-10 mb-3">
              <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{decisionCopy.selectedTop10}</h3>
            </div>
            <p className="relative z-10 mb-5 max-w-lg text-sm leading-7 text-[color:var(--muted)]">
              เริ่มจากรายการเด่นก่อน แล้วค่อยแตกไปยังหมวดหรือ scenario ที่ตรงโจทย์มากขึ้น
            </p>
            <div className="relative z-20">{renderLinkList(topTenPlaces, activeLang, copy.empty, 5)}</div>
          </article>

          <div className="grid gap-5">
            <article className="editorial-card home-clickable-surface group relative rounded-[20px] p-5 transition">
              <Link
                href={`/${activeLang}/cafes`}
                aria-label={decisionCopy.selectedCafe}
                className="absolute inset-0 rounded-[20px]"
              />
              <div className="relative z-10 mb-3">
                <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{decisionCopy.selectedCafe}</h3>
              </div>
              <div className="relative z-20">{renderSimpleLinkItems(topCafePlaces, activeLang, copy.empty)}</div>
            </article>

            <article className="editorial-card home-clickable-surface rounded-[20px] p-5">
              <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">{decisionCopy.selectedEvening}</h3>
              {renderSimpleLinkItems(eveningSpots, activeLang, copy.empty)}
            </article>
          </div>
        </div>
      </section>

      <section className="editorial-section space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
          <div className="space-y-2">
            <p className="eyebrow-label">Scenarios</p>
            <h2 className="section-heading">{decisionCopy.scenariosTitle}</h2>
          </div>
          <p className="section-copy max-w-2xl">{decisionCopy.scenariosSubtitle}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {decisionCopy.scenarios.map((scenario) => (
            <article key={scenario.key} className="editorial-card home-clickable-surface home-scenario-card group relative rounded-[18px] p-5 transition md:p-6">
              <Link
                href={`/${activeLang}/${scenario.href}`}
                aria-label={scenario.title}
                className="absolute inset-0 rounded-[18px]"
              />
              <div className="relative z-10 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow-label mb-2">{copy.siteTitle}</p>
                    <h3 className="text-xl font-semibold tracking-[-0.03em]">{scenario.title}</h3>
                  </div>
                </div>
                <p className="text-sm leading-7 text-[color:var(--muted)]">{scenario.description}</p>
                <div className="relative z-20 space-y-3">
                  {(scenarioPicks[scenario.key] || []).map((place, index) => {
                    const href = buildPlaceHref(activeLang, place);
                    if (!href) return null;
                    return (
                      <Link key={`${scenario.key}-${place.id}`} href={href} className="flex items-center gap-3 transition hover:translate-x-1 hover:text-[color:var(--accent)]">
                        <span className="home-number-chip">{index + 1}</span>
                        <span className="line-clamp-1 text-sm font-medium">{place.title || "-"}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="editorial-section space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
          <div className="space-y-2">
            <p className="eyebrow-label">Latest</p>
            <h2 className="section-heading">{decisionCopy.trendingTitle}</h2>
          </div>
          <p className="section-copy max-w-2xl">{decisionCopy.trendingSubtitle}</p>
        </div>
        {(() => {
          const eventCards = getEventCardItems(latestEvents, 5);
          const featured = eventCards[0];
          const secondary = eventCards.slice(1, 5);

          const renderEventCard = (event, className = "", isFeatured = false) => {
            const cardToneClass = isFeatured ? "is-featured" : "is-secondary";
            const media = (
              <div className={`home-event-media ${cardToneClass}`}>
                <img
                  src={String(event.image || "/empty-event-art.svg")}
                  alt={event.title || "Event"}
                  className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]"
                  loading="lazy"
                />
              </div>
            );

            const panel = (
              <div className={`home-event-panel ${cardToneClass}`}>
                {isFeatured ? (
                  <p className="text-sm font-bold text-[color:var(--theme-text)]">
                    {event.isPlaceholder
                      ? decisionCopy.trendingEvents
                      : formatUpdatedAt(event.approved_at || event.updated_at, activeLang)}
                  </p>
                ) : null}
                <h3 className={`line-clamp-2 font-semibold tracking-[-0.03em] text-[color:var(--theme-text)] ${isFeatured ? "mt-3 text-2xl md:text-[2rem]" : "text-sm md:text-[15px]"}`}>
                  {event.isPlaceholder ? copy.latestEventsEmpty : event.title || "-"}
                </h3>
                <span className={`home-event-arrow ${event.isPlaceholder ? "opacity-40" : ""}`} aria-hidden="true">
                  ›
                </span>
              </div>
            );

            if (event.isPlaceholder) {
              return (
                <article key={String(event.id)} className={`home-event-card ${className}`.trim()}>
                  {media}
                  {panel}
                </article>
              );
            }

            return (
              <Link
                key={event.id}
                href={`/${activeLang}/events/${event.id}`}
                className={`home-event-card group block ${className}`.trim()}
                aria-label={event.title || decisionCopy.trendingEvents}
              >
                {media}
                {panel}
              </Link>
            );
          };

          return (
            <div className="home-events-layout grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {renderEventCard(featured, "home-event-card--featured", true)}
              <div className="home-events-secondary-grid grid gap-6 sm:grid-cols-2">
                {secondary.map((event) => renderEventCard(event))}
              </div>
            </div>
          );
        })()}
      </section>

      <section className="editorial-section space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end">
          <div className="space-y-2">
            <p className="eyebrow-label">Explore</p>
            <h2 className="section-heading">{decisionCopy.exploreTitle}</h2>
          </div>
          <p className="section-copy max-w-2xl">{decisionCopy.exploreSubtitle}</p>
        </div>
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORY_KEYS.map((key) => (
            <Link
              key={key}
              href={`/${activeLang}/${key}`}
              className={`home-explore-link home-explore-link--${key} block p-5 text-base font-semibold text-[color:var(--theme-text)] md:px-5 md:py-6 md:text-lg`}
            >
              <span className="home-explore-content">
                <span className="eyebrow-label mb-2 block">Category</span>
                <span className="home-explore-name block">{copy.nav[key]}</span>
              </span>
              <span aria-hidden="true" className="home-explore-art" />
            </Link>
          ))}
        </div>
      </section>

      {false ? (
        <section className="editorial-section space-y-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end">
            <div className="space-y-2">
              <p className="eyebrow-label">Insight</p>
              <h2 className="section-heading">{decisionCopy.insightsTitle}</h2>
            </div>
            <p className="section-copy max-w-2xl">{decisionCopy.insightsSubtitle}</p>
          </div>
          <div className="home-insight-layout grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
            <article className="home-insight-weather editorial-panel p-6 md:p-7">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[color:var(--accent)]">
                {decisionCopy.weatherBlock}
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
                <p className="text-4xl font-semibold tracking-[-0.04em] md:text-5xl">
                  {temperature ?? "-"}°C
                </p>
                <p className="pb-1 text-lg font-medium text-[color:var(--muted)]">{weatherLabel}</p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="home-insight-mini rounded-[12px] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--accent)]">
                    {copy.weatherFeel}
                  </p>
                  <p className="mt-2 text-base font-semibold">{apparent ?? "-"}°C</p>
                </div>
                <div className="home-insight-mini rounded-[12px] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--accent)]">
                    {copy.weatherRange}
                  </p>
                  <p className="mt-2 text-base font-semibold">{minTemp ?? "-"}°C - {maxTemp ?? "-"}°C</p>
                </div>
                <div className="home-insight-mini rounded-[12px] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--accent)]">
                    {copy.weatherWind}
                  </p>
                  <p className="mt-2 text-base font-semibold">{wind ?? "-"} km/h</p>
                </div>
                <div className="home-insight-mini rounded-[12px] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--accent)]">AQI</p>
                  <p className="mt-2 text-base font-semibold">
                    <span className={`aqi-pill ${aqiToneClass}`}>{aqi ?? "-"} · {airLabel}</span>
                  </p>
                </div>
              </div>
            </article>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              <article className="home-insight-fact editorial-card p-5">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">Top Category</p>
                <p className="mt-2 text-lg font-semibold">{copy.nav[topCategory.category] || topCategory.category}</p>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{topCategory.count} รายการพร้อมแสดงผล</p>
              </article>
              <article className="home-insight-fact editorial-card p-5">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">Published</p>
                <p className="mt-2 text-lg font-semibold">{allPlaces.length}</p>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{decisionCopy.publishedPlaces}</p>
              </article>
              <article className="home-insight-fact editorial-card p-5">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--accent)]">Transport</p>
                <p className="mt-2 text-lg font-semibold">{(placesByCategory.transport || []).length}</p>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{decisionCopy.transportReady}</p>
              </article>
            </div>
          </div>
          <p className="section-copy max-w-3xl">{decisionCopy.dataPending}</p>
        </section>
      ) : null}
    </section>
  );
}


