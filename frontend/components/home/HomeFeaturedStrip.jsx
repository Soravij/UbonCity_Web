import Link from "next/link";
import { resolveCardCoverVisual } from "@/lib/phase56-decision-helpers.mjs";

function buildPlaceHref(lang, place) {
  if (!place?.category || !place?.slug) return null;
  return `/${lang}/${place.category}/${place.slug}`;
}

export default function HomeFeaturedStrip({ places = [], activeLang }) {
  if (!places.length) {
    return null;
  }

  return (
    <div className="home-featured-strip">
      {places.map((place, index) => {
        const href = buildPlaceHref(activeLang, place);
        const title = place.title || "-";
        const { coverImage, coverAlt } = resolveCardCoverVisual(place);
        const categoryLabel = place.category || "place";
        const subtitle = place.district || place.location_name || place.province || "";

        if (!href) {
          return (
            <div
              key={place.id || index}
              className="home-featured-place"
            >
              <div className="home-featured-place-media">
                <img src={coverImage} alt={coverAlt} loading="lazy" />
              </div>
              <div className="home-featured-place-info">
                <span className="home-featured-place-label">
                  {categoryLabel}
                </span>
                <span className="home-featured-place-title">{title}</span>
                {subtitle ? <span className="home-featured-place-subtitle">{subtitle}</span> : null}
              </div>
            </div>
          );
        }

        return (
          <Link
            key={place.id || index}
            href={href}
            className="home-featured-place"
          >
            <div className="home-featured-place-media">
              <img src={coverImage} alt={coverAlt} loading="lazy" />
            </div>
            <div className="home-featured-place-info">
              <span className="home-featured-place-label">
                {categoryLabel}
              </span>
              <span className="home-featured-place-title">{title}</span>
              {subtitle ? <span className="home-featured-place-subtitle">{subtitle}</span> : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
