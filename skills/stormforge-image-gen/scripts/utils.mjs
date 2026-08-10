import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export class SkillError extends Error {
  constructor(message, code = "SkillError", details = {}) {
    super(message);
    this.name = code;
    this.code = code;
    Object.assign(this, details);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function sha256(value) {
  const bytes = value instanceof Uint8Array ? value : await readFile(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function atomicWrite(filePath, data) {
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temp = `${absolute}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temp, data);
    await rename(temp, absolute);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export function parsePixelSize(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

export function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

export function inferAspectRatio(size) {
  const parsed = parsePixelSize(size);
  if (!parsed) return null;
  const divisor = gcd(parsed.width, parsed.height);
  return `${parsed.width / divisor}:${parsed.height / divisor}`;
}

export function getMimeTypeFromBytes(bytes) {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function getMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  return null;
}

export function getExtensionForMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".png";
}

export function dimensionsFromBytes(bytes, mime = getMimeTypeFromBytes(bytes)) {
  if (mime === "image/png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime === "image.jpeg" || mime === "image/jpg" || mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isSof && length >= 7) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      offset += length;
    }
  }
  if (mime === "image/webp" && bytes.length >= 30) {
    const chunk = Buffer.from(bytes.subarray(12, 16)).toString("ascii");
    if (chunk === "VP8X" && bytes.length >= 30) {
      return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      const start = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
      if (start >= 0 && start + 7 < bytes.length) return { width: bytes.readUInt16LE(start + 3) & 0x3fff, height: bytes.readUInt16LE(start + 5) & 0x3fff };
    }
    if (chunk === "VP8L" && bytes.length >= 25) {
      const b = bytes[21];
      const c = bytes[22];
      const d = bytes[23];
      const e = bytes[24];
      return { width: 1 + (b | ((c & 0x3f) << 8)), height: 1 + ((c >> 6) | (d << 2) | ((e & 0x0f) << 10)) };
    }
  }
  return null;
}

export function redact(value) {
  return String(value)
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,}]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key|token|bearerToken)\s*[:=]\s*["']?[^\s,"'}]+/gi, "$1=[REDACTED]")
    .replace(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g, "data:image/[REDACTED]");
}

export function safeErrorMessage(error) {
  return redact(error instanceof Error ? error.message : String(error));
}

export async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new SkillError(`Unable to read JSON file ${filePath}: ${safeErrorMessage(error)}`, "ConfigurationError");
  }
}

export function isPathLike(value) {
  return typeof value === "string" && !value.startsWith("data:") && !/^[A-Za-z0-9+/=\s]+$/.test(value);
}
