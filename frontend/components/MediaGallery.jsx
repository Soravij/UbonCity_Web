"use client";

import { useEffect, useMemo, useState } from "react";

function normalizeItems(items = [], title = "Gallery image") {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      if (typeof item === "string") {
        const url = String(item || "").trim();
        if (!url) return null;
        return { url, alt: `${title} ${index + 1}` };
      }
      const url = String(item?.url || "").trim();
      if (!url) return null;
      return {
        url,
        alt: String(item?.alt || `${title} ${index + 1}`).trim(),
      };
    })
    .filter(Boolean);
}

function tileVariant(index) {
  if (index === 0) return "is-featured";
  if (index % 5 === 2) return "is-tall";
  return "";
}

export default function MediaGallery({ title, items = [] }) {
  const galleryItems = useMemo(() => normalizeItems(items, title || "Gallery image"), [items, title]);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (activeIndex < 0) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setActiveIndex(-1);
      } else if (event.key === "ArrowRight") {
        setActiveIndex((current) => (current + 1) % galleryItems.length);
      } else if (event.key === "ArrowLeft") {
        setActiveIndex((current) => (current - 1 + galleryItems.length) % galleryItems.length);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeIndex, galleryItems.length]);

  if (!galleryItems.length) return null;

  const activeItem = activeIndex >= 0 ? galleryItems[activeIndex] : null;

  return (
    <>
      <section className="section-panel media-gallery-panel p-5 md:p-6">
        <div className="media-gallery-head">
          <h2 className="text-lg font-semibold md:text-xl">{title}</h2>
          <p className="media-gallery-subtitle">คลิกเพื่อดูภาพขยาย</p>
        </div>
        <div className="media-gallery-grid">
          {galleryItems.map((item, index) => (
            <button
              key={`${item.url}-${index}`}
              type="button"
              className={`media-gallery-tile ${tileVariant(index)}`.trim()}
              onClick={() => setActiveIndex(index)}
              aria-label={`Open image ${index + 1}`}
            >
              <span className="media-gallery-tile-image-wrap">
                <img src={item.url} alt={item.alt} loading="lazy" className="media-gallery-tile-image" />
              </span>
            </button>
          ))}
        </div>
      </section>

      {activeItem ? (
        <div className="media-gallery-lightbox" role="dialog" aria-modal="true" aria-label={title}>
          <button
            type="button"
            className="media-gallery-lightbox-backdrop"
            aria-label="Close gallery"
            onClick={() => setActiveIndex(-1)}
          />
          <div className="media-gallery-lightbox-shell">
            <div className="media-gallery-lightbox-toolbar">
              <span className="media-gallery-lightbox-counter">
                {activeIndex + 1} / {galleryItems.length}
              </span>
              <button
                type="button"
                className="media-gallery-lightbox-close"
                onClick={() => setActiveIndex(-1)}
                aria-label="Close gallery"
              >
                ปิด
              </button>
            </div>
            <div className="media-gallery-lightbox-stage">
              {galleryItems.length > 1 ? (
                <button
                  type="button"
                  className="media-gallery-lightbox-nav is-prev"
                  onClick={() => setActiveIndex((activeIndex - 1 + galleryItems.length) % galleryItems.length)}
                  aria-label="Previous image"
                >
                  ‹
                </button>
              ) : null}
              <figure className="media-gallery-lightbox-figure">
                <img src={activeItem.url} alt={activeItem.alt} className="media-gallery-lightbox-image" />
              </figure>
              {galleryItems.length > 1 ? (
                <button
                  type="button"
                  className="media-gallery-lightbox-nav is-next"
                  onClick={() => setActiveIndex((activeIndex + 1) % galleryItems.length)}
                  aria-label="Next image"
                >
                  ›
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
