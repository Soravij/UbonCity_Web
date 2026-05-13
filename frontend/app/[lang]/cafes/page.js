import CategoryPage from "@/components/CategoryPage";
import { getLangContent, normalizeLang } from "@/lib/site";

export async function generateMetadata({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const title = copy?.nav?.cafes || "Cafes";

  return {
    title: `${title} | UBONCITY.COM`,
    description: `Ubon Ratchathani ${title}`,
    alternates: {
      canonical: `/${activeLang}/cafes`,
    },
  };
}

export default async function Cafes({ params, searchParams }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="cafes" searchParams={await searchParams} />;
}
