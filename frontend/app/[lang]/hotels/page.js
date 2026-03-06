import CategoryPage from "@/components/CategoryPage";

export default async function Hotels({ params }) {
  const { lang } = await params;
  return <CategoryPage lang={lang} category="hotels" />;
}
