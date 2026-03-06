import CategoryPage from "@/components/CategoryPage";

export default async function Cafes({ params }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="cafes" />;
}
