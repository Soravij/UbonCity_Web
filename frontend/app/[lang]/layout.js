import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { normalizeLang } from "@/lib/site";

export default async function LangLayout({ children, params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);

  return (
    <div className="min-h-screen">
      <Navbar lang={activeLang} />
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
      <Footer />
    </div>
  );
}
