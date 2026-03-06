import Link from "next/link";
import RotatedImage from "@/components/RotatedImage";
import { getPlaceDetail } from "@/lib/api";
import { getLangContent } from "@/lib/site";

function normalizeRotation(rotation) {
  const n = Number(rotation);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
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

function normalizeTextSpacing(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
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
      const textBlock = normalizeTextSpacing(source.slice(lastIndex, index));
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
    const textBlock = normalizeTextSpacing(source.slice(lastIndex));
    if (textBlock) blocks.push({ type: "text", value: textBlock });
  }

  if (blocks.length === 0) {
    blocks.push({ type: "text", value: normalizeTextSpacing(source) || "No description provided." });
  }

  return blocks;
}

export default async function PlaceDetailPage({ params }) {
  const { lang, category, slug } = await params;
  const [place, copy] = await Promise.all([
    getPlaceDetail(category, slug, lang),
    Promise.resolve(getLangContent(lang)),
  ]);

  if (!place) {
    return (
      <section className="mx-auto max-w-3xl space-y-3 md:space-y-4">
        <p className="text-sm text-[color:var(--muted)]">{copy.nav?.[category] || category}</p>
        <h1 className="text-2xl font-bold tracking-tight md:text-4xl">ไม่พบเนื้อหา</h1>
        <p className="text-[15px] leading-7 text-slate-700 md:text-base">
          ลิงก์นี้อาจถูกเปลี่ยน slug หรือเนื้อหายังไม่ได้อนุมัติให้แสดงผล
        </p>
        <div>
          <Link
            href={`/${lang}/${category}`}
            className="inline-flex rounded-lg border border-orange-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-100"
          >
            กลับหน้าหมวดหมู่
          </Link>
        </div>
      </section>
    );
  }

  const blocks = parseDescriptionBlocks(place.description || "");
  const firstImageIndex = blocks.findIndex((b) => b.type === "image");
  const firstImage = firstImageIndex >= 0 ? blocks[firstImageIndex] : null;
  const parsedCover = parseCoverImageValue(place?.image);
  const matchedCoverImage = blocks.find(
    (block) => block.type === "image" && parsedCover.url && block.url === parsedCover.url
  );

  const useFallbackCover = !parsedCover.url && Boolean(firstImage);
  const coverImage = parsedCover.url || firstImage?.url || "/default-lotus.svg";
  const coverRotation = parsedCover.url
    ? parsedCover.rotation || matchedCoverImage?.rotation || 0
    : firstImage?.rotation || 0;

  const contentBlocks = useFallbackCover
    ? blocks.filter((block, index) => !(block.type === "image" && index === firstImageIndex))
    : blocks;

  return (
    <section className="mx-auto max-w-3xl">
      <p className="mb-1 text-sm text-[color:var(--muted)]">{copy.nav[category]}</p>
      <h1 className="mb-1 text-2xl font-bold tracking-tight md:text-4xl">{place.title}</h1>

      <div className="mt-3 text-[15px] leading-7 text-slate-700 md:text-base">
        <RotatedImage
          src={coverImage}
          alt={place.title || "Place image"}
          rotation={coverRotation}
          width="min(40vw, 100%)"
        />

        <div className="mt-3 flex flex-col gap-3">
          {contentBlocks.map((block, index) => {
            if (block.type === "image") {
              return (
                <RotatedImage
                  key={`detail-img-${index}`}
                  src={block.url}
                  alt={block.alt}
                  rotation={block.rotation || 0}
                  width="min(40vw, 100%)"
                  loading="lazy"
                />
              );
            }

            return (
              <div key={`detail-text-${index}`} className="whitespace-pre-line">
                {block.value}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}




