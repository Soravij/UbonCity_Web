"use client";

import { useEffect, useMemo, useState } from "react";

function normalizeRotation(rotation) {
  const n = Number(rotation);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

export default function RotatedImage({
  src,
  alt,
  rotation = 0,
  width = "min(40vw, 100%)",
  loading,
}) {
  const rot = normalizeRotation(rotation);
  const [renderedSrc, setRenderedSrc] = useState("");

  useEffect(() => {
    let active = true;

    if (!src) {
      setRenderedSrc("");
      return () => {
        active = false;
      };
    }

    // 0 deg: no processing, keep original source.
    if (rot === 0) {
      setRenderedSrc(src);
      return () => {
        active = false;
      };
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (!active) return;

      const w = Number(img.naturalWidth || 0);
      const h = Number(img.naturalHeight || 0);
      if (w <= 0 || h <= 0) {
        setRenderedSrc(src);
        return;
      }

      const quarterTurn = rot === 90 || rot === 270;
      const canvas = document.createElement("canvas");
      canvas.width = quarterTurn ? h : w;
      canvas.height = quarterTurn ? w : h;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setRenderedSrc(src);
        return;
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(toRadians(rot));
      ctx.drawImage(img, -w / 2, -h / 2, w, h);

      try {
        const dataUrl = canvas.toDataURL("image/png");
        setRenderedSrc(dataUrl || src);
      } catch {
        // Fallback if browser blocks canvas export.
        setRenderedSrc(src);
      }
    };

    img.onerror = () => {
      if (!active) return;
      setRenderedSrc(src);
    };

    img.src = src;

    return () => {
      active = false;
    };
  }, [src, rot]);

  const finalSrc = useMemo(() => renderedSrc || src, [renderedSrc, src]);

  return (
    <img
      src={finalSrc}
      alt={alt}
      loading={loading}
      className="rotated-image-frame mx-auto block h-auto w-full rounded-xl object-contain p-1"
      style={{ width }}
    />
  );
}





