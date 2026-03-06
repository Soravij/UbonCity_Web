import CategoryPage from "@/components/CategoryPage";

export default async function Transport({ params }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="transport" />;
}
