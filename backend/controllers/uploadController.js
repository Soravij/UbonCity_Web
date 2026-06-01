import fs from "fs";
import path from "path";
import { LIMITS, validateBase64ImageInput } from "../validators/inputSanitizer.js";

const MAX_FILE_SIZE_BYTES = LIMITS.BASE64_MAX_BYTES_5MB;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function ensureUploadsDir() {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

function safeExtFromMime(mimeType) {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return "";
  }
}

function isSupportedImageSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;

  if (mimeType === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (mimeType === "image/gif") {
    const sig = buffer.subarray(0, 6).toString("ascii");
    return sig === "GIF87a" || sig === "GIF89a";
  }

  if (mimeType === "image/webp") {
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    return riff === "RIFF" && webp === "WEBP";
  }

  return false;
}

function buildPublicUrl(req, fileName) {
  const configuredBase = String(process.env.BACKEND_PUBLIC_URL || "").trim();
  const base = configuredBase || `${req.protocol}://${req.get("host")}`;
  return `${base}/uploads/${fileName}`;
}

function extractUploadsFileName(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!input) return "";

  try {
    if (/^https?:\/\//i.test(input)) {
      const parsed = new URL(input);
      const pathname = decodeURIComponent(parsed.pathname || "");
      const marker = "/uploads/";
      const idx = pathname.lastIndexOf(marker);
      if (idx === -1) return "";
      const fileName = pathname.slice(idx + marker.length);
      if (!fileName || fileName.includes("/") || fileName.includes("\\")) return "";
      return fileName;
    }

    const normalized = input.replace(/\\/g, "/");
    const marker = "/uploads/";
    const idx = normalized.lastIndexOf(marker);
    if (idx === -1) return "";
    const fileName = normalized.slice(idx + marker.length);
    if (!fileName || fileName.includes("/") || fileName.includes("\\")) return "";
    return fileName;
  } catch {
    return "";
  }
}

export const uploadImage = async (req, res) => {
  try {
    const mimeType = String(req.body?.mimeType || "").trim().toLowerCase();
    const dataBase64 = req.body?.dataBase64;

    if (!dataBase64 || !mimeType) {
      return res.status(400).json({ error: "dataBase64 and mimeType are required" });
    }

    if (!ALLOWED_MIME.has(mimeType)) {
      return res.status(400).json({ error: "Unsupported image type" });
    }

    const normalizedBase64 = validateBase64ImageInput(dataBase64, MAX_FILE_SIZE_BYTES);
    const buffer = Buffer.from(normalizedBase64, "base64");
    if (!buffer.length) {
      return res.status(400).json({ error: "Invalid image data" });
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: "File too large (max 5MB)" });
    }

    if (!isSupportedImageSignature(buffer, mimeType)) {
      return res.status(400).json({ error: "Image signature does not match mimeType" });
    }

    const uploadsDir = ensureUploadsDir();
    const ext = safeExtFromMime(mimeType);
    if (!ext) {
      return res.status(400).json({ error: "Unsupported image type" });
    }

    const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    const filePath = path.join(uploadsDir, fileName);

    await fs.promises.writeFile(filePath, buffer);

    return res.json({
      message: "Uploaded",
      fileName,
      url: buildPublicUrl(req, fileName),
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("dataBase64") || msg.includes("File too large")) {
      return res.status(400).json({ error: msg });
    }

    console.error("uploadImage failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteImage = async (req, res) => {
  try {
    const { url } = req.body || {};
    const fileName = extractUploadsFileName(url);

    if (!fileName) {
      return res.status(400).json({ error: "Invalid uploads url" });
    }

    const uploadsDir = ensureUploadsDir();
    const filePath = path.join(uploadsDir, fileName);
    const resolvedUploads = path.resolve(uploadsDir);
    const resolvedFile = path.resolve(filePath);

    if (!resolvedFile.startsWith(resolvedUploads)) {
      return res.status(400).json({ error: "Invalid file path" });
    }

    if (!fs.existsSync(resolvedFile)) {
      return res.status(404).json({ error: "File not found" });
    }

    await fs.promises.unlink(resolvedFile);
    return res.json({ message: "Deleted", fileName });
  } catch (err) {
    console.error("deleteImage failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
