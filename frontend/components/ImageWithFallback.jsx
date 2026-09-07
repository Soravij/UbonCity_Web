"use client";

export default function ImageWithFallback({ fallbackSrc, ...props }) {
  return (
    <img
      {...props}
      onError={(e) => {
        if (!fallbackSrc || e.currentTarget.dataset.fallbackApplied) return;
        e.currentTarget.dataset.fallbackApplied = "1";
        e.currentTarget.src = fallbackSrc;
      }}
    />
  );
}
