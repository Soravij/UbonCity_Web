import CategoryPage from "@/components/CategoryPage";
import { getLangContent, normalizeLang } from "@/lib/site";

export async function generateMetadata({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const title = copy?.nav?.hotels || "Hotels";

  return {
    title: `${title} | UBONCITY.COM`,
    description: `Ubon Ratchathani ${title}`,
    alternates: {
      canonical: `/${activeLang}/hotels`,
    },
  };
}

export default async function Hotels({ params, searchParams }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="hotels" searchParams={await searchParams} />;
}
