"use client";

import { useEffect, useRef } from "react";

const PARALLAX_RATIO = 0.05;
const MOBILE_BREAKPOINT = 768;

export default function HomeParallaxBackground() {
  const layerRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;

    let rafId = 0;
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let isParallaxEnabled = false;

    const updateParallax = () => {
      if (!isParallaxEnabled) {
        layer.style.setProperty("--home-bg-parallax-y", "0px");
        rafId = 0;
        return;
      }

      const shift = Math.round(window.scrollY * PARALLAX_RATIO * -1);
      layer.style.setProperty("--home-bg-parallax-y", `${shift}px`);
      rafId = 0;
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(updateParallax);
    };

    const syncParallaxMode = () => {
      const nextEnabled = !reducedMotionQuery.matches && window.innerWidth >= MOBILE_BREAKPOINT;

      if (nextEnabled === isParallaxEnabled) {
        onScroll();
        return;
      }

      isParallaxEnabled = nextEnabled;
      layer.style.setProperty("--home-bg-parallax-y", "0px");

      if (isParallaxEnabled) {
        window.addEventListener("scroll", onScroll, { passive: true });
      } else {
        window.removeEventListener("scroll", onScroll);
      }

      onScroll();
    };

    syncParallaxMode();
    window.addEventListener("resize", syncParallaxMode);
    reducedMotionQuery.addEventListener("change", syncParallaxMode);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", syncParallaxMode);
      reducedMotionQuery.removeEventListener("change", syncParallaxMode);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return <div ref={layerRef} className="home-page-bg" style={{ "--home-bg-parallax-y": "0px" }} aria-hidden="true" />;
}
