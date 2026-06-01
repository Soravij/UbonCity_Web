import Card from "@/components/Card";
import { getPlaces } from "@/lib/api";
import { normalizeLang } from "@/lib/site";

const PAGE_COPY = {
  en: {
    title: "Transport",
    lead: "Browse public transport and practical transport services from one page.",
    mapTitle: "Public Transport Map",
    mapDescription: "View all public transport routes together on one interactive map.",
    mapCta: "Open Public Transport Map",
    otherTitle: "Other Transport",
    otherDescription: "Taxi, rentals, shuttle, and other transport services.",
    empty: "No other transport listings yet.",
  },
  th: {
    title: "การเดินทาง",
    lead: "รวมแผนที่ขนส่งสาธารณะและบริการเดินทางอื่นไว้ในหน้าเดียว",
    mapTitle: "Public Transport Map",
    mapDescription: "ดูทุกเส้นทางขนส่งสาธารณะรวมกันในแผนที่แบบโต้ตอบหน้าเดียว",
    mapCta: "เปิด Public Transport Map",
    otherTitle: "บริการเดินทางอื่น",
    otherDescription: "แท็กซี่ รถเช่า รถรับส่ง และข้อมูลเดินทางอื่นที่ใช้งานได้จริง",
    empty: "ยังไม่มีรายการ Other Transport",
  },
  zh: {
    title: "交通",
    lead: "在一个页面查看公共交通地图与其他交通服务。",
    mapTitle: "公共交通地图",
    mapDescription: "在一个交互式地图页面中查看全部公共交通线路。",
    mapCta: "打开公共交通地图",
    otherTitle: "其他交通",
    otherDescription: "出租车、租车、接驳与其他交通服务。",
    empty: "暂无其他交通内容。",
  },
  lo: {
    title: "ການເດີນທາງ",
    lead: "ລວມແຜນທີ່ຂົນສົ່ງສາທາລະນະ ແລະ ບໍລິການເດີນທາງອື່ນໄວ້ໃນໜ້າດຽວ",
    mapTitle: "ແຜນທີ່ຂົນສົ່ງສາທາລະນະ",
    mapDescription: "ເບິ່ງທຸກເສັ້ນທາງຂົນສົ່ງສາທາລະນະໃນແຜນທີ່ interactive ໜ້າດຽວ",
    mapCta: "ເປີດແຜນທີ່ຂົນສົ່ງສາທາລະນະ",
    otherTitle: "ບໍລິການເດີນທາງອື່ນ",
    otherDescription: "Taxi, rental, shuttle ແລະ ຂໍ້ມູນເດີນທາງອື່ນ",
    empty: "ຍັງບໍ່ມີລາຍການ Other Transport",
  },
};

export async function generateMetadata({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = PAGE_COPY[activeLang] || PAGE_COPY.en;
  return {
    title: "Transport | UBONCITY.COM",
    description: copy.lead,
    alternates: {
      canonical: `/${activeLang}/transport`,
    },
  };
}

export default async function Transport({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = PAGE_COPY[activeLang] || PAGE_COPY.en;
  const transportItems = await getPlaces("transport", activeLang);

  return (
    <div className="space-y-8 md:space-y-10">
      <section className="editorial-section">
        <article className="editorial-panel p-5 md:p-6">
          <div className="space-y-3">
            <p className="eyebrow-label">Transport</p>
            <h1 className="section-heading">{copy.title}</h1>
            <p className="editorial-subtitle max-w-3xl">{copy.lead}</p>
          </div>
        </article>
      </section>

      <section className="editorial-section space-y-4">
        <div className="space-y-2">
          <p className="eyebrow-label">Other Transport</p>
          <h2 className="section-heading">{copy.otherTitle}</h2>
          <p className="editorial-subtitle max-w-3xl">{copy.otherDescription}</p>
        </div>

        {transportItems.length ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {transportItems.map((item) => (
              <Card key={`${item.category}-${item.slug}`} place={item} lang={activeLang} />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-orange-300 bg-white p-5 text-sm text-[color:var(--muted)] md:p-6">
            {copy.empty}
          </p>
        )}
      </section>
    </div>
  );
}
