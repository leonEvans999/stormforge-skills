import { SkillError } from "./utils.mjs";

export function usage() {
  return `Usage:
  node scripts/main.mjs --prompt <text> --output <path> [options]
  node scripts/main.mjs --batchfile <path> [options]

Core options:
  --prompt <text>                 Prompt text
  --prompt-file <path>            Read prompt from a file
  --output, --image <path>        Output image path
  --input-image, --ref <value>    Local path, Data URL, or raw Base64 (repeatable)
  --input-image-base64-file <p>   Read Base64 or Data URL from a file
  --mask <path>                   PNG mask for one-image edits
  --model <id>                    Image model (default: gpt-image-2)
  --base-url <url>                OpenAI-compatible API base URL
  --api-key <key>                 API key (prefer OPENAI_API_KEY)
  --use-codex-config              Read base URL and token from Codex config

Image options:
  --size <WxH|auto>               Exact output size
  --ar <ratio>                    Aspect ratio, e.g. 16:9
  --resolution <1k|2k|4k>         Resolution class for --ar
  --quality <auto|low|medium|high>
  --format <png|jpeg|webp>
  --compression <0-100>
  --background <auto|opaque|transparent>
  --moderation <auto|low>
  --n <1-10>
  --n-strategy <auto|single-request|separate-requests>

Batch and runtime options:
  --batchfile <path>              JSON batch file
  --jobs <count>                  Batch worker count
  --retries <count>               Retries after the initial request
  --start-interval-ms <ms>        Delay between request starts
  --timeout-ms <ms>               Per-request timeout
  --resume                        Resume verified successful tasks
  --overwrite                     Overwrite existing outputs
  --metadata <path>               Metadata path
  --no-metadata                   Disable metadata
  --metadata-prompt <full|hash|omit>
  --strict-size                   Fail if returned size differs
  --dry-run                       Validate without calling the API
  --quiet                         Print only final paths
  --verbose                       Print detailed progress
  --debug                         Print sanitized request/response details
  --json                          Emit machine-readable JSON
  -h, --help                      Show this help`;
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new SkillError(`Missing value for ${option}`, "ValidationError");
  return [value, index + 1];
}

export function parseArgs(argv) {
  const args = { inputImages: [], inputImageBase64Files: [], writeMetadata: true, positionals: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") { args.help = true; continue; }
    if (arg === "--prompt") { [args.prompt, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--prompt-file") { [args.promptFile, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--output" || arg === "--image") { const [v, next] = takeValue(argv, i, arg); args.outputs = args.outputs || []; args.outputs.push({ option: arg, value: v }); i = next; continue; }
    if (arg === "--input-image" || arg === "--reference" || arg === "--ref") { const [v, next] = takeValue(argv, i, arg); args.inputImages.push(v); i = next; continue; }
    if (arg === "--input-image-base64-file") { const [v, next] = takeValue(argv, i, arg); args.inputImageBase64Files.push(v); i = next; continue; }
    if (arg === "--mask") { [args.mask, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--model" || arg === "--tool-model") { const [v, next] = takeValue(argv, i, arg); args.models = args.models || []; args.models.push({ option: arg, value: v }); i = next; continue; }
    if (arg === "--base-url") { [args.baseUrl, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--api-key") { [args.apiKey, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--use-codex-config") { args.useCodexConfig = true; continue; }
    if (arg === "--size" || arg === "--tool-size") { const [v, next] = takeValue(argv, i, arg); args.sizes = args.sizes || []; args.sizes.push({ option: arg, value: v }); i = next; continue; }
    if (arg === "--ar") { [args.aspectRatio, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--resolution") { [args.resolution, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--quality" || arg === "--tool-quality") { const [v, next] = takeValue(argv, i, arg); args.qualities = args.qualities || []; args.qualities.push({ option: arg, value: v }); i = next; continue; }
    if (arg === "--format") { [args.format, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--compression") { [args.compression, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--background") { [args.background, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--moderation") { [args.moderation, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--n" || arg === "--count") { const [v, next] = takeValue(argv, i, arg); args.counts = args.counts || []; args.counts.push({ option: arg, value: v }); i = next; continue; }
    if (arg === "--n-strategy") { [args.nStrategy, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--batchfile") { [args.batchFile, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--jobs") { [args.jobs, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--retries") { [args.retries, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--start-interval-ms") { [args.startIntervalMs, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--timeout-ms") { [args.timeoutMs, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--metadata") { [args.metadata, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--metadata-prompt") { [args.metadataPrompt, i] = takeValue(argv, i, arg); continue; }
    if (arg === "--no-metadata") { args.writeMetadata = false; continue; }
    if (arg === "--resume") { args.resume = true; continue; }
    if (arg === "--overwrite") { args.overwrite = true; continue; }
    if (arg === "--strict-size") { args.strictSize = true; continue; }
    if (arg === "--dry-run") { args.dryRun = true; continue; }
    if (arg === "--quiet") { args.quiet = true; continue; }
    if (arg === "--verbose") { args.verbose = true; continue; }
    if (arg === "--debug") { args.debug = true; continue; }
    if (arg === "--json") { args.json = true; continue; }
    if (arg.startsWith("-")) throw new SkillError(`Unknown argument: ${arg}`, "ValidationError");
    args.positionals.push(arg);
  }
  if (!args.prompt && !args.promptFile && args.positionals.length) args.prompt = args.positionals.join(" ");
  return args;
}

function resolveAliasList(items, canonicalName) {
  if (!items?.length) return undefined;
  const values = new Set(items.map((item) => item.value));
  if (values.size > 1) throw new SkillError(`Conflicting values supplied for ${canonicalName}: ${[...values].join(", ")}`, "ValidationError");
  return items[items.length - 1].value;
}

export function normalizeCliArgs(args) {
  const output = resolveAliasList(args.outputs, "--output/--image");
  const model = resolveAliasList(args.models, "--model/--tool-model");
  const size = resolveAliasList(args.sizes, "--size/--tool-size");
  const quality = resolveAliasList(args.qualities, "--quality/--tool-quality");
  const count = resolveAliasList(args.counts, "--n/--count");
  if (args.resume && args.overwrite) throw new SkillError("--resume and --overwrite cannot be used together.", "ValidationError");
  if (args.batchFile && (args.prompt || args.promptFile || output)) throw new SkillError("--batchfile cannot be combined with single-task prompt or output options.", "ValidationError");
  if (!args.batchFile && !args.help && !args.prompt && !args.promptFile) throw new SkillError("Missing --prompt or --prompt-file.", "ValidationError");
  if (!args.batchFile && !args.help && !output) throw new SkillError("Missing --output (or compatibility alias --image).", "ValidationError");
  return { ...args, output, model, size, quality, count };
}
