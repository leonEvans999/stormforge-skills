#!/usr/bin/env node
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { normalizeCliArgs, parseArgs, usage } from "./arguments.mjs";
import { executeBatch, loadBatchFile } from "./batch.mjs";
import { mergeGenerationLayers, resolveGlobalConfig, validateTaskConfig } from "./config.mjs";
import { runImagesTask } from "./image-api.mjs";
import { loadImageInputs, loadMask, publicImageInput } from "./image-input.mjs";
import {
  atomicWrite, dimensionsFromBytes, exists, getExtensionForMime, getMimeTypeFromBytes, parsePixelSize,
  safeErrorMessage, sha256, SkillError,
} from "./utils.mjs";

function logFactory(cli) {
  const write = (level, message) => {
    if (cli.quiet && level !== "error") return;
    if (!cli.verbose && level === "verbose") return;
    if (!cli.debug && level === "debug") return;
    process.stderr.write(`${message}\n`);
  };
  return {
    info: (message) => write("info", message),
    verbose: (message) => write("verbose", message),
    debug: (value) => write("debug", `[debug] ${JSON.stringify(value)}`),
    warn: (message) => write("warn", `Warning: ${message}`),
    error: (message) => write("error", `Error: ${message}`),
  };
}

function outputPaths(output, count, format) {
  if (count === 1) return [path.resolve(output)];
  const absolute = path.resolve(output);
  const parsed = path.parse(absolute);
  const ext = parsed.ext || getExtensionForMime(`image/${format === "jpeg" ? "jpeg" : format}`);
  const stem = parsed.ext ? path.join(parsed.dir, parsed.name) : absolute;
  return Array.from({ length: count }, (_, index) => `${stem}-${String(index + 1).padStart(2, "0")}${ext}`);
}

function metadataPathFor(config, paths) {
  if (config.metadata) return path.resolve(config.metadata);
  if (paths.length === 1) return `${paths[0]}.json`;
  return `${paths[0].replace(/-01(\.[^.]+)$/, "")}.json`;
}

async function resolvePrompt(task, cwd) {
  if (task.prompt !== undefined) return String(task.prompt);
  const files = task.promptFiles || (task.promptFile ? [task.promptFile] : []);
  if (!files.length) throw new SkillError("Missing prompt.", "ValidationError");
  const values = [];
  for (const file of files) {
    const absolute = path.resolve(cwd, file);
    try { values.push((await readFile(absolute, "utf8")).trim()); }
    catch (error) { throw new SkillError(`Unable to read prompt file ${absolute}: ${error.message}`, "ValidationError"); }
  }
  return values.join("\n\n");
}

async function ensureOutputAvailability(paths, metadataPath, config) {
  if (config.overwrite) return;
  for (const file of [...paths, ...(config.writeMetadata ? [metadataPath] : [])]) {
    if (await exists(file)) throw new SkillError(`Output already exists: ${file}. Use --overwrite or choose another path.`, "OutputFileError");
  }
}

async function promptMetadata(prompt, mode) {
  if (mode === "omit") return undefined;
  if (mode === "hash") return { sha256: await sha256(Buffer.from(prompt, "utf8")), length: prompt.length };
  return prompt;
}

function requestedDimensions(size) { return size === "auto" ? null : parsePixelSize(size); }

function publicConfig(config) {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    size: config.size,
    quality: config.quality,
    format: config.format,
    compression: config.compression,
    background: config.background,
    moderation: config.moderation,
    n: config.count,
    nStrategy: config.nStrategy,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
  };
}

async function executeTask(task, inheritedConfig, cli, signal, logger) {
  const cwd = task.cwd || process.cwd();
  const prompt = await resolvePrompt(task, cwd);
  const output = task.output || inheritedConfig.output;
  const rawConfig = mergeGenerationLayers(inheritedConfig, task, { output, prompt });
  rawConfig.overwrite = cli.overwrite;
  rawConfig.resume = cli.resume;
  rawConfig.strictSize = task.strictSize ?? cli.strictSize ?? rawConfig.strictSize;
  rawConfig.metadata = task.metadata ?? cli.metadata ?? rawConfig.metadata;
  rawConfig.writeMetadata = task.writeMetadata ?? cli.writeMetadata ?? rawConfig.writeMetadata;
  rawConfig.metadataPrompt = task.metadataPrompt ?? cli.metadataPrompt ?? rawConfig.metadataPrompt;
  const config = validateTaskConfig(rawConfig, { requireConnection: !cli.dryRun });
  config.prompt = prompt;
  config.output = output;
  if (config.apiKey && cli.apiKey) logger.warn("Passing --api-key may expose credentials in shell history and process listings; prefer OPENAI_API_KEY.");

  const inputs = await loadImageInputs(task.inputImages || cli.inputImages || [], task.inputImageBase64Files || cli.inputImageBase64Files || [], { cwd });
  const mask = await loadMask(task.mask || cli.mask, inputs, { cwd });
  const paths = outputPaths(output, config.count, config.format);
  const metadataPath = metadataPathFor(config, paths);
  await ensureOutputAvailability(paths, metadataPath, config);

  if (cli.dryRun) {
    return { status: "validated", dryRun: true, outputPaths: paths, metadataPath: config.writeMetadata ? metadataPath : undefined, config: publicConfig(config), inputImages: inputs.map(publicImageInput), mask: mask ? publicImageInput(mask) : undefined };
  }

  logger.verbose(`Generating ${config.count} image(s) via ${inputs.length || mask ? "/images/edits" : "/images/generations"}...`);
  const apiResult = await runImagesTask(config, {
    inputs,
    mask,
    signal,
    onRetry: ({ attempt, delayMs, error }) => logger.warn(`Attempt ${attempt} failed (${error.code || error.name}); retrying in ${delayMs} ms.`),
    onDebug: (value) => logger.debug(value),
  });

  const warnings = [];
  const saved = [];
  const expected = requestedDimensions(config.size);
  for (const [index, image] of apiResult.images.entries()) {
    const actualMime = getMimeTypeFromBytes(image.bytes);
    const actualDimensions = dimensionsFromBytes(image.bytes, actualMime);
    const expectedMime = `image/${config.format === "jpeg" ? "jpeg" : config.format}`;
    const itemWarnings = [];
    if (actualMime !== expectedMime) itemWarnings.push(`Requested ${expectedMime}, but the API returned ${actualMime}.`);
    const sizeMismatch = expected && actualDimensions && (expected.width !== actualDimensions.width || expected.height !== actualDimensions.height);
    if (sizeMismatch) itemWarnings.push(`Requested ${config.size}, but the API returned ${actualDimensions.width}x${actualDimensions.height}.`);
    let finalPath = paths[index];
    if (sizeMismatch && config.strictSize) {
      const parsed = path.parse(finalPath);
      finalPath = path.join(parsed.dir, `${parsed.name}.size-mismatch${parsed.ext}`);
      if (!config.overwrite && await exists(finalPath)) throw new SkillError(`Diagnostic output already exists: ${finalPath}`, "OutputFileError");
    }
    try { await atomicWrite(finalPath, image.bytes); }
    catch (error) { throw new SkillError(`Unable to write image ${finalPath}: ${error.message}`, "OutputFileError"); }
    const record = {
      path: finalPath,
      mime: actualMime,
      dimensions: actualDimensions,
      byteCount: image.bytes.length,
      sha256: await sha256(image.bytes),
      source: image.source,
      revisedPrompt: image.revisedPrompt,
      warnings: itemWarnings.length ? itemWarnings : undefined,
    };
    saved.push(record);
    warnings.push(...itemWarnings);
  }

  const strictFailure = config.strictSize && warnings.some((warning) => warning.startsWith("Requested ") && warning.includes("API returned") && /\d+x\d+/.test(warning));
  const metadata = {
    schemaVersion: 1,
    skill: "stormforge-image-gen",
    apiMode: "images",
    endpointPath: apiResult.endpointPath,
    model: config.model,
    requested: {
      prompt: await promptMetadata(prompt, config.metadataPrompt),
      size: config.size,
      quality: config.quality,
      format: config.format,
      compression: config.compression,
      background: config.background,
      moderation: config.moderation,
      n: config.count,
      nStrategy: config.nStrategy,
    },
    inputImages: inputs.map(publicImageInput),
    mask: mask ? publicImageInput(mask) : undefined,
    requestIds: apiResult.requestIds,
    attempts: apiResult.attempts,
    durationMs: apiResult.durationMs,
    strategy: apiResult.strategy,
    outputs: saved,
    warnings: warnings.length ? warnings : undefined,
    createdAt: new Date().toISOString(),
  };
  if (config.writeMetadata) {
    try { await atomicWrite(metadataPath, JSON.stringify(metadata, null, 2)); }
    catch (error) { throw new SkillError(`Unable to write metadata ${metadataPath}: ${error.message}`, "OutputFileError"); }
  }
  for (const warning of warnings) logger.warn(warning);
  if (strictFailure) throw new SkillError("Returned image size did not match the requested size. The received image was preserved with a .size-mismatch name.", "ApiResponseError");
  return { status: warnings.length ? "succeeded_with_warning" : "succeeded", outputs: saved, metadataPath: config.writeMetadata ? metadataPath : undefined, warnings, fingerprintData: { config: publicConfig(config), inputHashes: inputs.map((item) => item.sha256), maskHash: mask?.sha256, promptHash: await sha256(Buffer.from(prompt)) } };
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const parsed = normalizeCliArgs(parseArgs(argv));
  if (parsed.help) { process.stdout.write(`${usage()}\n`); return { exitCode: 0 }; }
  const logger = options.logger || logFactory(parsed);
  const controller = options.controller || new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);
  try {
    const globalConfig = await resolveGlobalConfig(parsed, { cwd: options.cwd || process.cwd(), homeDir: options.homeDir, env: options.env || process.env });
    let result;
    if (parsed.batchFile) {
      const batch = await loadBatchFile(parsed.batchFile, { cwd: options.cwd || process.cwd() });
      validateTaskConfig({ ...globalConfig, output: "batch.png" }, { requireConnection: !parsed.dryRun });
      result = await executeBatch(batch, {
        globalConfig,
        cli: parsed,
        signal: controller.signal,
        onProgress: ({ type, task, error }) => {
          if (type === "started") logger.verbose(`[${task.id}] started`);
          if (type === "completed") logger.info(`[${task.id}] completed`);
          if (type === "skipped") logger.info(`[${task.id}] resumed`);
          if (type === "failed") logger.error(`[${task.id}] ${safeErrorMessage(error)}`);
        },
        runTask: (task, config, signal) => executeTask({ ...task, cwd: batch.baseDir }, config, parsed, signal, logger),
      });
    } else {
      const task = { prompt: parsed.prompt, promptFile: parsed.promptFile, output: parsed.output, inputImages: parsed.inputImages, inputImageBase64Files: parsed.inputImageBase64Files, mask: parsed.mask, metadata: parsed.metadata };
      result = await executeTask(task, { ...globalConfig, output: parsed.output }, parsed, controller.signal, logger);
    }
    if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (result.outputs) for (const output of result.outputs) process.stdout.write(`${output.path}\n`);
    else if (result.dryRun) process.stdout.write("Validation succeeded.\n");
    else if (result.batchFile) process.stdout.write(`Batch complete: ${result.succeeded} succeeded, ${result.failed} failed.\nState: ${result.statePath}\n`);
    return { exitCode: result.failed ? 1 : 0, result };
  } catch (error) {
    logger.error(safeErrorMessage(error));
    const exitCode = error.code === "AbortError" ? 130 : ["ConfigurationError", "ValidationError", "BatchError", "InputImageError"].includes(error.code) ? 2 : 1;
    return { exitCode, error };
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const { exitCode } = await main();
  process.exitCode = exitCode;
}
