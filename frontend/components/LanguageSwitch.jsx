"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SUPPORTED_LANGS } from "@/lib/site";

const labels = {
  en: "English",
  th: "ไทย",
  zh: "中文",
  lo: "ລາວ",
};

export default function LanguageSwitch() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const { currentLang, rest } = useMemo(() => {
    const parts = String(pathname || "").split("/").filter(Boolean);
    const lang = SUPPORTED_LANGS.includes(parts[0]) ? parts[0] : "en";
    const tail = SUPPORTED_LANGS.includes(parts[0]) ? parts.slice(1).join("/") : parts.join("/");
    return { currentLang: lang, rest: tail };
  }, [pathname]);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Open language menu"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#4B0150]/20 bg-white/55 px-3 text-[#4B0150] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-100 hover:shadow-[0_10px_20px_rgba(75,1,80,0.2)]"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">🌐</span>
        <span className="text-xs font-semibold uppercase tracking-[0.04em]">Lang</span>
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-40 min-w-36 overflow-hidden rounded-xl border border-[#4B0150]/20 bg-white shadow-lg">
          {SUPPORTED_LANGS.map((lang) => {
            const href = rest ? `/${lang}/${rest}` : `/${lang}`;
            const isActive = lang === currentLang;

            return (
              <Link
                key={lang}
                href={href}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2 text-sm transition-all duration-300 ${
                  isActive
                    ? "bg-orange-100 font-semibold text-[#4B0150]"
                    : "text-[#4B0150] hover:bg-gray-100 hover:pl-4"
                }`}
              >
                {labels[lang] || lang.toUpperCase()}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
