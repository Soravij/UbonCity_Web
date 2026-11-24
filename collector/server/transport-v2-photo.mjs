let sharpModule = null;
async function loadSharp() {
  if (!sharpModule) sharpModule = (await import("sharp")).default;
  return sharpModule;
}

export const ROUTE_PHOTO_W = 640;
export const ROUTE_PHOTO_H = 480;

export async function processRoutePhoto(buffer) {
  const sharp = await loadSharp();
  const out = await sharp(buffer).rotate()
    .resize(ROUTE_PHOTO_W, ROUTE_PHOTO_H, { fit: "cover", position: "attention" })
    .webp({ quality: 75 }).toBuffer();
  return { buffer: out, ext: ".webp", mime: "image/webp", width: ROUTE_PHOTO_W, height: ROUTE_PHOTO_H };
}
