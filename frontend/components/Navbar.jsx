"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_KEYS, getLangContent } from "@/lib/site";
import LanguageSwitch from "./LanguageSwitch";
import ThemeModeControl from "./ThemeModeControl";

export default function Navbar({ lang, variant = "default" }) {
  const copy = getLangContent(lang);
  const pathname = usePathname();
  const desktopMenuRef = useRef(null);
  const itemRefs = useRef(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [overlayScrolled, setOverlayScrolled] = useState(false);
  const isOverlay = variant === "overlay";

  const activeKey = useMemo(() => {
    const parts = String(pathname || "").split("/").filter(Boolean);
    if (parts[0] !== lang) return "";
    const category = parts[1] || "";
    return CATEGORY_KEYS.includes(category) ? category : "";
  }, [lang, pathname]);

  function updateIndicator(key) {
    const menuNode = desktopMenuRef.current;
    const itemNode = itemRefs.current.get(key);

    if (!menuNode || !itemNode) {
      setIndicator((prev) => ({ ...prev, visible: false }));
      return;
    }

    setIndicator({
      left: itemNode.offsetLeft,
      width: itemNode.offsetWidth,
      visible: true,
    });
  }

  useEffect(() => {
    updateIndicator(activeKey);
  }, [activeKey]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleResize() {
      updateIndicator(activeKey);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeKey]);

  useEffect(() => {
    if (!isOverlay) {
      setOverlayScrolled(false);
      return undefined;
    }

    const updateOverlayState = () => {
      setOverlayScrolled(window.scrollY > 48);
    };

    updateOverlayState();
    window.addEventListener("scroll", updateOverlayState, { passive: true });
    return () => window.removeEventListener("scroll", updateOverlayState);
  }, [isOverlay]);

  const overlayClassName = isOverlay ? `site-navbar--overlay${overlayScrolled || mobileOpen ? " is-scrolled" : ""}` : "sticky top-0 z-30 border-b backdrop-blur";

  return (
    <header className={`site-navbar ${overlayClassName}`}>
      <nav className="site-navbar-inner mx-auto flex w-full max-w-[1280px] items-center gap-3 px-4 py-3 text-sm md:px-8 md:py-4">
        <button
          type="button"
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((prev) => !prev)}
          className={`site-mobile-toggle inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-all duration-300 md:hidden ${
            mobileOpen ? "is-active" : ""
          }`}
        >
          <span className="site-mobile-toggle-icon" aria-hidden="true" />
        </button>

        <Link
          href={`/${lang}`}
          aria-label="Home"
          className="site-home-link hidden shrink-0 items-center gap-3 rounded-[10px] border px-4 py-3 transition-all duration-300 md:inline-flex"
        >
          <span className="site-home-icon" aria-hidden="true">
            <Image src="/home.png" alt="" width={26} height={26} className="h-[26px] w-[26px] object-contain" />
          </span>
          <span className="site-brand whitespace-nowrap text-base font-black transition-all duration-300 md:text-xl">
            UbonCity.com
          </span>
        </Link>

        <div className="site-mobile-menu-shell md:hidden">
          <div className={`site-mobile-menu ${mobileOpen ? "is-open" : ""}`}>
            <div className="site-mobile-menu-inner">
              {CATEGORY_KEYS.map((key) => (
                <Link
                  key={key}
                  href={`/${lang}/${key}`}
                  className={`site-mobile-menu-link ${activeKey === key ? "is-active" : ""}`}
                >
                  {copy.nav[key]}
                </Link>
              ))}
              <div className="site-mobile-menu-divider" aria-hidden="true" />
              <LanguageSwitch mobileList onNavigate={() => setMobileOpen(false)} />
              <div className="site-mobile-menu-divider" aria-hidden="true" />
              <Link href={`/${lang}/contact`} className="site-mobile-menu-link site-mobile-menu-link--utility site-contact-link">
                {copy.contactUs}
              </Link>
            </div>
          </div>
        </div>

        <div className="mx-3 hidden flex-1 md:block">
          <div
            ref={desktopMenuRef}
            className="site-desktop-menu relative mx-auto flex w-fit items-center justify-center"
            onMouseLeave={() => updateIndicator(activeKey)}
          >
            {CATEGORY_KEYS.map((key) => (
              <Link
                key={key}
                href={`/${lang}/${key}`}
                ref={(node) => {
                  if (node) itemRefs.current.set(key, node);
                  else itemRefs.current.delete(key);
                }}
                onMouseEnter={() => updateIndicator(key)}
                className={`site-desktop-menu-link relative inline-flex items-center px-4 py-3 text-[14px] font-semibold transition-colors duration-300 ${
                  activeKey === key ? "is-active" : ""
                }`}
              >
                {copy.nav[key]}
              </Link>
            ))}
            <span
              className="site-desktop-menu-indicator"
              style={{
                width: indicator.visible ? `${indicator.width}px` : "0px",
                transform: `translateX(${indicator.left}px)`,
                opacity: indicator.visible ? 1 : 0,
              }}
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <div className="hidden md:block">
            <LanguageSwitch />
          </div>
          <ThemeModeControl />
        </div>
      </nav>
    </header>
  );
}
