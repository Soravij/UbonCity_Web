import Link from "next/link";
import { getLangContent, normalizeLang } from "@/lib/site";

const CONTACT_COPY = {
  en: {
    eyebrow: "Contact",
    title: "Talk to UbonCity directly.",
    subtitle:
      "Use this page for partnerships, listing updates, content corrections, and local coordination related to UbonCity.",
    primaryCta: "Call Now",
    secondaryCta: "Back Home",
    fastest: "Fastest channel",
    phoneLabel: "Phone",
    noteTitle: "What to contact us about",
    noteBody:
      "Partnerships, listing updates, content corrections, transport information, or questions about local coverage.",
    availabilityTitle: "Current setup",
    availabilityBody:
      "The fastest contact channel right now is phone. More contact options can be added later without changing this page structure.",
    cards: [
      {
        title: "Partnerships",
        body: "Reach out for local collaborations, tourism campaigns, and venue partnerships.",
      },
      {
        title: "Listing Updates",
        body: "Send corrections or missing details if a place, event, or route needs to be updated.",
      },
      {
        title: "Local Coordination",
        body: "Use this contact point for practical questions tied to Ubon travel information.",
      },
    ],
  },
  th: {
    eyebrow: "ติดต่อ",
    title: "คุยกับ UbonCity ได้ตรงนี้",
    subtitle:
      "ใช้หน้านี้สำหรับติดต่อเรื่องพาร์ตเนอร์ แก้ไขข้อมูลสถานที่ อัปเดตเนื้อหา หรือประสานงานที่เกี่ยวกับ UbonCity",
    primaryCta: "โทรเลย",
    secondaryCta: "กลับหน้าแรก",
    fastest: "ช่องทางที่เร็วที่สุด",
    phoneLabel: "โทรศัพท์",
    noteTitle: "เรื่องที่ติดต่อได้",
    noteBody:
      "พาร์ตเนอร์ธุรกิจ การแก้ไขข้อมูลสถานที่/อีเวนต์ การอัปเดตข้อมูลการเดินทาง หรือคำถามเกี่ยวกับเนื้อหาในเว็บ",
    availabilityTitle: "สถานะตอนนี้",
    availabilityBody:
      "ตอนนี้ช่องทางที่เร็วที่สุดคือการโทร หากต้องเพิ่มช่องทางอื่นภายหลัง หน้านี้ยังใช้โครงเดิมต่อได้",
    cards: [
      {
        title: "Partnerships",
        body: "ติดต่อสำหรับความร่วมมือด้านท่องเที่ยว แคมเปญท้องถิ่น และการร่วมงานกับสถานประกอบการ",
      },
      {
        title: "Listing Updates",
        body: "แจ้งแก้ข้อมูลหรือรายละเอียดที่ตกหล่นของสถานที่ อีเวนต์ หรือเส้นทางได้ที่นี่",
      },
      {
        title: "Local Coordination",
        body: "ใช้สำหรับประสานงานหรือสอบถามเรื่องข้อมูลท่องเที่ยวอุบลที่อยู่บนเว็บ",
      },
    ],
  },
  zh: {
    eyebrow: "联系",
    title: "直接联系 UbonCity。",
    subtitle: "本页用于合作洽谈、内容修正、地点更新，以及与 UbonCity 相关的本地协调。",
    primaryCta: "立即拨打",
    secondaryCta: "返回首页",
    fastest: "最快渠道",
    phoneLabel: "电话",
    noteTitle: "可以联系的事项",
    noteBody: "合作、地点或活动信息修正、交通资料更新，以及与本地内容相关的问题。",
    availabilityTitle: "当前方式",
    availabilityBody: "目前最快的联系渠道是电话。之后若新增其他渠道，这个页面结构仍可继续使用。",
    cards: [
      {
        title: "合作",
        body: "适用于本地旅游合作、宣传活动，以及场地合作沟通。",
      },
      {
        title: "信息更新",
        body: "若地点、活动或路线资料需要修正或补充，可通过这里联系。",
      },
      {
        title: "本地协调",
        body: "用于处理与乌汶旅游信息相关的实际问题与沟通。",
      },
    ],
  },
  lo: {
    eyebrow: "ຕິດຕໍ່",
    title: "ຕິດຕໍ່ UbonCity ໄດ້ໂດຍກົງ",
    subtitle:
      "ໜ້ານີ້ໃຊ້ສຳລັບພາກສ່ວນຮ່ວມ, ການແກ້ໄຂຂໍ້ມູນ, ອັບເດດລາຍການ, ແລະ ການປະສານງານທ້ອງຖິ່ນຂອງ UbonCity",
    primaryCta: "ໂທເລີຍ",
    secondaryCta: "ກັບໜ້າຫຼັກ",
    fastest: "ຊ່ອງທາງທີ່ໄວສຸດ",
    phoneLabel: "ໂທລະສັບ",
    noteTitle: "ເລື່ອງທີ່ຕິດຕໍ່ໄດ້",
    noteBody:
      "ການຮ່ວມມື, ການແກ້ໄຂຂໍ້ມູນສະຖານທີ່/ອີເວັນ, ອັບເດດຂໍ້ມູນການເດີນທາງ, ຫຼື ຄຳຖາມກ່ຽວກັບເນື້ອຫາ",
    availabilityTitle: "ສະຖານະປັດຈຸບັນ",
    availabilityBody:
      "ຕອນນີ້ຊ່ອງທາງທີ່ໄວສຸດແມ່ນການໂທ. ຖ້າຈະເພີ່ມຊ່ອງທາງອື່ນພາຍຫຼັງ ໂຄງໜ້ານີ້ຍັງໃຊ້ຕໍ່ໄດ້",
    cards: [
      {
        title: "Partnerships",
        body: "ສຳລັບຄວາມຮ່ວມມືດ້ານທ່ອງທ່ຽວ ແຄມເປນ ແລະ ການຮ່ວມງານກັບສະຖານປະກອບການ",
      },
      {
        title: "Listing Updates",
        body: "ໃຊ້ເພື່ອແຈ້ງແກ້ໄຂ ຫຼື ເພີ່ມຂໍ້ມູນຂອງສະຖານທີ່, ອີເວັນ, ຫຼື ເສັ້ນທາງ",
      },
      {
        title: "Local Coordination",
        body: "ໃຊ້ສຳລັບການປະສານງານ ແລະ ຄຳຖາມທີ່ກ່ຽວກັບຂໍ້ມູນທ່ອງທ່ຽວອຸບົນ",
      },
    ],
  },
};

function getContactCopy(lang) {
  return CONTACT_COPY[normalizeLang(lang)] || CONTACT_COPY.en;
}

export default async function ContactPage({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const contact = getContactCopy(activeLang);

  return (
    <section className="editorial-shell space-y-8 md:space-y-10">
      <section
        className="contact-hero editorial-section overflow-hidden rounded-[24px]"
        style={{ backgroundImage: "url('/hero-uboncity.jpg')" }}
      >
        <div className="contact-hero-overlay px-5 py-8 md:px-8 md:py-10">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:items-end">
            <div className="space-y-5">
              <p className="hero-banner-eyebrow editorial-kicker">{contact.eyebrow}</p>
              <h1 className="hero-banner-title editorial-title max-w-3xl">{contact.title}</h1>
              <p className="hero-banner-copy editorial-subtitle max-w-2xl">{contact.subtitle}</p>
              <div className="flex flex-wrap gap-3 pt-2">
                <a
                  href="tel:+66649850555"
                  className="contact-primary-cta inline-flex items-center justify-center rounded-[12px] px-5 py-3 text-sm font-semibold"
                >
                  {contact.primaryCta}
                </a>
                <Link
                  href={`/${activeLang}`}
                  className="contact-secondary-cta inline-flex items-center justify-center rounded-[12px] px-5 py-3 text-sm font-semibold"
                >
                  {contact.secondaryCta}
                </Link>
              </div>
            </div>

            <aside className="contact-side-panel editorial-panel p-5 md:p-6">
              <p className="eyebrow-label">{contact.fastest}</p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[color:var(--accent)]">
                    {contact.phoneLabel}
                  </p>
                  <a href="tel:+66649850555" className="mt-2 block text-2xl font-semibold tracking-[-0.03em]">
                    +66 64 985 0555
                  </a>
                </div>
                <div className="section-copy space-y-2">
                  <p>{contact.noteBody}</p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="editorial-section grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article className="editorial-panel p-6 md:p-7">
          <p className="eyebrow-label">{copy.siteTitle}</p>
          <h2 className="section-heading mt-3">{contact.availabilityTitle}</h2>
          <p className="section-copy mt-4 max-w-xl">{contact.availabilityBody}</p>
        </article>

        <div className="grid gap-4 md:grid-cols-3">
          {contact.cards.map((item) => (
            <article key={item.title} className="editorial-card p-5">
              <p className="eyebrow-label">Contact</p>
              <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em]">{item.title}</h3>
              <p className="section-copy mt-3">{item.body}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
