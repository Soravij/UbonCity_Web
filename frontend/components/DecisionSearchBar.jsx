"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

function normalizeInput(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveDecisionRoute(lang, query) {
  const text = normalizeInput(query);

  if (!text) return `/${lang}/attractions`;
  if (text.includes("คาเฟ") || text.includes("cafe") || text.includes("coffee")) return `/${lang}/cafes`;
  if (text.includes("ร้านอาหาร") || text.includes("อาหาร") || text.includes("restaurant") || text.includes("food")) {
    return `/${lang}/restaurants`;
  }
  if (text.includes("โรงแรม") || text.includes("hotel")) return `/${lang}/hotels`;
  if (
    text.includes("เดินทาง") ||
    text.includes("รถ") ||
    text.includes("route") ||
    text.includes("bus") ||
    text.includes("transport")
  ) {
    return `/${lang}/transport`;
  }
  if (text.includes("กิจกรรม") || text.includes("activity")) return `/${lang}/activities`;
  if (text.includes("งบ") || text.includes("budget")) return `/${lang}/restaurants?scenario=budget-500`;
  if (text.includes("แฟน") || text.includes("couple")) return `/${lang}/cafes?scenario=couple`;
  if (text.includes("ครอบครัว") || text.includes("family")) return `/${lang}/attractions?scenario=family`;
  return `/${lang}/attractions`;
}

export default function DecisionSearchBar({
  lang,
  placeholder,
  submitLabel,
  quickActions = [],
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function onSubmit(event) {
    event.preventDefault();
    const term = String(query || "").trim();
    const route = resolveDecisionRoute(lang, term);
    if (!term) {
      router.push(route);
      return;
    }

    const hasQuery = route.includes("?");
    router.push(`${route}${hasQuery ? "&" : "?"}q=${encodeURIComponent(term)}`);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="filter-shell flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-2xl border border-transparent bg-transparent px-4 py-3 text-sm tracking-[0.012em] text-[color:var(--theme-text)] outline-none placeholder:tracking-[0.01em] placeholder:text-[color:var(--theme-text-muted)] focus:border-[color:var(--theme-primary)] focus:bg-white/70 focus:ring-2 focus:ring-[color:var(--theme-primary)]/20"
          aria-label={placeholder}
        />
        <button
          type="submit"
          className="rounded-2xl border border-[color:var(--theme-primary)] bg-[color:var(--theme-primary)] px-5 py-3 text-sm font-semibold tracking-[0.012em] text-white shadow-[0_10px_18px_color-mix(in_srgb,var(--theme-primary)_28%,transparent)] transition hover:bg-[color:var(--theme-primary-strong)]"
        >
          {submitLabel}
        </button>
      </form>

      <div className="flex flex-wrap gap-2.5">
        {quickActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="interactive-tile rounded-full px-3.5 py-2 text-xs font-semibold tracking-[0.012em] text-[color:var(--theme-text)] transition hover:-translate-y-0.5"
          >
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
