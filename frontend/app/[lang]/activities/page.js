import CategoryPage from "@/components/CategoryPage";

export default async function Activities({ params }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="activities" />;
}
