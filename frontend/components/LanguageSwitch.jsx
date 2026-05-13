"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SUPPORTED_LANGS } from "@/lib/site";

const options = {
  en: { label: "English", flag: "gb" },
  th: { label: "ไทย", flag: "th" },
  zh: { label: "中文", flag: "cn" },
  lo: { label: "ລາວ", flag: "la" },
};

function FlagIcon({ code }) {
  if (code === "th") {
    return (
      <svg viewBox="0 0 18 12" aria-hidden="true" className="site-flag-svg">
        <rect width="18" height="12" rx="2" fill="#fff" />
        <rect width="18" height="2.4" y="0" fill="#c81e2b" />
        <rect width="18" height="2.4" y="9.6" fill="#c81e2b" />
        <rect width="18" height="3.4" y="4.3" fill="#233a8b" />
      </svg>
    );
  }

  if (code === "cn") {
    return (
      <svg viewBox="0 0 18 12" aria-hidden="true" className="site-flag-svg">
        <rect width="18" height="12" rx="2" fill="#de2910" />
        <path d="M4.1 2.1l.4 1.1h1.2l-.9.7.4 1.1-.9-.7-.9.7.3-1.1-.9-.7h1.2z" fill="#ffde00" />
      </svg>
    );
  }

  if (code === "la") {
    return (
      <svg viewBox="0 0 18 12" aria-hidden="true" className="site-flag-svg">
        <rect width="18" height="12" rx="2" fill="#ce1126" />
        <rect width="18" height="6" y="3" fill="#002868" />
        <circle cx="9" cy="6" r="2.1" fill="#fff" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 18 12" aria-hidden="true" className="site-flag-svg">
      <rect width="18" height="12" rx="2" fill="#012169" />
      <rect x="7" width="4" height="12" fill="#fff" />
      <rect y="4" width="18" height="4" fill="#fff" />
      <rect x="7.7" width="2.6" height="12" fill="#cf142b" />
      <rect y="4.7" width="18" height="2.6" fill="#cf142b" />
    </svg>
  );
}

export default function LanguageSwitch() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const { currentLang, rest } = useMemo(() => {
    const parts = String(pathname || "").split("/").filter(Boolean);
    const lang = SUPPORTED_LANGS.includes(parts[0]) ? parts[0] : "en";
    const tail = SUPPORTED_LANGS.includes(parts[0]) ? parts.slice(1).join("/") : parts.join("/");
    return { currentLang: lang, rest: tail };
  }, [pathname]);

  const currentOption = options[currentLang] || options.en;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Open language menu"
        className="site-lang-trigger inline-flex h-10 items-center gap-2 rounded-2xl border px-3 transition-all duration-300"
        onClick={() => setOpen((prev) => !prev)}
      >
        <FlagIcon code={currentOption.flag} />
        <span className={`site-lang-caret ${open ? "is-open" : ""}`} aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="site-lang-menu absolute right-0 top-12 z-40 min-w-56 overflow-hidden rounded-[24px] border">
          <div className="site-lang-menu-header px-4 pb-2 pt-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--theme-text-muted)]">
              Language
            </p>
          </div>
          {SUPPORTED_LANGS.map((lang) => {
            const href = rest ? `/${lang}/${rest}` : `/${lang}`;
            const isActive = lang === currentLang;
            const option = options[lang] || { label: lang.toUpperCase(), flag: "gb" };

            return (
              <Link
                key={lang}
                href={href}
                onClick={() => setOpen(false)}
                className={`site-lang-item flex items-center gap-3 px-4 py-3 text-sm transition-all duration-300 ${
                  isActive ? "is-active" : ""
                }`}
              >
                <FlagIcon code={option.flag} />
                <span className={`min-w-0 flex-1 ${isActive ? "font-semibold" : "font-medium"}`}>
                  {option.label}
                </span>
                <span className={`site-lang-check ${isActive ? "is-visible" : ""}`} aria-hidden="true">
                  ✓
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
