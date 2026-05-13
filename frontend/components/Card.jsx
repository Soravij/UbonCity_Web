import Link from "next/link";
import { resolveCardCoverVisual } from "@/lib/phase56-decision-helpers.mjs";
import { getLangContent } from "@/lib/site";

function normalizeRotation(rotation) {
  const n = Number(rotation);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

function rotationTransform(rotation) {
  const rot = normalizeRotation(rotation);
  return `rotate(${rot}deg)`;
}

function parseCoverImageValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return { url: "", rotation: 0 };

  const match = value.match(/^(.*?)(?:#r=(-?\d+))?$/);
  return {
    url: String(match?.[1] || "").trim(),
    rotation: normalizeRotation(match?.[2] ?? 0),
  };
}

function parseAltRotation(rawAlt) {
  const input = String(rawAlt || "").trim();
  const match = input.match(/^(.*?)(?:\|r=(-?\d+))?$/);
  return {
    alt: String(match?.[1] || "").trim(),
    rotation: normalizeRotation(match?.[2] ?? 0),
  };
}

function cleanMediaUrl(value) {
  const url = String(value || "").trim();
  return url || "";
}

function parseDescriptionBlocks(text) {
  const source = String(text || "");
  const regex = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  const blocks = [];
  let lastIndex = 0;

  for (const match of source.matchAll(regex)) {
    const full = match[0];
    const url = (match[2] || "").trim();
    const index = match.index ?? 0;
    const parsedAlt = parseAltRotation(match[1]);

    if (index > lastIndex) {
      const textBlock = source.slice(lastIndex, index).trim();
      if (textBlock) blocks.push({ type: "text", value: textBlock });
    }

    if (url) {
      blocks.push({
        type: "image",
        url,
        alt: parsedAlt.alt || "Content image",
        rotation: parsedAlt.rotation,
      });
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < source.length) {
    const textBlock = source.slice(lastIndex).trim();
    if (textBlock) blocks.push({ type: "text", value: textBlock });
  }

  if (blocks.length === 0) {
    blocks.push({ type: "text", value: source });
  }

  return blocks;
}

function getSummary(place, copy) {
  const blocks = parseDescriptionBlocks(place?.description || "");
  const textBlock = blocks.find((b) => b.type === "text")?.value || "";
  if (!textBlock) return copy.empty;
  return textBlock.length > 120 ? `${textBlock.slice(0, 120)}...` : textBlock;
}

export default function Card({ place, lang = "th" }) {
  const copy = getLangContent(lang);
  const { coverImage, coverAlt, coverRotation } = resolveCardCoverVisual(place);
  const href = place?.category && place?.slug ? `/${lang}/${place.category}/${place.slug}` : null;
  const categoryLabel = copy?.nav?.[place?.category] || place?.category || "";

  const cardClassName =
    "interactive-tile group overflow-hidden rounded-[26px] transition-all duration-300 ease-out hover:-translate-y-1.5";

  const cardContent = (
    <>
      <div className="h-44 w-full overflow-hidden sm:h-48">
        <img
          src={coverImage}
          alt={coverAlt}
          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          style={{ transform: rotationTransform(coverRotation), transformOrigin: "center center" }}
          loading="lazy"
        />
      </div>

      <div className="space-y-3 px-4 py-4 md:px-5 md:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {categoryLabel ? <p className="eyebrow-label mb-2">{categoryLabel}</p> : null}
            <h2 className="text-lg font-semibold leading-7 tracking-[-0.02em]">{place?.title || "Untitled"}</h2>
          </div>
        </div>
        <p className="text-sm leading-7 text-[color:var(--muted)]">{getSummary(place, copy)}</p>
        <span className="inline-flex rounded-full border border-orange-300 px-3.5 py-2 text-sm font-medium transition group-hover:bg-white">
          {copy.readMore}
        </span>
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`block ${cardClassName}`} aria-label={place?.title || "Place"}>
        {cardContent}
      </Link>
    );
  }

  return <article className={cardClassName}>{cardContent}</article>;
}
