import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { normalizeLang } from "@/lib/site";

export default async function LangLayout({ children, params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);

  return (
    <div className="page-frame min-h-screen notranslate" lang={activeLang} translate="no">
      <Navbar lang={activeLang} />
      <main className="page-stack mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">{children}</main>
      <Footer lang={activeLang} />
    </div>
  );
}
