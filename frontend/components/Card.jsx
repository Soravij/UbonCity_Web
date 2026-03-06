import Link from "next/link";
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
  const blocks = parseDescriptionBlocks(place?.description || "");
  const firstContentImage = blocks.find((block) => block.type === "image");
  const parsedCover = parseCoverImageValue(place?.image);
  const matchedCoverImage = blocks.find(
    (block) => block.type === "image" && parsedCover.url && block.url === parsedCover.url
  );

  const coverImage = parsedCover.url || firstContentImage?.url || "/default-lotus.svg";
  const coverAlt = place?.title || firstContentImage?.alt || "Lotus image";
  const coverRotation = parsedCover.url
    ? parsedCover.rotation || matchedCoverImage?.rotation || 0
    : firstContentImage?.rotation || 0;
  const href = place?.category && place?.slug ? `/${lang}/${place.category}/${place.slug}` : null;

  const cardClassName =
    "group overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-[0_8px_20px_rgba(75,1,80,0.08)] transition-all duration-300 ease-out hover:-translate-y-1.5 hover:border-orange-300 hover:bg-gray-50 hover:shadow-[0_16px_34px_rgba(75,1,80,0.22)]";

  const cardContent = (
    <>
      <div className="h-40 w-full overflow-hidden sm:h-44">
        <img
          src={coverImage}
          alt={coverAlt}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.05]"
          style={{ transform: rotationTransform(coverRotation), transformOrigin: "center center" }}
          loading="lazy"
        />
      </div>

      <div className="space-y-3 p-4 md:p-5">
        <h2 className="text-base font-semibold leading-6 md:text-lg">{place?.title || "Untitled"}</h2>
        <p className="text-sm leading-6 text-[color:var(--muted)]">{getSummary(place, copy)}</p>
        <span className="inline-flex rounded-lg border border-orange-300 px-3 py-1.5 text-sm font-medium transition group-hover:bg-white">
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
