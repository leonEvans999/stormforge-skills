# StormForge Grok Imagine Image Skill Design

- Date: 2026-09-14
- Status: Approved direction, awaiting written-spec review

## Goal

Add a standalone `stormforge-grok-imagine-image` skill to generate raster images through an OpenAI-compatible Images API using the local Grok configuration at `%USERPROFILE%\\.grok\\config.toml` and the `xai/grok-imagine-image` model.

The new skill must not change the existing `stormforge-image-gen` or `stormforge-responses-image-gen` behavior.

## Scope

### In scope

- A self-contained skill directory under `skills/stormforge-grok-imagine-image/`.
- A Node.js CLI entry point at `scripts/generate.mjs`.
- Read the selected/default Grok model configuration from `%USERPROFILE%\\.grok\\config.toml`.
- Extract `base_url` and `api_key` without logging secrets.
- Send an OpenAI-compatible `POST /images/generations` request.
- Use `xai/grok-imagine-image` as the default/requested model.
- Generate one or more images and save returned image bytes to user-selected paths.
- Parse common image response forms such as `b64_json`, Base64/data URLs, and direct image URLs when supported by the relay.
- Support prompt text or prompt file, output path, size, quality, count, timeout, overwrite, metadata, JSON output, and sanitized debug output.
- Write non-sensitive metadata beside generated images by default.
- Add skill documentation, references, an agent descriptor, and local mock-based tests.
- Update repository validation/test wiring and equivalent English/Chinese README sections where needed.

### Out of scope

- Editing or replacing the existing two image-generation skills.
- Responses API support for this new skill.
- Interactive UI, browser integration, or image post-processing.
- Automatic API-key discovery outside `.grok/config.toml` unless required by the existing config shape.
- Committing generated images, credentials, Base64 payloads, signed URLs, or local configuration.

## Configuration

The CLI will read `%USERPROFILE%\\.grok\\config.toml` by default. The implementation will support the currently observed model-table shape:

```toml
[models]
default = "..."

[model."grok-4.5"]
model = "..."
base_url = "..."
api_key = "..."
```

Resolution rules:

1. CLI options.
2. Explicit environment overrides, if implemented consistently with the existing skill (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`).
3. The selected/default model entry from `.grok/config.toml`.
4. Skill defaults.

The API key must never appear in stdout, stderr, metadata, test fixtures, or error messages.

## CLI contract

Example:

```powershell
node ".\\skills\\stormforge-grok-imagine-image\\scripts\\generate.mjs" `
  --prompt "A cinematic red fox in a snowy forest" `
  --output "outputs\\grok-fox.png"
```

Planned options:

- `--prompt <text>` or `--prompt-file <path>`
- `--output <path>`
- `--model <id>`; defaults to `xai/grok-imagine-image`
- `--size <WxH>`
- `--quality <value>`
- `--n <1-10>`
- `--overwrite`
- `--timeout-ms <milliseconds>`
- `--metadata <path>` / `--no-metadata`
- `--json`
- `--debug`
- `--config <path>` as an optional explicit config-path override for testing and advanced use

The exact accepted quality and size values will follow the relay/API behavior and be validated locally before request dispatch.

## Request and response behavior

The request will use the OpenAI-compatible Images API shape:

```json
{
  "model": "xai/grok-imagine-image",
  "prompt": "...",
  "size": "...",
  "quality": "...",
  "n": 1
}
```

Only fields explicitly supported by the CLI and API contract will be sent. The implementation will accept JSON responses containing image data in common compatible forms, decode the image, verify nonzero output bytes, and infer the output format from the response bytes or requested path.

HTTP failures will produce concise, sanitized errors. Retries will be limited and deterministic enough for tests; retry behavior will not print credentials or raw payloads.

## Metadata

Default metadata path:

```text
<output-path>.json
```

Metadata may include:

- schema version
- skill name
- model
- requested prompt or prompt hash, according to the selected privacy mode
- requested size and quality
- output path
- output byte count
- detected dimensions and MIME type
- request duration
- non-sensitive warnings

It must not include API keys, authorization headers, Base64 image data, signed URLs, or complete raw responses.

## Files

Planned additions:

```text
skills/stormforge-grok-imagine-image/
  SKILL.md
  agents/openai.yaml
  references/configuration.md
  references/usage-examples.md
  scripts/generate.mjs

tests/stormforge-grok-imagine-image/
  generate.test.mjs
```

Planned updates:

- `README.md`
- `README.zh.md`
- `scripts/validate-skills.mjs` only if its current discovery rules require an explicit change.
- `package.json` test script to include the new local tests.

## Verification

Before handoff:

```powershell
npm test
npm run validate
git diff --check
```

The new tests will use a local mock HTTP server and will verify configuration parsing, request body/model, response decoding, output writing, overwrite behavior, and secret redaction. A real API smoke test will not be run by default.
