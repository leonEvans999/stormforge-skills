import path from "node:path";
import { readFile } from "node:fs/promises";
import { atomicWrite, exists, readJson, sha256, SkillError } from "./utils.mjs";

function alias(task, canonical, aliases) {
  const values = [task[canonical], ...aliases.map((key) => task[key])].filter((value) => value !== undefined);
  if (values.length > 1 && values.some((value) => JSON.stringify(value) !== JSON.stringify(values[0]))) {
    throw new SkillError(`Conflicting batch task values for ${canonical}.`, "BatchError");
  }
  return values[0];
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveMaybe(value, baseDir) {
  return typeof value === "string" ? path.resolve(baseDir, value) : value;
}

function normalizeTask(task, index, baseDir) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new SkillError(`Batch task ${index + 1} must be an object.`, "BatchError");
  const prompt = task.prompt;
  const promptValue = alias(task, "promptFile", ["promptFiles"]);
  const promptFiles = asArray(promptValue);
  if ([prompt !== undefined, promptFiles.length > 0].filter(Boolean).length !== 1) {
    throw new SkillError(`Batch task ${index + 1} must use exactly one of prompt, promptFile, or promptFiles.`, "BatchError");
  }
  const output = alias(task, "output", ["image"]);
  if (!output) throw new SkillError(`Batch task ${index + 1} is missing output.`, "BatchError");
  const inputs = asArray(alias(task, "inputImages", ["ref", "referenceImages"]));
  const normalized = {
    ...task,
    id: String(task.id || `task-${String(index + 1).padStart(3, "0")}`),
    prompt,
    promptFiles: promptFiles.length ? promptFiles.map((value) => resolveMaybe(value, baseDir)) : undefined,
    output: resolveMaybe(output, baseDir),
    inputImages: inputs.map((value) => resolveMaybe(value, baseDir)),
    inputImageBase64Files: asArray(task.inputImageBase64Files).map((value) => resolveMaybe(value, baseDir)),
    mask: resolveMaybe(task.mask, baseDir),
    metadata: resolveMaybe(task.metadata, baseDir),
    ar: alias(task, "ar", ["aspectRatio"]),
    count: alias(task, "n", ["count"]),
  };
  for (const key of ["image", "ref", "referenceImages", "aspectRatio", "promptFile", "n"]) delete normalized[key];
  return normalized;
}

function inferFormat(output, configured) {
  if (configured) return String(configured).toLowerCase();
  const ext = path.extname(output).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".webp") return "webp";
  return "png";
}

function plannedOutputs(task, defaults) {
  const count = Number(task.count ?? defaults.count ?? defaults.n ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new SkillError(`Batch task ${task.id} has invalid n/count.`, "BatchError");
  if (count === 1) return [task.output];
  const parsed = path.parse(task.output);
  const format = inferFormat(task.output, task.format ?? defaults.format);
  const ext = parsed.ext || (format === "jpeg" ? ".jpg" : `.${format}`);
  const stem = parsed.ext ? path.join(parsed.dir, parsed.name) : task.output;
  return Array.from({ length: count }, (_, index) => `${stem}-${String(index + 1).padStart(2, "0")}${ext}`);
}

function validateUniqueTasks(tasks, defaults) {
  const ids = new Set();
  const outputs = new Map();
  const register = (file, taskId, kind) => {
    const key = path.resolve(file).toLowerCase();
    if (outputs.has(key)) throw new SkillError(`Batch ${kind} collision between ${outputs.get(key)} and ${taskId}: ${file}`, "BatchError");
    outputs.set(key, taskId);
  };
  for (const task of tasks) {
    if (ids.has(task.id)) throw new SkillError(`Duplicate batch task id: ${task.id}`, "BatchError");
    ids.add(task.id);
    const taskOutputs = plannedOutputs(task, defaults);
    for (const output of taskOutputs) register(output, task.id, "output");
    const writesMetadata = task.writeMetadata ?? defaults.writeMetadata ?? true;
    if (writesMetadata) {
      const metadata = task.metadata || (taskOutputs.length === 1
        ? `${taskOutputs[0]}.json`
        : `${taskOutputs[0].replace(/-01(\.[^.]+)$/, "")}.json`);
      register(metadata, task.id, "metadata");
    }
  }
}

export async function loadBatchFile(filePath, { cwd = process.cwd() } = {}) {
  const absolute = path.resolve(cwd, filePath);
  let parsed;
  try { parsed = JSON.parse(await readFile(absolute, "utf8")); }
  catch (error) { throw new SkillError(`Unable to read batch file ${absolute}: ${error.message}`, "BatchError"); }
  const baseDir = path.dirname(absolute);
  const tasks = Array.isArray(parsed) ? parsed : parsed?.tasks;
  if (!Array.isArray(tasks) || !tasks.length) throw new SkillError("Batch file must contain a non-empty tasks array.", "BatchError");
  if (!Array.isArray(parsed) && parsed.version !== undefined && parsed.version !== 1) throw new SkillError(`Unsupported batch version: ${parsed.version}`, "BatchError");
  const defaults = Array.isArray(parsed) ? {} : { ...(parsed.defaults || {}) };
  const batchJobs = Array.isArray(parsed) ? undefined : parsed.jobs;
  const normalizedTasks = tasks.map((task, index) => normalizeTask(task, index, baseDir));
  validateUniqueTasks(normalizedTasks, defaults);
  const name = path.parse(absolute).name;
  return { filePath: absolute, baseDir, defaults, jobs: batchJobs, tasks: normalizedTasks, statePath: path.join(baseDir, `${name}.results.json`) };
}

export async function taskFingerprint(task, settings = {}) {
  const fileHash = async (file) => file && await exists(file) ? await sha256(file) : `missing:${file}`;
  const promptParts = task.prompt !== undefined
    ? [String(task.prompt)]
    : await Promise.all((task.promptFiles || []).map((file) => readFile(file, "utf8")));
  const inputHashes = await Promise.all((task.inputImages || []).map(async (value) => {
    if (typeof value === "string" && await exists(value)) return fileHash(value);
    return sha256(Buffer.from(String(value)));
  }));
  const base64FileHashes = await Promise.all((task.inputImageBase64Files || []).map(fileHash));
  const settingKeys = ["model", "size", "ar", "resolution", "quality", "format", "compression", "background", "moderation", "n", "count", "nStrategy", "strictSize"];
  const generationSettings = Object.fromEntries(settingKeys.filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]));
  return sha256(Buffer.from(JSON.stringify({
    id: task.id,
    promptHash: await sha256(Buffer.from(promptParts.join("\n\n"))),
    inputHashes,
    base64FileHashes,
    maskHash: task.mask ? await fileHash(task.mask) : undefined,
    generationSettings,
  })));
}

async function readState(statePath) {
  if (!(await exists(statePath))) return { version: 1, batchFile: statePath, tasks: {} };
  const state = await readJson(statePath);
  return state && typeof state === "object" ? state : { version: 1, tasks: {} };
}

async function verifiedResume(entry) {
  if (!entry || !["succeeded", "succeeded_with_warning"].includes(entry.status) || !entry.outputs?.length || !entry.fingerprint) return false;
  for (const output of entry.outputs) {
    if (!(await exists(output.path)) || await sha256(output.path) !== output.sha256) return false;
  }
  return true;
}

export async function executeBatch(batch, { globalConfig, cli = {}, runTask, onProgress, signal } = {}) {
  if (typeof runTask !== "function") throw new SkillError("Batch runner is not configured.", "BatchError");
  const jobs = Number(cli.jobs ?? batch.jobs ?? globalConfig.jobs ?? 4);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) throw new SkillError("Batch jobs must be an integer from 1 through 16.", "BatchError");
  const persistState = !cli.dryRun;
  const state = persistState ? await readState(batch.statePath) : { version: 1, batchFile: batch.filePath, tasks: {} };
  state.version = 1;
  state.batchFile = batch.filePath;
  state.tasks = state.tasks || {};
  const pending = [];
  const results = [];
  for (const [index, task] of batch.tasks.entries()) {
    const settings = { ...batch.defaults, ...task };
    const fingerprint = await taskFingerprint(task, settings);
    const previous = state.tasks[task.id];
    if (persistState && cli.resume && previous?.fingerprint === fingerprint && await verifiedResume(previous)) {
      const skipped = { ...previous, status: "skipped", resumed: true, index };
      results.push(skipped);
      onProgress?.({ type: "skipped", task, result: skipped });
    } else pending.push({ task, fingerprint, settings, index });
  }

  let cursor = 0;
  let nextStart = 0;
  let stopped = false;
  const interval = Number(cli.startIntervalMs ?? globalConfig.startIntervalMs ?? 250);
  if (!Number.isInteger(interval) || interval < 0 || interval > 60000) throw new SkillError("Batch start interval must be an integer from 0 through 60000.", "BatchError");
  let saveQueue = Promise.resolve();
  const save = () => {
    if (!persistState) return Promise.resolve();
    saveQueue = saveQueue.then(() => atomicWrite(batch.statePath, JSON.stringify(state, null, 2)));
    return saveQueue;
  };
  const worker = async () => {
    while (!stopped) {
      if (signal?.aborted) { stopped = true; break; }
      const item = pending[cursor++];
      if (!item) return;
      const wait = Math.max(0, nextStart - Date.now());
      nextStart = Math.max(nextStart, Date.now()) + interval;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (signal?.aborted) { stopped = true; break; }
      state.tasks[item.task.id] = { id: item.task.id, status: "running", fingerprint: item.fingerprint, startedAt: new Date().toISOString() };
      await save();
      onProgress?.({ type: "started", task: item.task });
      try {
        const result = await runTask(item.task, { ...globalConfig, ...batch.defaults, ...item.task, ...cli }, signal);
        const completed = { id: item.task.id, status: result.status || "succeeded", fingerprint: item.fingerprint, ...result, index: item.index, completedAt: new Date().toISOString() };
        state.tasks[item.task.id] = completed;
        results.push(completed);
        onProgress?.({ type: "completed", task: item.task, result: completed });
      } catch (error) {
        const failed = { id: item.task.id, status: "failed", fingerprint: item.fingerprint, index: item.index, error: { code: error.code || error.name || "Error", message: error.message }, completedAt: new Date().toISOString() };
        state.tasks[item.task.id] = failed;
        results.push(failed);
        onProgress?.({ type: "failed", task: item.task, result: failed, error });
      }
      await save();
    }
  };

  await Promise.all(Array.from({ length: Math.min(jobs, Math.max(1, pending.length)) }, () => worker()));
  if (signal?.aborted) {
    await save();
    throw new SkillError(`Batch cancelled. Resume with --batchfile "${batch.filePath}" --resume.`, "AbortError");
  }
  results.sort((a, b) => a.index - b.index);
  const failed = results.filter((result) => result.status === "failed");
  const succeeded = results.filter((result) => ["succeeded", "succeeded_with_warning", "skipped", "validated"].includes(result.status));
  await save();
  return { batchFile: batch.filePath, statePath: persistState ? batch.statePath : undefined, jobs, total: batch.tasks.length, succeeded: succeeded.length, failed: failed.length, results };
}
