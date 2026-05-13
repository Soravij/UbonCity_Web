import fs from "fs";
import path from "path";
import pool from "../config/db.js";
import { LIMITS, validateBase64ImageInput } from "../validators/inputSanitizer.js";

const MAX_FILE_SIZE_BYTES = LIMITS.BASE64_MAX_BYTES_5MB;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function ensureAvatarUploadsDir() {
  const uploadsDir = path.resolve(process.cwd(), "uploads", "avatars");
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
  if (mimeType === "image/webp") {
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    return riff === "RIFF" && webp === "WEBP";
  }
  return false;
}

function buildPublicBase(req) {
  const configuredBase = String(process.env.BACKEND_PUBLIC_URL || "").trim();
  return configuredBase || `${req.protocol}://${req.get("host")}`;
}

function isSafeAvatarPath(rawPath) {
  const value = String(rawPath || "").trim().replace(/\\/g, "/");
  return /^uploads\/avatars\/[^/\\]+$/i.test(value);
}

export function resolveUserAvatarPublicUrl(req, avatarPath) {
  const value = String(avatarPath || "").trim().replace(/\\/g, "/");
  if (!isSafeAvatarPath(value)) return "";
  return `${buildPublicBase(req)}/${value}`;
}

export async function deleteUserAvatarFile(avatarPath) {
  const relativePath = String(avatarPath || "").trim().replace(/\\/g, "/");
  if (!isSafeAvatarPath(relativePath)) return false;
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const avatarRoot = path.resolve(process.cwd(), "uploads", "avatars");
  if (!absolutePath.startsWith(avatarRoot)) return false;
  if (!fs.existsSync(absolutePath)) return false;
  await fs.promises.unlink(absolutePath).catch(() => {});
  return true;
}

export async function storeUserAvatar(req, userId, { dataBase64, mimeType } = {}) {
  const normalizedUserId = Number(userId || 0) || 0;
  if (!normalizedUserId) {
    throw new Error("valid user id is required");
  }

  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  if (!dataBase64 || !normalizedMimeType) {
    throw new Error("dataBase64 and mimeType are required");
  }
  if (!ALLOWED_MIME.has(normalizedMimeType)) {
    throw new Error("Unsupported image type");
  }

  const normalizedBase64 = validateBase64ImageInput(dataBase64, MAX_FILE_SIZE_BYTES);
  const buffer = Buffer.from(normalizedBase64, "base64");
  if (!buffer.length) {
    throw new Error("Invalid image data");
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error("File too large (max 5MB)");
  }
  if (!isSupportedImageSignature(buffer, normalizedMimeType)) {
    throw new Error("Image signature does not match mimeType");
  }

  const ext = safeExtFromMime(normalizedMimeType);
  if (!ext) {
    throw new Error("Unsupported image type");
  }

  const uploadsDir = ensureAvatarUploadsDir();
  const fileName = `user-${normalizedUserId}-${Date.now()}${ext}`;
  const absolutePath = path.join(uploadsDir, fileName);
  await fs.promises.writeFile(absolutePath, buffer);
  const avatarPath = `uploads/avatars/${fileName}`;

  const [rows] = await pool.query("SELECT avatar_path FROM users WHERE id=? LIMIT 1", [normalizedUserId]);
  const previousAvatarPath = String(rows?.[0]?.avatar_path || "").trim();
  try {
    await pool.query(
      "UPDATE users SET avatar_path=?, avatar_updated_at=NOW() WHERE id=?",
      [avatarPath, normalizedUserId]
    );
  } catch (error) {
    await deleteUserAvatarFile(avatarPath).catch(() => {});
    throw error;
  }
  if (previousAvatarPath && previousAvatarPath !== avatarPath) {
    await deleteUserAvatarFile(previousAvatarPath);
  }

  return {
    avatar_path: avatarPath,
    avatar_url: resolveUserAvatarPublicUrl(req, avatarPath),
    mime_type: normalizedMimeType,
  };
}

export async function clearUserAvatar(req, userId) {
  const normalizedUserId = Number(userId || 0) || 0;
  if (!normalizedUserId) {
    throw new Error("valid user id is required");
  }
  const [rows] = await pool.query("SELECT avatar_path FROM users WHERE id=? LIMIT 1", [normalizedUserId]);
  const avatarPath = String(rows?.[0]?.avatar_path || "").trim();
  await pool.query("UPDATE users SET avatar_path=NULL, avatar_updated_at=NULL WHERE id=?", [normalizedUserId]);
  if (avatarPath) {
    await deleteUserAvatarFile(avatarPath);
  }
  return {
    avatar_path: null,
    avatar_url: "",
  };
}
