import CategoryPage from "@/components/CategoryPage";

export default async function Restaurants({ params }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="restaurants" />;
}
