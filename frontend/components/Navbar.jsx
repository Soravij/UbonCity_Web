import Link from "next/link";
import { CATEGORY_KEYS, getLangContent } from "@/lib/site";
import LanguageSwitch from "./LanguageSwitch";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="currentColor"
        d="M12 3.2 3 10.7l1.3 1.5L5.5 11v9.8h5.7v-5.6h1.6v5.6h5.7V11l1.2 1.2 1.3-1.5z"
      />
    </svg>
  );
}

export default function Navbar({ lang }) {
  const copy = getLangContent(lang);

  return (
    <header className="sticky top-0 z-30 border-b border-[#a66667] bg-[#C08081]/95 shadow-[0_6px_16px_rgba(120,70,71,0.22)] backdrop-blur">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 text-sm text-[#4B0150] md:px-8">
        <Link
          href={`/${lang}`}
          aria-label="Home"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#4B0150]/20 bg-white/55 text-[#4B0150] shadow-sm transition-all duration-300 hover:bg-white/90 hover:shadow-[0_10px_20px_rgba(75,1,80,0.2)]"
        >
          <HomeIcon />
        </Link>

        <Link
          href={`/${lang}`}
          className="shrink-0 whitespace-nowrap text-base font-bold tracking-[0.04em] text-[#4B0150] transition-all duration-300 hover:text-[#6a2a70] md:text-lg"
        >
          UbonCity.com
        </Link>

        <div className="mx-2 flex-1 overflow-x-auto py-1">
          <div className="flex min-w-max items-center justify-center gap-2">
            {CATEGORY_KEYS.map((key) => (
              <Link
                key={key}
                href={`/${lang}/${key}`}
                className="shrink-0 whitespace-nowrap rounded-full border border-[#4B0150]/15 bg-white/45 px-3 py-1.5 font-medium text-[#4B0150] shadow-sm transition-all duration-300 hover:bg-white/90 hover:shadow-[0_10px_18px_rgba(75,1,80,0.2)]"
              >
                {copy.nav[key]}
              </Link>
            ))}
          </div>
        </div>

        <div className="shrink-0">
          <LanguageSwitch />
        </div>
      </nav>
    </header>
  );
}
