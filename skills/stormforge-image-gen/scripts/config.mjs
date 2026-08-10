import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { exists, parsePixelSize, SkillError } from "./utils.mjs";

export const DEFAULTS = Object.freeze({
  baseUrl: "https://api.nxtpath.ai/v1",
  model: "gpt-image-2",
  size: "2048x1152",
  quality: "high",
  format: "png",
  background: "auto",
  moderation: "auto",
  count: 1,
  nStrategy: "auto",
  timeoutMs: 300000,
  jobs: 4,
  retries: 2,
  startIntervalMs: 250,
  metadataPrompt: "full",
  writeMetadata: true,
});

const CREDENTIAL_KEY = /(api.?key|token|authorization|bearer|secret|password)/i;
const ALLOWED_PREFS = new Set([
  "baseUrl", "model", "size", "ar", "aspectRatio", "resolution", "quality", "format",
  "compression", "background", "moderation", "n", "count", "nStrategy", "timeoutMs",
  "jobs", "retries", "startIntervalMs", "metadataPrompt", "writeMetadata", "strictSize",
]);

function parseEnv(text, filePath) {
  const values = {};
  for (const [index, raw] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new SkillError(`Invalid .env syntax at ${filePath}:${index + 1}`, "ConfigurationError");
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function loadEnvFile(filePath) {
  if (!(await exists(filePath))) return {};
  return parseEnv(await readFile(filePath, "utf8"), filePath);
}

function rejectCredentials(value, trail = []) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) throw new SkillError(`Credential-like field is not allowed in image-gen.json: ${[...trail, key].join(".")}`, "ConfigurationError");
    rejectCredentials(child, [...trail, key]);
  }
}

async function loadPreferences(filePath) {
  if (!(await exists(filePath))) return {};
  let parsed;
  try { parsed = JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { throw new SkillError(`Unable to parse ${filePath}: ${error.message}`, "ConfigurationError"); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new SkillError(`${filePath} must contain a JSON object.`, "ConfigurationError");
  rejectCredentials(parsed);
  const result = {};
  for (const [key, value] of Object.entries(parsed)) if (ALLOWED_PREFS.has(key)) result[key] = value;
  return result;
}

function parseTomlString(value) {
  const match = String(value).trim().match(/^(["'])(.*)\1(?:\s*#.*)?$/);
  return match ? match[2] : undefined;
}

export async function readCodexProviderConfig(homeDir = os.homedir()) {
  const filePath = path.join(homeDir, ".codex", "config.toml");
  if (!(await exists(filePath))) return {};
  const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
  let section = "";
  let selectedProvider;
  const providers = new Map();
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) { section = sectionMatch[1]; continue; }
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!pair) continue;
    const value = parseTomlString(pair[2]);
    if (value === undefined) continue;
    if (!section && pair[1] === "model_provider") selectedProvider = value;
    const providerMatch = section.match(/^model_providers\.([A-Za-z0-9_-]+)$/);
    if (providerMatch) {
      const current = providers.get(providerMatch[1]) || {};
      if (pair[1] === "base_url") current.baseUrl = value;
      if (pair[1] === "experimental_bearer_token") current.apiKey = value;
      providers.set(providerMatch[1], current);
    }
  }
  return selectedProvider ? (providers.get(selectedProvider) || {}) : {};
}

function envToConfig(env) {
  const config = {};
  if (env.OPENAI_API_KEY) config.apiKey = env.OPENAI_API_KEY;
  if (env.OPENAI_BASE_URL) config.baseUrl = env.OPENAI_BASE_URL;
  if (env.OPENAI_IMAGE_MODEL) config.model = env.OPENAI_IMAGE_MODEL;
  if (env.OPENAI_REQUEST_TIMEOUT_MS) config.timeoutMs = env.OPENAI_REQUEST_TIMEOUT_MS;
  if (env.STORMFORGE_IMAGE_MAX_JOBS) config.jobs = env.STORMFORGE_IMAGE_MAX_JOBS;
  if (env.STORMFORGE_IMAGE_START_INTERVAL_MS) config.startIntervalMs = env.STORMFORGE_IMAGE_START_INTERVAL_MS;
  if (env.STORMFORGE_IMAGE_RETRIES) config.retries = env.STORMFORGE_IMAGE_RETRIES;
  return config;
}

function canonicalizeLayer(layer = {}) {
  const value = { ...layer };
  if (value.aspectRatio !== undefined && value.ar === undefined) value.ar = value.aspectRatio;
  if (value.n !== undefined && value.count === undefined) value.count = value.n;
  delete value.aspectRatio;
  delete value.n;
  return value;
}

export function mergeGenerationLayers(...layers) {
  const result = {};
  for (const rawLayer of layers) {
    const layer = canonicalizeLayer(rawLayer);
    if (layer.size !== undefined) { delete result.ar; delete result.resolution; }
    if (layer.ar !== undefined) delete result.size;
    if (layer.resolution !== undefined) {
      delete result.size;
      if (layer.ar === undefined && result.ar === undefined) result.ar = "1:1";
    }
    Object.assign(result, Object.fromEntries(Object.entries(layer).filter(([, value]) => value !== undefined)));
  }
  return result;
}

function asInteger(value, name, min, max) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new SkillError(`${name} must be an integer from ${min} through ${max}.`, "ValidationError");
  return number;
}

export function parseAspectRatio(value) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) throw new SkillError(`Invalid aspect ratio: ${value}. Use values such as 16:9 or 1:1.`, "ValidationError");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = Math.max(width / height, height / width);
  if (!(width > 0 && height > 0) || ratio > 3) throw new SkillError(`Aspect ratio ${value} exceeds the supported 3:1 limit.`, "ValidationError");
  return { width, height };
}

export function validateGptImage2Size(size) {
  if (size === "auto") return size;
  const parsed = parsePixelSize(size);
  if (!parsed) throw new SkillError(`Invalid size ${size}. Use WxH or auto.`, "ValidationError");
  const { width, height } = parsed;
  const pixels = width * height;
  const ratio = Math.max(width / height, height / width);
  const errors = [];
  if (width % 16 || height % 16) errors.push("both dimensions must be multiples of 16");
  if (Math.max(width, height) > 3840) errors.push("the longest edge must not exceed 3840");
  if (ratio > 3) errors.push("the aspect ratio must not exceed 3:1");
  if (pixels < 655360) errors.push("the image must contain at least 655,360 pixels");
  if (pixels > 8294400) errors.push("the image must contain at most 8,294,400 pixels");
  if (errors.length) throw new SkillError(`Invalid gpt-image-2 size ${size}: ${errors.join("; ")}. Try 1024x1024, 2048x1152, or 2880x2880.`, "ValidationError");
  return `${width}x${height}`;
}

export function sizeFromAspectRatio(ar, resolution = "2k") {
  const ratio = parseAspectRatio(ar);
  const key = String(resolution).toLowerCase();
  if (!new Set(["1k", "2k", "4k"]).has(key)) throw new SkillError(`Unsupported resolution ${resolution}. Use 1k, 2k, or 4k.`, "ValidationError");

  const targetLongEdge = ratio.width === ratio.height
    ? (key === "1k" ? 1024 : key === "2k" ? 2048 : 2880)
    : (key === "1k" ? 1024 : key === "2k" ? 2048 : 3840);
  const targetRatio = Math.max(ratio.width / ratio.height, ratio.height / ratio.width);
  const landscape = ratio.width > ratio.height;
  const portrait = ratio.height > ratio.width;
  let best;

  // Search the finite grid of valid 16-pixel steps instead of scaling and rounding
  // independently. Independent rounding can push a 3:1 request over the ratio
  // limit or push a near-4k request over the pixel limit.
  for (let width = 16; width <= 3840; width += 16) {
    for (let height = 16; height <= 3840; height += 16) {
      if (landscape && width < height) continue;
      if (portrait && height < width) continue;
      if (!landscape && !portrait && width !== height) continue;
      const pixels = width * height;
      if (pixels < 655360 || pixels > 8294400) continue;
      const actualRatio = Math.max(width / height, height / width);
      if (actualRatio > 3) continue;
      const ratioError = Math.abs(Math.log(actualRatio / targetRatio));
      const longEdgeError = Math.abs(Math.max(width, height) - targetLongEdge) / targetLongEdge;
      const score = ratioError * 1000 + longEdgeError;
      if (!best || score < best.score || (score === best.score && pixels > best.pixels)) {
        best = { width, height, pixels, score };
      }
    }
  }

  if (!best) throw new SkillError(`Unable to derive a valid ${key} size for aspect ratio ${ar}.`, "ValidationError");
  return validateGptImage2Size(`${best.width}x${best.height}`);
}

function inferFormatFromOutput(output) {
  const ext = path.extname(output || "").toLowerCase();
  if (ext === ".png") return "png";
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".webp") return "webp";
  return undefined;
}

export function validateTaskConfig(raw, { requireConnection = true } = {}) {
  const config = canonicalizeLayer(raw);
  config.baseUrl = String(config.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "");
  config.model = String(config.model || DEFAULTS.model);
  config.quality = String(config.quality || DEFAULTS.quality).toLowerCase();
  config.background = String(config.background || DEFAULTS.background).toLowerCase();
  config.moderation = String(config.moderation || DEFAULTS.moderation).toLowerCase();
  config.nStrategy = String(config.nStrategy || DEFAULTS.nStrategy).toLowerCase();
  config.metadataPrompt = String(config.metadataPrompt || DEFAULTS.metadataPrompt).toLowerCase();
  config.count = asInteger(config.count ?? DEFAULTS.count, "n", 1, 10);
  config.timeoutMs = asInteger(config.timeoutMs ?? DEFAULTS.timeoutMs, "timeout", 1, 3600000);
  config.jobs = asInteger(config.jobs ?? DEFAULTS.jobs, "jobs", 1, 16);
  config.retries = asInteger(config.retries ?? DEFAULTS.retries, "retries", 0, 20);
  config.startIntervalMs = asInteger(config.startIntervalMs ?? DEFAULTS.startIntervalMs, "start interval", 0, 60000);
  if (config.compression !== undefined) config.compression = asInteger(config.compression, "compression", 0, 100);
  if (!new Set(["auto", "low", "medium", "high"]).has(config.quality)) throw new SkillError(`Unsupported quality: ${config.quality}`, "ValidationError");
  if (!new Set(["auto", "opaque", "transparent"]).has(config.background)) throw new SkillError(`Unsupported background: ${config.background}`, "ValidationError");
  if (!new Set(["auto", "low"]).has(config.moderation)) throw new SkillError(`Unsupported moderation: ${config.moderation}`, "ValidationError");
  if (!new Set(["auto", "single-request", "separate-requests"]).has(config.nStrategy)) throw new SkillError(`Unsupported n strategy: ${config.nStrategy}`, "ValidationError");
  if (!new Set(["full", "hash", "omit"]).has(config.metadataPrompt)) throw new SkillError(`Unsupported metadata prompt mode: ${config.metadataPrompt}`, "ValidationError");
  if (config.size !== undefined && config.ar !== undefined) throw new SkillError("size and ar cannot be set at the same layer.", "ValidationError");
  config.size = config.ar || config.resolution ? sizeFromAspectRatio(config.ar || "1:1", config.resolution || "2k") : String(config.size || DEFAULTS.size).toLowerCase();
  if (config.model === "gpt-image-2") validateGptImage2Size(config.size);
  else if (config.size !== "auto" && !parsePixelSize(config.size)) throw new SkillError(`Invalid size: ${config.size}`, "ValidationError");
  const inferred = inferFormatFromOutput(config.output);
  config.format = String(config.format || inferred || DEFAULTS.format).toLowerCase();
  if (!new Set(["png", "jpeg", "webp"]).has(config.format)) throw new SkillError(`Unsupported output format: ${config.format}`, "ValidationError");
  if (inferred && inferred !== config.format) throw new SkillError(`Output extension implies ${inferred}, but --format requests ${config.format}.`, "ValidationError");
  if (config.compression !== undefined && config.format === "png") throw new SkillError("compression is supported only for jpeg and webp.", "ValidationError");
  if (config.model === "gpt-image-2" && config.background === "transparent") throw new SkillError("gpt-image-2 does not support transparent backgrounds.", "ValidationError");
  if (requireConnection && !config.apiKey) throw new SkillError("Missing OPENAI_API_KEY (or --api-key).", "ConfigurationError");
  try { new URL(config.baseUrl); } catch { throw new SkillError(`Invalid base URL: ${config.baseUrl}`, "ConfigurationError"); }
  return config;
}

export async function resolveGlobalConfig(cli = {}, { cwd = process.cwd(), homeDir = os.homedir(), env = process.env } = {}) {
  const userRoot = path.join(homeDir, ".stormforge-skills");
  const projectRoot = path.join(cwd, ".stormforge-skills");
  const codex = cli.useCodexConfig ? await readCodexProviderConfig(homeDir) : {};
  const userPrefs = await loadPreferences(path.join(userRoot, "image-gen.json"));
  const projectPrefs = await loadPreferences(path.join(projectRoot, "image-gen.json"));
  const userEnv = envToConfig(await loadEnvFile(path.join(userRoot, ".env")));
  const projectEnv = envToConfig(await loadEnvFile(path.join(projectRoot, ".env")));
  const processEnv = envToConfig(env);
  const cliLayer = {
    apiKey: cli.apiKey, baseUrl: cli.baseUrl, model: cli.model, size: cli.size, ar: cli.aspectRatio,
    resolution: cli.resolution, quality: cli.quality, format: cli.format, compression: cli.compression,
    background: cli.background, moderation: cli.moderation, count: cli.count, nStrategy: cli.nStrategy,
    timeoutMs: cli.timeoutMs, jobs: cli.jobs, retries: cli.retries, startIntervalMs: cli.startIntervalMs,
    metadataPrompt: cli.metadataPrompt, writeMetadata: cli.writeMetadata, strictSize: cli.strictSize,
  };
  return mergeGenerationLayers(DEFAULTS, codex, userPrefs, projectPrefs, userEnv, projectEnv, processEnv, cliLayer);
}
