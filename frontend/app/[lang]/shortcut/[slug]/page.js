import CollectionPlacesPage, { pickTranslation } from "@/components/CollectionPlacesPage";
import { getCollectionDetail } from "@/lib/api";
import { normalizeLang } from "@/lib/site";

export async function generateMetadata({ params }) {
  const { lang, slug } = await params;
  const activeLang = normalizeLang(lang);
  const item = await getCollectionDetail("shortcuts", slug, activeLang);
  const tr = pickTranslation(item, activeLang);
  const titleBase = String(tr.title || "Shortcut").trim();

  return {
    title: `${titleBase} | UBONCITY.COM`,
    description: tr.description || "",
    alternates: {
      canonical: `/${activeLang}/shortcut/${slug}`,
    },
  };
}

export default async function Page({ params }) {
  const { lang, slug } = await params;
  return <CollectionPlacesPage kind="shortcuts" lang={lang} slug={slug} label="Shortcut" />;
}
