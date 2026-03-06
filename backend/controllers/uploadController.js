import fs from "fs";
import path from "path";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
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
    const { dataBase64, mimeType } = req.body || {};

    if (!dataBase64 || !mimeType) {
      return res.status(400).json({ error: "dataBase64 and mimeType are required" });
    }

    if (!ALLOWED_MIME.has(mimeType)) {
      return res.status(400).json({ error: "Unsupported image type" });
    }

    const buffer = Buffer.from(String(dataBase64), "base64");
    if (!buffer.length) {
      return res.status(400).json({ error: "Invalid image data" });
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: "File too large (max 5MB)" });
    }

    const uploadsDir = ensureUploadsDir();
    const ext = safeExtFromMime(mimeType);
    const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    const filePath = path.join(uploadsDir, fileName);

    await fs.promises.writeFile(filePath, buffer);

    return res.json({
      message: "Uploaded",
      fileName,
      url: buildPublicUrl(req, fileName),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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
    return res.status(500).json({ error: err.message });
  }
};
