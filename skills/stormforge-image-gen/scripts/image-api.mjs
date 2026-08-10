import { dimensionsFromBytes, getMimeTypeFromBytes, redact, safeErrorMessage, sleep, SkillError } from "./utils.mjs";

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUSES = new Set([400, 401, 402, 403, 404, 413, 422]);

function retryAfterMs(headers) {
  const value = headers?.get?.("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function requestIds(headers) {
  const result = {};
  for (const name of ["x-request-id", "request-id", "x-trace-id"]) {
    const value = headers?.get?.(name);
    if (value) result[name] = value;
  }
  return result;
}

function responseExcerpt(text) {
  return redact(String(text || "").replace(/\s+/g, " ").slice(0, 2000));
}

function apiMessage(text, status) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || parsed?.message || `HTTP ${status}`;
  } catch {
    return responseExcerpt(text) || `HTTP ${status}`;
  }
}

function httpError(status, text, headers, context = "Images API") {
  const message = apiMessage(text, status);
  const code = status === 401 || status === 403 ? "AuthenticationError" : status === 429 ? "RateLimitError" : "ApiRequestError";
  return new SkillError(`${context} request failed (${status}): ${message}`, code, {
    status,
    retryable: RETRYABLE_STATUSES.has(status),
    retryAfterMs: retryAfterMs(headers),
    responseExcerpt: responseExcerpt(text),
    nUnsupported: (status === 400 || status === 422) && /(?:\bn\b|number of images|image count).*(?:unsupported|not supported|must be 1|invalid)/i.test(message),
    requestIds: requestIds(headers),
  });
}

export function isRetryable(error) {
  if (error?.retryable === true) return true;
  if (error?.retryable === false) return false;
  if (error?.status && NON_RETRYABLE_STATUSES.has(error.status)) return false;
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(error?.cause?.code || error?.code);
}

export function retryDelayMs(attempt, error, random = Math.random) {
  if (Number.isFinite(error?.retryAfterMs)) return error.retryAfterMs;
  const base = Math.min(30000, 500 * (2 ** Math.max(0, attempt - 1)));
  return Math.round(base * (0.75 + random() * 0.5));
}

async function fetchWithTimeout(url, options, timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) throw new SkillError("Operation cancelled.", "AbortError", { retryable: false });
    if (timedOut) throw new SkillError(`Request timed out after ${timeoutMs} ms.`, "ApiRequestError", { retryable: true, cause: error });
    throw new SkillError(`Network request failed: ${safeErrorMessage(error)}`, "ApiRequestError", { retryable: true, cause: error });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

export async function withRetries(operation, { retries = 2, signal, onRetry, random = Math.random } = {}) {
  const startedAt = Date.now();
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    if (signal?.aborted) throw new SkillError("Operation cancelled.", "AbortError", { retryable: false });
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt, durationMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
      if (attempt > retries || !isRetryable(error)) throw Object.assign(error, { attempts: attempt, durationMs: Date.now() - startedAt });
      const delayMs = retryDelayMs(attempt, error, random);
      onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function appendCommonFields(target, config, n) {
  const fields = {
    model: config.model,
    prompt: config.prompt,
    size: config.size,
    quality: config.quality,
    background: config.background,
    output_format: config.format,
    output_compression: config.compression,
    moderation: config.moderation,
    n,
  };
  if (target instanceof FormData) {
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) target.append(key, String(value));
  } else {
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) target[key] = value;
  }
}

export function buildGenerationRequest(config, n = config.count) {
  const body = {};
  appendCommonFields(body, config, n);
  return body;
}

export function buildEditRequest(config, inputs, mask, n = config.count) {
  const form = new FormData();
  appendCommonFields(form, config, n);
  for (const [index, input] of inputs.entries()) {
    form.append("image[]", new Blob([input.bytes], { type: input.mime }), input.filename || `reference-${index + 1}`);
  }
  if (mask) form.append("mask", new Blob([mask.bytes], { type: "image/png" }), mask.filename || "mask.png");
  return form;
}

async function callJsonEndpoint(url, body, config, signal) {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, config.timeoutMs, signal);
  const text = await response.text();
  if (!response.ok) throw httpError(response.status, text, response.headers);
  try { return { json: JSON.parse(text), requestIds: requestIds(response.headers) }; }
  catch { throw new SkillError(`Images API returned invalid JSON: ${responseExcerpt(text)}`, "ApiResponseError", { retryable: false }); }
}

async function callMultipartEndpoint(url, form, config, signal) {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  }, config.timeoutMs, signal);
  const text = await response.text();
  if (!response.ok) throw httpError(response.status, text, response.headers);
  try { return { json: JSON.parse(text), requestIds: requestIds(response.headers) }; }
  catch { throw new SkillError(`Images API returned invalid JSON: ${responseExcerpt(text)}`, "ApiResponseError", { retryable: false }); }
}

function decodeBase64(value) {
  const compact = String(value || "").replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new SkillError("Images API returned invalid b64_json data.", "ApiResponseError", { retryable: false });
  const bytes = Buffer.from(compact, "base64");
  if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== compact.replace(/=+$/, "")) throw new SkillError("Images API returned invalid b64_json data.", "ApiResponseError", { retryable: false });
  return bytes;
}

async function downloadImage(url, config, signal) {
  let parsed;
  try { parsed = new URL(url); }
  catch { throw new SkillError("Images API returned an invalid image URL.", "ApiResponseError", { retryable: false }); }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new SkillError("Images API returned an unsupported image URL protocol.", "ApiResponseError", { retryable: false });
  const response = await fetchWithTimeout(parsed, { method: "GET", redirect: "follow" }, config.timeoutMs, signal);
  if (!response.ok) {
    const text = await response.text();
    const error = httpError(response.status, text, response.headers, "Image download");
    error.name = "ImageDownloadError";
    error.code = "ImageDownloadError";
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

async function extractImages(payload, config, signal, onRetry) {
  if (!Array.isArray(payload?.data) || !payload.data.length) throw new SkillError("Images API response did not contain data[].", "ApiResponseError", { retryable: false });
  const outputs = [];
  for (const [index, item] of payload.data.entries()) {
    let bytes;
    let source;
    let downloadAttempts = 0;
    if (item?.b64_json) {
      bytes = decodeBase64(item.b64_json);
      source = "b64_json";
    } else if (item?.url) {
      const result = await withRetries(() => downloadImage(item.url, config, signal), { retries: config.retries, signal, onRetry });
      bytes = result.value;
      downloadAttempts = result.attempts;
      source = "url";
    } else {
      throw new SkillError(`Images API data[${index}] contains neither b64_json nor url.`, "ApiResponseError", { retryable: false });
    }
    const mime = getMimeTypeFromBytes(bytes);
    if (!mime) throw new SkillError(`Images API data[${index}] is not a supported PNG, JPEG, or WebP image.`, "ApiResponseError", { retryable: false });
    outputs.push({ bytes, mime, dimensions: dimensionsFromBytes(bytes, mime), revisedPrompt: item.revised_prompt, source, downloadAttempts });
  }
  return outputs;
}

async function performRequest(config, inputs, mask, n, signal) {
  const edits = inputs.length > 0 || Boolean(mask);
  const endpointPath = edits ? "/images/edits" : "/images/generations";
  const url = `${config.baseUrl}${endpointPath}`;
  const response = edits
    ? await callMultipartEndpoint(url, buildEditRequest(config, inputs, mask, n), config, signal)
    : await callJsonEndpoint(url, buildGenerationRequest(config, n), config, signal);
  return { ...response, endpointPath };
}

export async function runImagesTask(config, { inputs = [], mask = null, signal, onRetry, onDebug } = {}) {
  const requestedCount = config.count;
  const separate = config.nStrategy === "separate-requests";
  const call = async (n) => withRetries((attempt) => {
    onDebug?.({ type: "request", endpoint: inputs.length || mask ? "/images/edits" : "/images/generations", attempt, n, model: config.model, size: config.size, inputCount: inputs.length, hasMask: Boolean(mask) });
    return performRequest(config, inputs, mask, n, signal);
  }, { retries: config.retries, signal, onRetry });

  const accumulated = [];
  let totalAttempts = 0;
  let durationMs = 0;
  let endpointPath;
  const ids = {};
  let strategy = separate ? "separate-requests" : "single-request";

  const processCall = async (n) => {
    let result;
    try { result = await call(n); }
    catch (error) {
      totalAttempts += error.attempts || 1;
      durationMs += error.durationMs || 0;
      throw error;
    }
    totalAttempts += result.attempts;
    durationMs += result.durationMs;
    endpointPath = result.value.endpointPath;
    Object.assign(ids, result.value.requestIds);
    const images = await extractImages(result.value.json, config, signal, onRetry);
    accumulated.push(...images);
    onDebug?.({ type: "response", dataCount: result.value.json?.data?.length || 0, requestIds: result.value.requestIds });
  };

  if (separate) {
    for (let i = 0; i < requestedCount; i += 1) await processCall(1);
  } else {
    try {
      await processCall(requestedCount);
    } catch (error) {
      if (config.nStrategy === "auto" && requestedCount > 1 && error?.nUnsupported) {
        strategy = "separate-requests";
        for (let i = 0; i < requestedCount; i += 1) await processCall(1);
      } else throw error;
    }
  }

  if (accumulated.length < requestedCount) throw new SkillError(`Images API returned ${accumulated.length} image(s), but ${requestedCount} were requested.`, "ApiResponseError", { retryable: false });
  return { images: accumulated.slice(0, requestedCount), attempts: totalAttempts, durationMs, endpointPath, requestIds: ids, strategy };
}
