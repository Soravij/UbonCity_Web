import Link from "next/link";
import { getLangContent, normalizeLang } from "@/lib/site";

export default function Footer({ lang = "en" }) {
  const activeLang = normalizeLang(lang);
  const copy = getLangContent(activeLang);
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-orange-200/70 bg-white/55 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-7 md:flex-row md:items-center md:justify-between md:px-8">
        <p className="text-sm text-[color:var(--theme-text-muted)]">
          Copyright {year} UbonCity.com · Contact Number +66 64 985 0555
        </p>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href={`/${activeLang}/contact`}
            className="footer-link site-contact-link font-semibold text-[color:var(--theme-text)] transition hover:text-[color:var(--theme-primary-strong)]"
          >
            {copy.contactUs}
          </Link>
        </div>
      </div>
    </footer>
  );
}
