# Stormforge Image Generation Skill Design

Date: 2026-08-07

## Objective

Add a new self-contained skill named `stormforge-image-gen` that generates and edits images through an OpenAI-compatible Images API. The skill defaults to NxtPath at `https://api.nxtpath.ai/v1` and the `gpt-image-2` model, while remaining configurable for other relays that implement the same API shape.

The existing `stormforge-responses-image-gen` skill remains available and unchanged for relays that only expose the Responses API image-generation tool.

## Design Principles

1. Use the standard Images API routes rather than the Responses API.
2. Keep the runtime dependency-free with Node.js 20+ `.mjs` modules.
3. Preserve the useful command-line interface of `stormforge-responses-image-gen`.
4. Match the task-level capabilities of `baoyu-image-gen` without adding a speculative multi-provider framework.
5. Validate requests locally before using a paid API call.
6. Preserve returned image bytes without resizing or re-encoding them.
7. Keep credentials, Base64 image data, and signed image URLs out of logs and metadata.
8. Keep single-task and batch behavior deterministic, observable, and resumable.

## Repository Layout

```text
skills/
  stormforge-image-gen/
    SKILL.md
    agents/
      openai.yaml
    scripts/
      main.mjs
      arguments.mjs
      config.mjs
      image-api.mjs
      image-input.mjs
      batch.mjs
      utils.mjs
    references/
      usage-examples.md
      configuration.md
      batch-format.md
      image-prompting.md
  stormforge-responses-image-gen/
    ...existing files...
tests/
  stormforge-image-gen/
    arguments.test.mjs
    config.test.mjs
    image-input.test.mjs
    image-size.test.mjs
    image-api.test.mjs
    batch.test.mjs
    integration.test.mjs
docs/
  superpowers/
    specs/
      2026-08-07-stormforge-image-gen-design.md
```

The two image skills must not import each other's runtime code. Each skill remains independently copyable and installable.

## API Routing

The script selects the endpoint from the task inputs.

| Task | Endpoint | Encoding |
|---|---|---|
| Text-to-image | `POST /images/generations` | JSON |
| Reference-image generation | `POST /images/edits` | `multipart/form-data` |
| Masked image edit | `POST /images/edits` | `multipart/form-data` |

The normalized base URL preserves path prefixes and removes only trailing slashes. With the default configuration, the complete endpoints are:

```text
https://api.nxtpath.ai/v1/images/generations
https://api.nxtpath.ai/v1/images/edits
```

## Runtime and Dependencies

The implementation uses only Node.js 20+ built-ins, including:

- `fetch`
- `FormData`
- `Blob`
- `AbortController`
- `node:fs/promises`
- `node:crypto`
- `node:path`
- `node:os`

It must not add Axios, an OpenAI SDK, multipart packages, TypeScript, `tsx`, Bun, or other runtime dependencies.

## Command-Line Interface

Canonical single-task usage:

```powershell
node scripts/main.mjs `
  --prompt "Create a premium technology poster" `
  --output "outputs/poster.png"
```

Prompt files are supported:

```powershell
node scripts/main.mjs `
  --prompt-file "prompts/poster.md" `
  --output "outputs/poster.png"
```

### Compatibility Aliases

| Existing option | Canonical option | Behavior |
|---|---|---|
| `--image` | `--output` | Equivalent alias |
| `--tool-size` | `--size` | Deprecated equivalent alias |
| `--tool-quality` | `--quality` | Deprecated equivalent alias |
| `--tool-model` | `--model` | Deprecated equivalent alias |
| `--input-image` | `--input-image` | Preserved and repeatable |
| `--prompt-file` | `--prompt-file` | Preserved |
| `--metadata` | `--metadata` | Preserved |
| `--no-metadata` | `--no-metadata` | Preserved |
| `--timeout-ms` | `--timeout-ms` | Preserved |
| `--base-url` | `--base-url` | Preserved |
| `--api-key` | `--api-key` | Preserved with a security warning |
| `--use-codex-config` | `--use-codex-config` | Preserved for relay URL and token lookup |

If canonical and legacy aliases are supplied with different values, validation fails rather than silently selecting one.

The new skill gives `--model` a single meaning: the image model sent to the Images API. `--tool-model` is only a compatibility alias when `--model` is absent.

## Default Generation Settings

```text
model      = gpt-image-2
base URL   = https://api.nxtpath.ai/v1
size       = 2048x1152
quality    = high
format     = png
background = auto
moderation = auto
n          = 1
metadata   = enabled
timeout    = 300000ms
```

## Image Parameters

The canonical generation controls are:

```text
--size <WxH|auto>
--ar <ratio>
--resolution <1k|2k|4k>
--quality <auto|low|medium|high>
--format <png|jpeg|webp>
--compression <0-100>
--background <auto|opaque|transparent>
--moderation <auto|low>
--n <1-10>
```

### Exact Size Validation

For `gpt-image-2`, an explicit custom size must satisfy all of these constraints:

- Both dimensions are multiples of 16 pixels.
- The longest edge does not exceed 3840 pixels.
- The ratio between the longest and shortest edge does not exceed 3:1.
- Total pixels are at least 655,360.
- Total pixels do not exceed 8,294,400.

Invalid explicit sizes fail locally and include a suggested valid size. The script must never silently modify an explicit `--size` value.

Examples of valid sizes include:

```text
1024x1024
1536x1024
2048x1152
2048x2048
2880x2880
3840x2160
2160x3840
```

### Aspect-Ratio Convenience

`--ar` calculates a valid custom size while `--resolution` selects the target size class.

Common mappings include:

| Options | Size |
|---|---:|
| `--ar 1:1 --resolution 1k` | `1024x1024` |
| `--ar 1:1 --resolution 2k` | `2048x2048` |
| `--ar 1:1 --resolution 4k` | `2880x2880` |
| `--ar 16:9 --resolution 2k` | `2048x1152` |
| `--ar 9:16 --resolution 2k` | `1152x2048` |
| `--ar 16:9 --resolution 4k` | `3840x2160` |
| `--ar 9:16 --resolution 4k` | `2160x3840` |

Other ratios are accepted when they are positive and do not exceed 3:1, including `4:3`, `3:4`, `3:2`, `2:3`, `21:9`, and `2.35:1`.

Rules:

- `--size` and `--ar` are mutually exclusive when both are explicitly set at the same configuration layer.
- A higher-priority explicit `--ar` clears a lower-priority inherited size, and a higher-priority explicit `--size` clears a lower-priority inherited aspect ratio and resolution. This allows a task-level `ar` to override a batch default size without ambiguity.
- `--ar` without `--resolution` uses `2k`.
- `--resolution` without `--ar` uses `1:1`; an explicit resolution also clears a lower-priority inherited size.
- `--size auto` is sent directly without ratio calculation.
- Calculated sizes are rounded to multiples of 16 and constrained to the supported pixel range.

### Quality

Supported values are `auto`, `low`, `medium`, and `high`. The default is `high`.

### Output Format and Compression

Supported output formats are PNG, JPEG, and WebP.

- The default format is PNG.
- When `--format` is omitted, the output extension may select the format.
- A conflicting output extension and `--format` value is an error.
- `--compression` is valid only for JPEG and WebP.
- Compression must be an integer from 0 through 100.
- The actual response format is detected from file bytes rather than trusted from the requested format.

### Background

The CLI accepts `auto`, `opaque`, and `transparent` for compatibility with OpenAI-compatible image models. The default is `auto`.

Because `gpt-image-2` currently does not support transparent backgrounds, `--model gpt-image-2 --background transparent` fails locally. The parameter remains available for compatible models that support it.

### Multiple Outputs

For `n=1`, the exact output path is used and metadata is written to `<output>.json`.

For `n>1`, numbered paths are generated:

```text
concept-01.png
concept-02.png
concept-03.png
concept-04.png
concept.json
```

The task-level manifest records the requested count, completed count, selected strategy, and every output.

## Reference Images

Equivalent repeatable arguments are:

```text
--input-image
--reference
--ref
```

The first version accepts up to 16 reference images. Supported image formats are PNG, JPEG, and WebP. Each input must be smaller than 50 MB.

Accepted input forms are:

1. A local file path.
2. A complete `data:image/...;base64,...` URL.
3. Raw Base64 image data.
4. A file containing raw Base64 or a complete data URL through `--input-image-base64-file`.

Remote HTTP and HTTPS image URLs are intentionally not accepted as reference inputs in the first version. This avoids implicit third-party access, redirect handling, and SSRF-related behavior. Users can download the image first or provide Base64.

### Input Detection and Validation

Image type is detected from magic bytes:

- PNG signature for `image/png`
- JPEG `FF D8 FF` for `image/jpeg`
- WebP `RIFF....WEBP` for `image/webp`

Validation includes:

- Strict Base64 decoding and round-trip validation.
- File readability.
- Actual MIME-type detection.
- Extension-versus-content warnings.
- Per-file size limits.
- Reference-image count limits.
- SHA-256 calculation for metadata and resume fingerprints.

Base64 and data URLs are never written to metadata or logs.

## Masked Editing

`--mask <path>` enables masked editing through `/images/edits`.

First-version constraints:

- Exactly one reference image is required with a mask.
- The mask must be PNG.
- The mask must be smaller than 50 MB.
- The mask dimensions must match the reference image dimensions.
- Transparent mask regions identify areas that may be regenerated.
- A mask without a reference image is invalid.

PNG dimensions are read from the IHDR chunk without an image-processing dependency.

`input_fidelity` is not exposed in the first version because the default `gpt-image-2` model does not support it.

## Images Edits Multipart Shape

Reference-image tasks submit these fields as applicable:

```text
model
prompt
image[]
mask
size
quality
background
output_format
output_compression
moderation
n
```

Each input image is appended as a separate `image[]` Blob with a safe filename and detected MIME type.

## Response Extraction

The response parser supports both common relay forms:

```json
{
  "data": [
    { "b64_json": "..." }
  ]
}
```

```json
{
  "data": [
    { "url": "https://..." }
  ]
}
```

Processing order:

1. Prefer `b64_json` when present.
2. Fall back to `url`.
3. Download URL outputs with a separate timeout.
4. Detect actual MIME type and dimensions from bytes.
5. Write to a temporary file.
6. Atomically rename to the final path.
7. Write metadata after the image is durable.

The script does not resize, recompress, convert, or otherwise alter returned image bytes.

## Actual-Size Verification

The saved image dimensions are read directly from PNG, JPEG, or WebP headers.

If the requested and actual dimensions differ, default behavior is:

- Preserve the image.
- Write the actual dimensions to metadata.
- Emit a warning.
- Mark the result `succeeded_with_warning`.

`--strict-size` changes a mismatch into a failed task while preserving the received file under a `.size-mismatch` name for diagnosis.

## Configuration

### Environment Variables

Core variables:

```text
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_IMAGE_MODEL
OPENAI_REQUEST_TIMEOUT_MS
```

Batch variables:

```text
STORMFORGE_IMAGE_MAX_JOBS
STORMFORGE_IMAGE_START_INTERVAL_MS
STORMFORGE_IMAGE_RETRIES
```

### Environment Files

Optional environment files are loaded from:

```text
%USERPROFILE%\.stormforge-skills\.env
<current-directory>\.stormforge-skills\.env
```

Only simple `KEY=value` syntax is supported. Shell evaluation, variable interpolation, and command substitution are not supported.

### Non-Secret Preferences

Optional JSON preference files are loaded from:

```text
%USERPROFILE%\.stormforge-skills\image-gen.json
<current-directory>\.stormforge-skills\image-gen.json
```

These files may contain non-secret generation and batch defaults. Credential-like fields such as `apiKey`, `token`, `authorization`, or `bearerToken` are rejected and must be provided through environment variables.

### Configuration Priority

For a single task:

```text
CLI
process environment
project .env
user .env
project image-gen.json
user image-gen.json
Codex provider configuration when explicitly enabled
built-in defaults
```

For batch generation parameters:

```text
CLI
task fields
batch defaults
environment and preference files
built-in defaults
```

Connection settings such as API key, base URL, timeout, jobs, retries, and start interval remain global in batch mode.

### Codex Configuration Compatibility

`--use-codex-config` may read the selected provider's `base_url` and `experimental_bearer_token` from `%USERPROFILE%\.codex\config.toml`.

It must not use the Codex default model as the Images API model. Image-model resolution remains:

```text
--model
OPENAI_IMAGE_MODEL
image-gen.json
gpt-image-2
```

## Batch Mode

Canonical usage:

```powershell
node scripts/main.mjs --batchfile "batch.json"
```

Optional controls:

```text
--jobs <1-16>
--retries <count>
--start-interval-ms <milliseconds>
--resume
--overwrite
--json
```

### Batch File Format

```json
{
  "version": 1,
  "jobs": 4,
  "defaults": {
    "model": "gpt-image-2",
    "size": "2048x1152",
    "quality": "high",
    "format": "png",
    "background": "auto",
    "moderation": "auto"
  },
  "tasks": [
    {
      "id": "hero",
      "promptFile": "prompts/hero.md",
      "output": "outputs/hero.png",
      "ar": "16:9"
    },
    {
      "id": "product-edit",
      "prompt": "Replace the packaging with a minimal black box.",
      "output": "outputs/product-edit.webp",
      "inputImages": ["references/product.png"],
      "format": "webp",
      "compression": 85
    }
  ]
}
```

A top-level task array is also accepted.

Batch aliases mirror useful `baoyu-image-gen` fields:

| Canonical field | Accepted aliases |
|---|---|
| `output` | `image` |
| `inputImages` | `ref`, `referenceImages` |
| `promptFile` | `promptFiles` for one or more ordered files |
| `ar` | `aspectRatio` |
| `n` | `count` |

Paths in `promptFile`, `promptFiles`, `output`, `inputImages`, `mask`, `inputImageBase64Files`, and `metadata` are resolved relative to the batch file.

A task must use exactly one of `prompt`, `promptFile`, or `promptFiles`. Multiple prompt files are concatenated in array order with two newlines between files.

## Concurrency and Rate Control

Batch mode uses an asynchronous worker pool.

- One task runs sequentially.
- Two or more pending tasks enable parallel execution.
- Default maximum concurrency is 4.
- Supported concurrency is 1 through 16.
- Default request start interval is 250 ms.

The start interval controls when requests begin and does not block requests already in progress.

## Retry Policy

The default is an initial request plus up to two retries.

Retryable conditions include:

- Temporary network failures.
- Request timeouts.
- HTTP 408.
- HTTP 429.
- HTTP 500, 502, 503, and 504.
- Temporary image URL download failures.

Non-retryable conditions include:

- HTTP 400, 401, 402, 403, 404, 413, and 422.
- Local validation failures.
- Missing or unreadable files.
- Invalid Base64.
- Unsupported image formats.
- Output collisions.
- Invalid mask dimensions.

Retries use exponential backoff with jitter and honor `Retry-After` when available. Users may disable retries with `--retries 0`.

Documentation must warn that a connection can fail after the server has generated an image but before the client receives it, so retries can occasionally produce duplicate work or additional cost.

## Multiple-Image Request Strategy

`--n-strategy` supports:

```text
auto
single-request
separate-requests
```

`auto` first sends one request with `n`. It switches to separate `n=1` requests only when a 400 or 422 response explicitly identifies `n` as unsupported. Network errors and server failures do not trigger this conversion, avoiding ambiguous duplicate generation.

## Output Protection and Resume

Existing outputs are not overwritten by default.

- `--overwrite` replaces existing outputs.
- `--resume` skips verified completed tasks.
- The two options are mutually exclusive.

Batch state is stored atomically in `<batch-name>.results.json` after every completed task.

A resumable success requires:

1. A succeeded state entry.
2. Existing output files.
3. Matching output SHA-256 values.
4. A matching task fingerprint.

The fingerprint includes the model, prompt, generation settings, input-image hashes, and mask hash. Changed inputs or settings cause regeneration.

One Ctrl+C stops new work, aborts active requests, saves state, prints the resume command, and exits with code 130.

## Logging and Machine Output

Supported modes are:

```text
--quiet
--verbose
--debug
--json
--dry-run
```

Rules:

- Normal progress and warnings go to `stderr`.
- Machine-readable results go to `stdout` in `--json` mode.
- Debug logging prints sanitized request structure and response shape, never credentials or image Base64.
- Dry-run mode resolves configuration and validates inputs without making an API request or writing an image.

## Metadata

Single-image metadata defaults to `<output>.json`. Multi-image and batch tasks use task-level manifests.

Metadata includes:

- Schema version and skill name.
- API mode and endpoint path.
- Model and requested generation settings.
- Prompt according to the selected privacy mode.
- Revised prompt when actually returned.
- Input-image source type, MIME type, byte count, and SHA-256.
- Request identifiers when returned by the relay.
- Attempt count and duration.
- Output path, MIME type, actual dimensions, byte count, and SHA-256.
- Warnings such as size mismatches.

Metadata excludes:

- API keys and bearer tokens.
- Authorization headers.
- Raw Base64 and complete data URLs.
- Signed output URLs.
- Complete raw API responses.

Prompt metadata modes are:

```text
--metadata-prompt full
--metadata-prompt hash
--metadata-prompt omit
```

The default is `full` for compatibility and reproducibility.

## Security and Error Handling

Passing `--api-key` remains supported but emits a warning that command-line credentials can appear in shell history and process listings. Environment variables are recommended.

Errors are classified as:

```text
ConfigurationError
ValidationError
InputImageError
AuthenticationError
RateLimitError
ApiRequestError
ApiResponseError
ImageDownloadError
OutputFileError
BatchError
AbortError
```

API error parsing supports OpenAI-style error objects, top-level message fields, plain text, and HTML responses. Sanitized response excerpts are limited to 2,000 characters.

Recognized request-tracing headers, including `x-request-id`, `request-id`, and `x-trace-id`, may be recorded. Cookies and authorization headers are never recorded.

Exit codes are:

| Result | Exit code |
|---|---:|
| Success | 0 |
| One or more generation tasks failed | 1 |
| Invalid batch or global configuration | 2 |
| User cancellation | 130 |

## Atomic File Writes

Images, metadata, and batch state are first written to a uniquely named temporary file in the destination directory and then renamed to the final path. Failed operations attempt to clean up temporary files.

## Testing Strategy

Tests use Node's built-in `node:test` and `node:assert/strict` modules.

### Unit Tests

Cover:

- Canonical and legacy argument parsing.
- Alias conflicts.
- Configuration loading and priority.
- Size and aspect-ratio validation.
- Format, compression, quality, background, moderation, and count validation.
- Base64 and data URL normalization.
- PNG, JPEG, and WebP detection and dimension parsing.
- Mask validation.
- Output naming and collision detection.
- Retry classification and backoff.
- Batch parsing, fingerprinting, and resume decisions.

### Integration Tests

A local temporary HTTP server simulates the relay and verifies:

- JSON `/images/generations` requests.
- Multipart `/images/edits` requests.
- Base64 responses.
- URL responses.
- Multiple outputs.
- Authentication, rate-limit, validation, and server errors.
- Retry-After handling.
- Timeouts.
- Missing-image responses.
- Returned size and format mismatches.
- Batch concurrency and continuation after failure.

Default tests never call a paid external API.

### Optional Live Test

`npm run test:image-live` runs only when both conditions are met:

```text
STORMFORGE_RUN_LIVE_IMAGE_TESTS=1
OPENAI_API_KEY is set
```

It creates one low-cost test image under `outputs/live-tests/`, which remains ignored by Git.

## Documentation Updates

Implementation must update:

```text
README.md
README.zh.md
AGENTS.md
CLAUDE.md
package.json
```

Requirements:

- `README.md` is English.
- `README.zh.md` is Chinese with equivalent structure and content.
- Files under `docs/` remain English-only.
- Both image skills are listed and clearly distinguished.
- No removed UI-related repository content is restored.
- Repository guidance describes only implemented capabilities.

The README comparison should explain:

| Skill | API | Intended use |
|---|---|---|
| `stormforge-image-gen` | Images API | Preferred direct `gpt-image-2` generation and editing |
| `stormforge-responses-image-gen` | Responses API | Relays that expose only `/responses` image generation |

## Repository Validation

Repository validation should check:

- Skill directory names match `SKILL.md` frontmatter names.
- Every skill name starts with `stormforge-`.
- Every skill contains `SKILL.md` and `agents/openai.yaml`.
- Skill descriptions are long enough to trigger reliably.
- `docs/` contains no Chinese text.
- English and Chinese README structures remain aligned.
- Generated outputs and `.env` files are not tracked.
- Text files do not contain obvious API keys or bearer tokens.

## Versioning and Commits

The repository version is currently `0.1.1`. Adding a new complete skill is a feature-level change, so the implementation push should update it to `0.2.0`.

The design-document commit does not require a version change because it will not be pushed independently. Every future push must include a package version increment, following the repository's existing policy.

Suggested implementation commits are:

```text
Add stormforge image generation core
Add image editing and batch generation
Add image generation tests and documentation
Bump package version to 0.2.0
```

Before any push, run:

```text
npm test
npm run validate
git diff --check
git status --short
```

## Completion Criteria

The new skill is complete only when:

1. Text-to-image works through `/images/generations`.
2. Reference-image and masked editing work through `/images/edits`.
3. Local files, data URLs, raw Base64, and Base64 files are supported.
4. Base64 and URL response forms are supported.
5. `gpt-image-2` custom sizes are validated locally.
6. Actual output dimensions and formats are verified from bytes.
7. Batch execution supports concurrency, retries, status files, and resume.
8. Images and metadata are written atomically.
9. Credentials and image Base64 are excluded from logs and metadata.
10. `stormforge-responses-image-gen` remains functional.
11. English and Chinese README content remains aligned.
12. Documentation under `docs/` remains English-only.
13. Offline tests and repository validation pass.
14. The optional NxtPath live test can verify real relay compatibility.
15. The implementation push increments the package version to `0.2.0`.

## References

- OpenAI Image Generation guide: `https://developers.openai.com/api/docs/guides/image-generation`
- OpenAI GPT Image 2 model reference: `https://developers.openai.com/api/docs/models/gpt-image-2`

