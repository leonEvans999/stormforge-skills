#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import os from "node:os";
import { URL } from "node:url";

const DEFAULT_IMAGE_TOOL_MODEL = "gpt-5.6-sol";
const IMAGE_TOOL_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;

dns.setDefaultResultOrder("ipv4first");

function usage() {
  console.error(`Usage:
  node generate.mjs --prompt <text> --image <path> [--model <id>] [--base-url <url>] [--api-key <key>] [--use-codex-config] [--tool-size 1024x1024] [--tool-quality high] [--timeout-ms 120000]
  node generate.mjs --prompt-file <path> --image <path> --use-codex-config`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { useCodexConfig: false };
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
    else if (arg === "--model") options.model = next();
    else if (arg === "--base-url") options.baseUrl = next();
    else if (arg === "--api-key") options.apiKey = next();
    else if (arg === "--use-codex-config") options.useCodexConfig = true;
    else if (arg === "--tool-size") options.toolSize = next();
    else if (arg === "--tool-quality") options.toolQuality = next();
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

  const tool = { type: "image_generation", model: DEFAULT_IMAGE_TOOL_MODEL };
  if (options.toolSize) tool.size = options.toolSize;
  if (toolQuality) tool.quality = toolQuality;
  const body = { model, input: prompt, tools: [tool] };

  console.error(`Using responses / ${model}; image tool / ${DEFAULT_IMAGE_TOOL_MODEL}; quality ${toolQuality || "provider default"}; timeout ${timeoutMs}ms`);
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
  console.log(JSON.stringify({ status: "ok", path: outputPath, bytes: bytes.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
