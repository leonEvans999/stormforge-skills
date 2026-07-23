#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import os from "node:os";
import { URL } from "node:url";

const DEFAULT_TOOL_SIZE = "2048x1152";
const DEFAULT_TOOL_QUALITY = "high";
const IMAGE_TOOL_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const INPUT_IMAGE_EXTENSION_MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const SUPPORTED_INPUT_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

dns.setDefaultResultOrder("ipv4first");

function usage() {
  console.error(`Usage:
  node generate.mjs --prompt <text> --image <path> [--input-image <path|base64|data-url>]... [--model <id>] [--tool-model <id>] [--base-url <url>] [--api-key <key>] [--use-codex-config] [--tool-size 2048x1152] [--tool-quality high] [--metadata <path>|--no-metadata] [--timeout-ms 120000]
  node generate.mjs --prompt-file <path> --image <path> [--input-image <path|base64|data-url>]... --use-codex-config`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { useCodexConfig: false, inputImages: [], writeMetadata: true };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) usage();
      return value;
    };
    if (arg === "--prompt") options.prompt = next();
    else if (arg === "--prompt-file") options.promptFile = next();
    else if (arg === "--image") options.image = next();
    else if (arg === "--input-image") options.inputImages.push(next());
    else if (arg === "--model") options.model = next();
    else if (arg === "--tool-model") options.toolModel = next();
    else if (arg === "--base-url") options.baseUrl = next();
    else if (arg === "--api-key") options.apiKey = next();
    else if (arg === "--use-codex-config") options.useCodexConfig = true;
    else if (arg === "--tool-size") options.toolSize = next();
    else if (arg === "--tool-quality") options.toolQuality = next();
    else if (arg === "--metadata") options.metadata = next();
    else if (arg === "--no-metadata") options.writeMetadata = false;
    else if (arg === "--timeout-ms") options.timeoutMs = next();
    else if (arg === "--help" || arg === "-h") usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if ((!options.prompt && !options.promptFile) || !options.image) usage();
  return options;
}

function unquote(value) {
  return value.trim().replace(/^[\"']|[\"']$/g, "");
}

function getTomlString(scope, key) {
  const match = scope.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
  return match ? unquote(match[1]) : undefined;
}

async function readCodexProvider() {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  if (!existsSync(configPath)) return {};
  const text = await readFile(configPath, "utf8");
  const activeProvider = getTomlString(text, "model_provider");
  const model = getTomlString(text, "model");
  if (!activeProvider) return { model };

  const header = `[model_providers.${activeProvider}]`;
  const start = text.indexOf(header);
  if (start < 0) return { model };
  const after = text.slice(start + header.length);
  const nextHeader = after.search(/^\s*\[/m);
  const providerBlock = nextHeader >= 0 ? after.slice(0, nextHeader) : after;

  return {
    model,
    baseUrl: getTomlString(providerBlock, "base_url"),
    token: getTomlString(providerBlock, "experimental_bearer_token"),
  };
}

async function loadPrompt(options) {
  if (options.prompt) return options.prompt;
  return readFile(options.promptFile, "utf8");
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function parseTimeoutMs(value) {
  if (!value) return DEFAULT_REQUEST_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid timeout: ${value}`);
  }
  return timeoutMs;
}

function normalizeImageMimeType(value) {
  const normalized = value.toLowerCase() === "image/jpg" ? "image/jpeg" : value.toLowerCase();
  return SUPPORTED_INPUT_IMAGE_MIME_TYPES.has(normalized) ? normalized : undefined;
}

function decodeBase64Image(value) {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error("Invalid Base64 input image data.");
  }
  const bytes = Buffer.from(compact, "base64");
  const normalizedInput = compact.replace(/=+$/, "");
  const normalizedDecoded = bytes.toString("base64").replace(/=+$/, "");
  if (bytes.length === 0 || normalizedInput !== normalizedDecoded) {
    throw new Error("Invalid Base64 input image data.");
  }
  return bytes;
}

function sniffImageMimeType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    return "image/gif";
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

function looksLikeRawBase64(value) {
  const compact = value.replace(/\s+/g, "");
  return compact.length >= 16 && compact.length % 4 !== 1 && /^[A-Za-z0-9+/]*={0,2}$/.test(compact);
}

async function inputImageToDataUrl(value) {
  const dataUrlMatch = value.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    const mimeType = normalizeImageMimeType(dataUrlMatch[1]);
    const imageBytes = decodeBase64Image(dataUrlMatch[2]);
    return `data:${mimeType};base64,${imageBytes.toString("base64")}`;
  }

  if (looksLikeRawBase64(value)) {
    const imageBytes = decodeBase64Image(value);
    const mimeType = sniffImageMimeType(imageBytes);
    if (!mimeType) {
      throw new Error("Could not infer the image type from raw Base64. Use PNG, JPEG, WebP, or GIF data, or pass a data URL with a MIME type.");
    }
    return `data:${mimeType};base64,${imageBytes.toString("base64")}`;
  }

  const imageBytes = await readFile(value);
  if (imageBytes.length === 0) {
    throw new Error(`Input image is empty: ${value}`);
  }
  const extensionMimeType = INPUT_IMAGE_EXTENSION_MIME_TYPES.get(path.extname(value).toLowerCase());
  const mimeType = extensionMimeType || sniffImageMimeType(imageBytes);
  if (!mimeType) {
    throw new Error(`Unsupported input image type: ${value}. Expected PNG, JPEG, WebP, or GIF.`);
  }
  return `data:${mimeType};base64,${imageBytes.toString("base64")}`;
}

async function buildInput(prompt, inputImages) {
  if (inputImages.length === 0) return prompt;

  const content = [{ type: "input_text", text: prompt }];
  for (const inputImage of inputImages) {
    content.push({
      type: "input_image",
      image_url: await inputImageToDataUrl(inputImage),
    });
  }
  return [{ role: "user", content }];
}

function parseToolQuality(value) {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (!IMAGE_TOOL_QUALITIES.has(normalized)) {
    throw new Error(`Invalid tool quality: ${value}. Expected one of: auto, low, medium, high.`);
  }
  return normalized;
}

function requestBuffer(url, { method = "GET", headers = {}, body, timeoutMs, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const requestBody = body ? Buffer.from(body) : undefined;
    const requestHeaders = { ...headers };
    if (requestBody && !Object.hasOwn(requestHeaders, "Content-Length")) {
      requestHeaders["Content-Length"] = String(requestBody.length);
    }

    const request = transport.request(target, { method, headers: requestHeaders }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location && redirects > 0) {
        response.resume();
        const redirectUrl = new URL(location, target).toString();
        const redirectMethod = status === 303 ? "GET" : method;
        const redirectBody = redirectMethod === "GET" ? undefined : body;
        requestBuffer(redirectUrl, {
          method: redirectMethod,
          headers,
          body: redirectBody,
          timeoutMs,
          redirects: redirects - 1,
        }).then(resolve, reject);
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: response.statusMessage || "",
          headers: response.headers,
          buffer: Buffer.concat(chunks),
        });
      });
    });

    const timer = setTimeout(() => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    request.on("error", reject);
    request.on("close", () => clearTimeout(timer));
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

async function postJson(url, body, { apiKey, timeoutMs }) {
  const response = await requestBuffer(url, {
    method: "POST",
    timeoutMs,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = response.buffer.toString("utf8");
  if (!response.ok) {
    throw new Error(`Responses API error: HTTP ${response.status} ${response.statusText}: ${text}`);
  }
  return JSON.parse(text);
}

function looksLikeBase64Image(value) {
  if (value.length < 256) return false;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(value)) return false;
  const compact = value.replace(/\s+/g, "");
  return compact.startsWith("iVBOR") || compact.startsWith("/9j/") || compact.startsWith("UklGR") || compact.startsWith("R0lGOD") || compact.length > 2048;
}

function findDataUrl(value) {
  const serialized = JSON.stringify(value);
  const match = serialized.match(/data:image\/[^;"']+;base64,([A-Za-z0-9+/=\\n\\r]+)/);
  return match?.[1]?.replace(/\\n/g, "").replace(/\\r/g, "");
}

function findImageUrl(value) {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string" && /url/i.test(key) && /^https?:\/\//.test(nested) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(nested)) {
      return nested;
    }
    const found = findImageUrl(nested);
    if (found) return found;
  }
  return undefined;
}

function findBase64(value) {
  const dataUrl = findDataUrl(value);
  if (dataUrl) return dataUrl;
  const preferredKeys = new Set(["b64_json", "base64", "image_base64", "image", "result"]);

  const visit = (node) => {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }
    for (const [key, nested] of Object.entries(node)) {
      if (typeof nested === "string" && preferredKeys.has(key) && looksLikeBase64Image(nested)) {
        return nested.replace(/\s+/g, "");
      }
    }
    for (const nested of Object.values(node)) {
      const found = visit(nested);
      if (found) return found;
    }
    return undefined;
  };

  return visit(value);
}

function findRevisedPrompt(value) {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRevisedPrompt(item);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === "revised_prompt" && typeof nested === "string") return nested;
    const found = findRevisedPrompt(nested);
    if (found) return found;
  }
  return undefined;
}

function summarizeShape(value) {
  if (!value || typeof value !== "object") return typeof value;
  const top = Object.keys(value).slice(0, 20).join(", ");
  const output = Array.isArray(value.output)
    ? `; output types: ${value.output.map((item) => item?.type).filter(Boolean).join(", ")}`
    : "";
  return `top-level keys: ${top}${output}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const codex = options.useCodexConfig ? await readCodexProvider() : {};
  const prompt = await loadPrompt(options);
  const model = options.model || process.env.OPENAI_RESPONSES_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || codex.model;
  const baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || codex.baseUrl;
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || codex.token;
  const timeoutMs = parseTimeoutMs(options.timeoutMs || process.env.RESPONSES_IMAGE_TIMEOUT_MS || process.env.OPENAI_REQUEST_TIMEOUT_MS);
  const toolQuality = parseToolQuality(options.toolQuality);

  if (!model) throw new Error("Missing model. Pass --model or set OPENAI_RESPONSES_IMAGE_MODEL.");
  if (!baseUrl) throw new Error("Missing base URL. Pass --base-url, set OPENAI_BASE_URL, or use --use-codex-config.");
  if (!apiKey) throw new Error("Missing API key. Pass --api-key, set OPENAI_API_KEY, or use --use-codex-config.");

  const toolModel = options.toolModel || process.env.OPENAI_IMAGE_TOOL_MODEL;
  const tool = {
    type: "image_generation",
    size: options.toolSize || DEFAULT_TOOL_SIZE,
    quality: toolQuality || DEFAULT_TOOL_QUALITY,
  };
  if (toolModel) tool.model = toolModel;
  const input = await buildInput(prompt, options.inputImages);
  const body = { model, input, tools: [tool] };

  console.error(`Using responses / ${model}; image tool / ${toolModel || "provider-selected"}; input images ${options.inputImages.length}; size ${tool.size}; quality ${tool.quality}; timeout ${timeoutMs}ms`);
  const result = await postJson(`${normalizeBaseUrl(baseUrl)}/responses`, body, { apiKey, timeoutMs });
  let bytes;
  const base64 = findBase64(result);
  if (base64) {
    bytes = Buffer.from(base64, "base64");
  } else {
    const imageUrl = findImageUrl(result);
    if (imageUrl) {
      const imageResponse = await requestBuffer(imageUrl, { timeoutMs });
      if (!imageResponse.ok) throw new Error(`Image URL fetch failed: HTTP ${imageResponse.status}`);
      bytes = imageResponse.buffer;
    }
  }

  if (!bytes || bytes.length === 0) {
    throw new Error(`No image found in Responses result (${summarizeShape(result)}).`);
  }

  const outputPath = path.resolve(options.image);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);

  if (options.writeMetadata) {
    const metadataPath = path.resolve(options.metadata || `${options.image}.json`);
    await mkdir(path.dirname(metadataPath), { recursive: true });
    const metadata = {
      outer_model: model,
      tool_model: toolModel || null,
      requested_prompt: prompt,
      revised_prompt: findRevisedPrompt(result) || null,
      size: tool.size,
      quality: tool.quality,
      input_image_count: options.inputImages.length,
      output_path: outputPath,
      output_bytes: bytes.length,
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
  }

  console.log(JSON.stringify({ status: "ok", path: outputPath, bytes: bytes.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
