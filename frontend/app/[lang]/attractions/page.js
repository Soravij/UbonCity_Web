import CategoryPage from "@/components/CategoryPage";

export default async function Attractions({ params }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="attractions" />;
}
