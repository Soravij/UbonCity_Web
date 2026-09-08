import CollectionPlacesPage from "@/components/CollectionPlacesPage";
import { getCollectionDetail } from "@/lib/api";
import { normalizeLang } from "@/lib/site";

export async function generateMetadata({ params }) {
  const { lang, slug } = await params;
  const activeLang = normalizeLang(lang);
  const item = await getCollectionDetail("situations", slug, activeLang);
  const titleBase = String(item?.title || "Situation").trim();

  return {
    title: `${titleBase} | UBONCITY.COM`,
    description: item?.description || "",
    alternates: {
      canonical: `/${activeLang}/situation/${slug}`,
    },
  };
}

export default async function Page({ params }) {
  const { lang, slug } = await params;
  return <CollectionPlacesPage kind="situations" lang={lang} slug={slug} />;
}
