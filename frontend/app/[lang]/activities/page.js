import CategoryPage from "@/components/CategoryPage";
import { getLangContent, normalizeLang } from "@/lib/site";

export async function generateMetadata({ params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const title = copy?.nav?.activities || "Activities";

  return {
    title: `${title} | UBONCITY.COM`,
    description: `Ubon Ratchathani ${title}`,
    alternates: {
      canonical: `/${activeLang}/activities`,
    },
  };
}

export default async function Activities({ params, searchParams }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="activities" searchParams={await searchParams} />;
}
