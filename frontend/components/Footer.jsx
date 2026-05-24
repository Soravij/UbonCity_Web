import Link from "next/link";
import { getLangContent, normalizeLang } from "@/lib/site";

export default function Footer({ lang = "en" }) {
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer-shell">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 px-4 py-7 md:flex-row md:items-center md:justify-between md:px-8">
        <p className="text-sm">Copyright {year} UbonCity.com · Contact Number +66 64 985 0555</p>
        <div className="flex items-center gap-4 text-sm">
          <Link href={`/${activeLang}/contact`} className="footer-link site-contact-link font-semibold transition">
            {copy.contactUs}
          </Link>
        </div>
      </div>
    </footer>
  );
}
