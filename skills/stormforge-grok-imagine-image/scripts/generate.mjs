#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import https from "node:https";
import http from "node:http";

const DEFAULT_MODEL = "xai/grok-imagine-image";
const DEFAULT_SIZE = "1024x1024";
const DEFAULT_QUALITY = "high";
const DEFAULT_TIMEOUT = 300000;

function usage() { return `Usage:\n  node scripts/generate.mjs --prompt <text> --output <path> [options]\n\nOptions:\n  --prompt <text>                 Prompt text\n  --prompt-file <path>            Read prompt from a file\n  --output, --image <path>        Output image path\n  --model <id>                    Model (default: ${DEFAULT_MODEL})\n  --size <WxH>                    Derive aspect ratio/resolution\n  --aspect-ratio <W:H>            Image aspect ratio\n  --resolution <1k|2k>            Image resolution\n  --quality <auto|low|medium|high>\n  --n <1-10>                      Number of images\n  --config <path>                 Grok config path\n  --overwrite                     Overwrite existing output\n  --timeout-ms <ms>               Request timeout\n  --metadata <path>               Metadata path\n  --no-metadata                   Disable metadata\n  --metadata-prompt <full|hash|omit>\n  --json                          Emit JSON result\n  --debug                         Emit sanitized diagnostics\n  -h, --help                      Show this help`; }

function parseArgs(argv) {
  const a = { metadata: true, metadataPrompt: "full", n: 1 };
  const value = (i, flag) => { if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`); return [argv[i + 1], i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === "--help" || x === "-h") { a.help = true; continue; }
    if (["--prompt", "--prompt-file", "--output", "--image", "--model", "--size", "--aspect-ratio", "--resolution", "--quality", "--n", "--config", "--overwrite", "--timeout-ms", "--metadata", "--metadata-prompt"].includes(x)) {
      if (x === "--overwrite") { a.overwrite = true; continue; }
      const [v, next] = value(i, x); i = next;
      if (x === "--prompt") a.prompt = v;
      else if (x === "--prompt-file") a.promptFile = v;
      else if (x === "--output" || x === "--image") a.output = v;
      else if (x === "--model") a.model = v;
      else if (x === "--size") a.size = v;
      else if (x === "--aspect-ratio") a.aspectRatio = v;
      else if (x === "--resolution") a.resolution = v;
      else if (x === "--quality") a.quality = v;
      else if (x === "--n") a.n = Number(v);
      else if (x === "--config") a.config = v;
      else if (x === "--timeout-ms") a.timeoutMs = Number(v);
      else if (x === "--metadata") a.metadataPath = v;
      else if (x === "--metadata-prompt") a.metadataPrompt = v;
      continue;
    }
    if (x === "--no-metadata") { a.metadata = false; continue; }
    if (x === "--json") { a.json = true; continue; }
    if (x === "--debug") { a.debug = true; continue; }
    throw new Error(`Unknown option: ${x}`);
  }
  return a;
}

function tomlString(value) { const m = String(value).trim().match(/^(?:"([\s\S]*)"|'([\s\S]*)')\s*(?:#.*)?$/); return m ? (m[1] ?? m[2]) : undefined; }
function parseGrokConfig(text) {
  let section = "";
  const root = {}; const models = new Map();
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim(); if (!line) continue;
    const header = line.match(/^\[model\.(["'])(.*?)\1\]$/); if (header) { section = `model:${header[2]}`; if (!models.has(header[2])) models.set(header[2], {}); continue; }
    if (line === "[models]") { section = "models"; continue; }
    if (/^\[/.test(line)) { section = ""; continue; }
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/); if (!pair) continue;
    const val = tomlString(pair[2]); if (val === undefined) continue;
    if (section === "models") root[pair[1]] = val;
    else if (section.startsWith("model:")) models.get(section.slice(6))[pair[1]] = val;
  }
  const selected = root.default || [...models.keys()][0];
  const entry = selected ? (models.get(selected) || {}) : {};
  return { selected, ...entry, models };
}
async function loadConfig(filePath, explicitModel) {
  const text = await readFile(filePath, "utf8");
  const parsed = parseGrokConfig(text);
  const modelEntry = explicitModel && parsed.models.get(explicitModel) ? parsed.models.get(explicitModel) : parsed;
  const baseUrl = process.env.OPENAI_BASE_URL || modelEntry.base_url || modelEntry.baseUrl;
  const apiKey = process.env.OPENAI_API_KEY || modelEntry.api_key || modelEntry.apiKey;
  if (!baseUrl) throw new Error(`No base_url found in Grok config: ${filePath}`);
  if (!apiKey) throw new Error(`No api_key found in Grok config: ${filePath}`);
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}
function decodeDataUrl(value) { const m = String(value).match(/^data:([^;,]+);base64,([\s\S]+)$/i); return m ? { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2], "base64") } : null; }
function sniff(bytes) { if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png"; if (bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))) return "image/jpeg"; if (bytes.subarray(0, 4).toString() === "RIFF") return "image/webp"; return "application/octet-stream"; }
function findImages(value, out = []) {
  if (typeof value === "string") { const d = decodeDataUrl(value); if (d) out.push(d); else if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 20) { try { const b = Buffer.from(value.replace(/\s/g, ""), "base64"); if (b.length > 20 && sniff(b) !== "application/octet-stream") out.push({ mime: sniff(b), bytes: b }); } catch {} } }
  else if (value && typeof value === "object") { for (const [k, v] of Object.entries(value)) { if (["b64_json", "base64", "image_base64", "data_url"].includes(k)) findImages(v, out); else if (k === "url" && typeof v === "string") out.push({ url: v }); else findImages(v, out); } }
  return out;
}
function request(url, body, apiKey, timeoutMs) { return new Promise((resolve, reject) => { const target = new URL(url); const transport = target.protocol === "http:" ? http : https; const data = Buffer.from(JSON.stringify(body)); const req = transport.request(target, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Content-Length": data.length } }, res => { const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") })); }); const timer = setTimeout(() => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs); req.on("error", reject); req.on("close", () => clearTimeout(timer)); req.write(data); req.end(); }); }
async function download(url, apiKey, timeoutMs) { return new Promise((resolve, reject) => { const target = new URL(url); const transport = target.protocol === "http:" ? http : https; const req = transport.get(target, { headers: { Authorization: `Bearer ${apiKey}` } }, res => { const chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve(Buffer.concat(chunks))); }); const timer = setTimeout(() => req.destroy(new Error(`Download timed out after ${timeoutMs}ms`)), timeoutMs); req.on("error", reject); req.on("close", () => clearTimeout(timer)); }); }
function dimensions(bytes) { const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])); if (png && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }; const jpg = bytes.subarray(0, 3).equals(Buffer.from([255,216,255])); if (jpg) { let i = 2; while (i + 9 < bytes.length) { if (bytes[i] !== 255) { i++; continue; } const marker = bytes[i + 1]; const len = bytes.readUInt16BE(i + 2); if (marker >= 192 && marker <= 195) return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) }; i += 2 + len; } } return undefined; }
function apiErrorMessage(payload) {
  const candidates = [payload?.error?.message, payload?.error?.error, payload?.error?.code, payload?.message, payload?.detail, payload?.code];
  for (const value of candidates) if (typeof value === "string" && value) return value;
  return payload ? Object.keys(payload).join(", ") : "invalid response";
}
function imageControls(size, aspectRatio, resolution) {
  let ratio = aspectRatio;
  let inferredResolution = resolution;
  if (!ratio && size) {
    const m = String(size).match(/^(\d+)x(\d+)$/);
    if (!m) throw new Error("--size must use WIDTHxHEIGHT");
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const divisor = gcd(Number(m[1]), Number(m[2]));
    ratio = `${Number(m[1]) / divisor}:${Number(m[2]) / divisor}`;
    inferredResolution = inferredResolution || Math.max(Number(m[1]), Number(m[2])) <= 1024 ? "1k" : "2k";
  }
  return { aspect_ratio: ratio || "1:1", resolution: inferredResolution || "1k" };
}
function promptMeta(prompt, mode) { if (mode === "omit") return undefined; if (mode === "hash") return { sha256: createHash("sha256").update(prompt).digest("hex"), length: prompt.length }; return prompt; }
async function main(argv = process.argv.slice(2), io = {}) {
  const log = io.log || ((s) => process.stderr.write(`${s}\n`)); const a = parseArgs(argv); if (a.help) { process.stdout.write(`${usage()}\n`); return { exitCode: 0 }; }
  if (!a.prompt && !a.promptFile) throw new Error("Missing --prompt or --prompt-file"); if (!a.output) throw new Error("Missing --output"); if (a.n < 1 || a.n > 10 || !Number.isInteger(a.n)) throw new Error("--n must be an integer from 1 to 10");
  const prompt = a.prompt ?? (await readFile(path.resolve(a.promptFile), "utf8")).trim(); if (!prompt) throw new Error("Prompt is empty");
  const configPath = path.resolve(a.config || path.join(os.homedir(), ".grok", "config.toml")); const connection = await loadConfig(configPath, a.configModel);
  const model = a.model || DEFAULT_MODEL; const size = a.size || DEFAULT_SIZE; const quality = a.quality || DEFAULT_QUALITY; const timeoutMs = a.timeoutMs || DEFAULT_TIMEOUT; const output = path.resolve(a.output); const parsed = path.parse(output); const paths = a.n === 1 ? [output] : Array.from({ length: a.n }, (_, i) => path.join(parsed.dir, `${parsed.name}-${String(i + 1).padStart(2, "0")}${parsed.ext || ".png"}`));
  if (!a.overwrite) for (const p of paths) { try { await readFile(p); throw new Error(`Output already exists: ${p}. Use --overwrite.`); } catch (e) { if (e.code !== "ENOENT") throw e; } }
  const controls = imageControls(a.size, a.aspectRatio, a.resolution); const body = { model, prompt, ...controls, quality, n: a.n }; if (a.debug) log(`Request: ${JSON.stringify({ ...body, prompt: "<redacted>" })}`);
  const started = Date.now(); const response = await request(`${connection.baseUrl}/images/generations`, body, connection.apiKey, timeoutMs); let payload; try { payload = JSON.parse(response.text); } catch { payload = null; }
  if (response.status < 200 || response.status >= 300) throw new Error(`Images API request failed (${response.status}): ${apiErrorMessage(payload)}`);
  let items = findImages(payload); if (!items.length) throw new Error("Images API response did not contain image data"); const saved = [];
  for (let i = 0; i < Math.min(items.length, paths.length); i++) { const item = items[i]; const bytes = item.bytes || await download(item.url, connection.apiKey, timeoutMs); if (!bytes.length) throw new Error("API returned an empty image"); await mkdir(path.dirname(paths[i]), { recursive: true }); await writeFile(paths[i], bytes); saved.push({ path: paths[i], mime: item.mime || sniff(bytes), byteCount: bytes.length, dimensions: dimensions(bytes) }); }
  if (saved.length !== paths.length) throw new Error(`API returned ${saved.length} image(s), requested ${paths.length}`);
  const result = { status: "succeeded", outputs: saved, metadataPath: a.metadata ? path.resolve(a.metadataPath || `${output}.json`) : undefined };
  if (a.metadata) { const metadata = { schemaVersion: 1, skill: "stormforge-grok-imagine-image", model, requested: { prompt: promptMeta(prompt, a.metadataPrompt), aspectRatio: controls.aspect_ratio, resolution: controls.resolution, quality, n: a.n }, outputs: saved, durationMs: Date.now() - started, createdAt: new Date().toISOString() }; await writeFile(result.metadataPath, JSON.stringify(metadata, null, 2)); }
  return result;
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) { main().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }).catch(error => { process.stderr.write(`Error: ${error.message}\n`); process.exitCode = 1; }); }
export { main, parseGrokConfig };





