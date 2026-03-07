import Script from "next/script";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { normalizeLang } from "@/lib/site";

export default async function LangLayout({ children, params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);

  return (
    <div className="min-h-screen notranslate" lang={activeLang} translate="no">
      <Script id="html-lang-sync" strategy="beforeInteractive">
        {`document.documentElement.lang="${activeLang}";document.documentElement.setAttribute("translate","no");`}
      </Script>
      <Navbar lang={activeLang} />
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
      <Footer />
    </div>
  );
}
