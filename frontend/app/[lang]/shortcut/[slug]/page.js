import CollectionPlacesPage from "@/components/CollectionPlacesPage";
import { getCollectionDetail } from "@/lib/api";
import { normalizeLang } from "@/lib/site";

export async function generateMetadata({ params }) {
  const { lang, slug } = await params;
  const activeLang = normalizeLang(lang);
  const item = await getCollectionDetail("shortcuts", slug, activeLang);
  const titleBase = String(item?.title || "Shortcut").trim();

  return {
    title: `${titleBase} | UBONCITY.COM`,
    description: item?.description || "",
    alternates: {
      canonical: `/${activeLang}/shortcut/${slug}`,
    },
  };
}

export default async function Page({ params }) {
  const { lang, slug } = await params;
  return <CollectionPlacesPage kind="shortcuts" lang={lang} slug={slug} />;
}
