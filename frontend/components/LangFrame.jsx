"use client";

import { usePathname } from "next/navigation";
import Footer from "@/components/Footer";
import HomeParallaxBackground from "@/components/home/HomeParallaxBackground";
import Navbar from "@/components/Navbar";

export default function LangFrame({ lang, children }) {
  const pathname = usePathname();
  const isHomeRoot = pathname === `/${lang}` || pathname === `/${lang}/`;

  return (
    <div
      className={`page-frame page-frame--scenic flex min-h-screen flex-col notranslate${isHomeRoot ? " page-frame--home" : ""}`}
      lang={lang}
      translate="no"
    >
      <HomeParallaxBackground />
      <Navbar lang={lang} variant="overlay" />
      <main
        className={
          isHomeRoot
            ? "page-stack page-stack--home flex-1"
            : "page-stack page-stack--scenic-shell mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 pt-24 md:px-8 md:py-10 md:pt-28"
        }
      >
        {children}
      </main>
      <Footer lang={lang} />
    </div>
  );
}
