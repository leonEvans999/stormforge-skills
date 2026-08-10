import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import {
  dimensionsFromBytes, exists, getExtensionForMime, getMimeTypeFromBytes, getMimeTypeFromPath,
  sha256, SkillError,
} from "./utils.mjs";

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES = 16;

function strictBase64Decode(value, label = "image Base64") {
  const compact = String(value).replace(/\s+/g, "");
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new SkillError(`Invalid ${label}.`, "InputImageError");
  }
  const bytes = Buffer.from(compact, "base64");
  if (!bytes.length) throw new SkillError(`Invalid ${label}.`, "InputImageError");
  const canonicalInput = compact.replace(/=+$/, "");
  const canonicalOutput = bytes.toString("base64").replace(/=+$/, "");
  if (canonicalInput !== canonicalOutput) throw new SkillError(`Invalid ${label}.`, "InputImageError");
  return bytes;
}

function enforceImage(bytes, label) {
  if (bytes.length >= MAX_IMAGE_BYTES) throw new SkillError(`${label} must be smaller than 50 MB.`, "InputImageError");
  const mime = getMimeTypeFromBytes(bytes);
  if (!mime) throw new SkillError(`${label} is not a supported PNG, JPEG, or WebP image.`, "InputImageError");
  return mime;
}

function parseDataUrl(value) {
  const match = String(value).match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/i);
  if (!match) throw new SkillError("Invalid or unsupported image data URL.", "InputImageError");
  return { declaredMime: match[1].toLowerCase(), bytes: strictBase64Decode(match[2], "image data URL") };
}

async function imageRecord({ bytes, sourceType, source, filename, declaredMime }) {
  const mime = enforceImage(bytes, source || "Input image");
  const warnings = [];
  if (declaredMime && declaredMime !== mime) warnings.push(`Declared MIME type ${declaredMime} differs from detected ${mime}.`);
  return {
    sourceType,
    source: sourceType === "file" ? source : undefined,
    filename: filename || `reference${getExtensionForMime(mime)}`,
    mime,
    bytes,
    byteCount: bytes.length,
    dimensions: dimensionsFromBytes(bytes, mime),
    sha256: await sha256(bytes),
    warnings,
  };
}

export async function loadImageValue(value, { cwd = process.cwd(), index = 0 } = {}) {
  const text = String(value || "").trim();
  if (!text) throw new SkillError("Input image value is empty.", "InputImageError");
  if (/^https?:\/\//i.test(text)) throw new SkillError("Remote image URLs are not supported as reference inputs. Download the image or provide Base64.", "InputImageError");
  if (/^data:/i.test(text)) {
    const parsed = parseDataUrl(text);
    return imageRecord({ ...parsed, sourceType: "data-url", filename: `reference-${index + 1}${getExtensionForMime(parsed.declaredMime)}` });
  }

  const candidate = path.resolve(cwd, text);
  const likelyPath = await exists(candidate) || path.isAbsolute(text) || /^\.{0,2}[\\/]/.test(text) || /\.(png|jpe?g|webp)$/i.test(text);
  if (likelyPath) {
    if (!(await exists(candidate))) throw new SkillError(`Input image file not found: ${candidate}`, "InputImageError");
    const info = await stat(candidate);
    if (!info.isFile()) throw new SkillError(`Input image path is not a file: ${candidate}`, "InputImageError");
    if (info.size >= MAX_IMAGE_BYTES) throw new SkillError(`Input image must be smaller than 50 MB: ${candidate}`, "InputImageError");
    const bytes = await readFile(candidate);
    return imageRecord({ bytes, sourceType: "file", source: candidate, filename: path.basename(candidate), declaredMime: getMimeTypeFromPath(candidate) });
  }

  const bytes = strictBase64Decode(text);
  const mime = enforceImage(bytes, "Input image Base64");
  return imageRecord({ bytes, sourceType: "base64", filename: `reference-${index + 1}${getExtensionForMime(mime)}` });
}

export async function loadImageInputs(values = [], base64Files = [], { cwd = process.cwd() } = {}) {
  const records = [];
  for (const value of values) records.push(await loadImageValue(value, { cwd, index: records.length }));
  for (const file of base64Files) {
    const absolute = path.resolve(cwd, file);
    if (!(await exists(absolute))) throw new SkillError(`Base64 input file not found: ${absolute}`, "InputImageError");
    const text = await readFile(absolute, "utf8");
    const record = await loadImageValue(text, { cwd, index: records.length });
    record.sourceType = "base64-file";
    record.source = absolute;
    records.push(record);
  }
  if (records.length > MAX_REFERENCE_IMAGES) throw new SkillError(`At most ${MAX_REFERENCE_IMAGES} reference images are supported.`, "InputImageError");
  return records;
}

export async function loadMask(maskPath, inputs, { cwd = process.cwd() } = {}) {
  if (!maskPath) return null;
  if (inputs.length !== 1) throw new SkillError("A mask requires exactly one reference image.", "InputImageError");
  const absolute = path.resolve(cwd, maskPath);
  if (!(await exists(absolute))) throw new SkillError(`Mask file not found: ${absolute}`, "InputImageError");
  const info = await stat(absolute);
  if (!info.isFile() || info.size >= MAX_IMAGE_BYTES) throw new SkillError("Mask must be a PNG file smaller than 50 MB.", "InputImageError");
  const bytes = await readFile(absolute);
  const mime = getMimeTypeFromBytes(bytes);
  if (mime !== "image/png") throw new SkillError("Mask must be a PNG image.", "InputImageError");
  const dimensions = dimensionsFromBytes(bytes, mime);
  const inputDimensions = inputs[0].dimensions;
  if (!dimensions || !inputDimensions || dimensions.width !== inputDimensions.width || dimensions.height !== inputDimensions.height) {
    throw new SkillError("Mask dimensions must match the reference image dimensions.", "InputImageError");
  }
  return {
    sourceType: "file",
    source: absolute,
    filename: path.basename(absolute),
    mime,
    bytes,
    byteCount: bytes.length,
    dimensions,
    sha256: await sha256(bytes),
  };
}

export function publicImageInput(record) {
  return {
    sourceType: record.sourceType,
    source: record.sourceType === "file" || record.sourceType === "base64-file" ? record.source : undefined,
    mime: record.mime,
    byteCount: record.byteCount,
    dimensions: record.dimensions,
    sha256: record.sha256,
    warnings: record.warnings?.length ? record.warnings : undefined,
  };
}
