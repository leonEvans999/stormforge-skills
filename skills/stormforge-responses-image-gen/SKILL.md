---
name: stormforge-responses-image-gen
description: 'Generate or edit raster images through an OpenAI-compatible Responses API relay using the image_generation tool. Use for text-to-image generation, reference-image editing, Base64 image input, design-led image requests, and relays that expose POST /v1/responses instead of the Images API.'
---

# StormForge Responses Image Gen

Generate or edit images through an OpenAI-compatible `/responses` endpoint, then save the returned image and non-sensitive generation metadata to disk.

## Runtime

Use Node.js 18 or newer. Do not install third-party packages.

## Prompt Workflow

Before invoking the script for a design-led request, convert vague user language into a concise visual design brief. Preserve all explicit requirements. Cover the objective, subject, composition, visual hierarchy, color system, typography, lighting/materials, art direction, and output constraints that materially affect the result.

Read `references/design-prompting.md` for the reusable prompt structure and reference-image identity guidance. Do not silently rewrite prompts inside the script; pass the finalized brief through `--prompt` or `--prompt-file`.

## Generate an Image

Use the official-compatible default request shape. The script omits a tool-level model unless the relay requires one.

```powershell
node ".\skills\stormforge-responses-image-gen\scripts\generate.mjs" `
  --prompt-file "prompts\hero-image.md" `
  --image "outputs\hero-image.png" `
  --model "gpt-5.6-sol" `
  --use-codex-config
```

The default image tool settings are:

```json
{
  "type": "image_generation",
  "size": "2048x1152",
  "quality": "high"
}
```

Override them when needed:

```powershell
node ".\skills\stormforge-responses-image-gen\scripts\generate.mjs" `
  --prompt "A centered product icon with a clean white background." `
  --image "outputs\product-icon.png" `
  --tool-size "1024x1024" `
  --tool-quality "medium" `
  --use-codex-config
```

## Relay-Specific Tool Model

Use `--model` for the outer Responses model. Do not assume it selects the image tool model.

Only add a tool-level model when the relay explicitly requires it:

```powershell
node ".\skills\stormforge-responses-image-gen\scripts\generate.mjs" `
  --prompt-file "prompts\poster.md" `
  --image "outputs\poster.png" `
  --model "gpt-5.6-sol" `
  --tool-model "gpt-5.6-sol" `
  --use-codex-config
```

`OPENAI_IMAGE_TOOL_MODEL` provides the same relay-specific override. The CLI value takes precedence.

## Reference Images

Pass `--input-image` repeatedly to provide one or more references:

```powershell
node ".\skills\stormforge-responses-image-gen\scripts\generate.mjs" `
  --prompt-file "prompts\product-variation.md" `
  --input-image "inputs\product.png" `
  --input-image "inputs\style.png" `
  --image "outputs\product-variation.png" `
  --use-codex-config
```

`--input-image <value>` accepts:

- A local PNG, JPEG, WebP, or GIF path
- Raw Base64 image data
- A complete `data:image/...;base64,...` URL

Convert local images to inline Base64 data URLs before the request. Place them in `input[0].content` as `input_image` items. Never log Base64 data. Do not upload images to `/v1/files`.

Without input images, keep `input` as a prompt string. With input images, send structured content:

```json
{
  "model": "gpt-5.6-sol",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Edit this image..." },
        { "type": "input_image", "image_url": "data:image/png;base64,..." }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation",
      "size": "2048x1152",
      "quality": "high"
    }
  ]
}
```

## Configuration

Use these environment variables when appropriate:

- `OPENAI_BASE_URL`: relay base URL, usually ending in `/v1`
- `OPENAI_API_KEY`: relay API key
- `OPENAI_RESPONSES_IMAGE_MODEL`: default outer Responses model
- `OPENAI_IMAGE_MODEL`: fallback outer model variable
- `OPENAI_IMAGE_TOOL_MODEL`: optional relay-specific tool model
- `RESPONSES_IMAGE_TIMEOUT_MS`: request timeout in milliseconds, default `120000`
- `OPENAI_REQUEST_TIMEOUT_MS`: fallback request timeout variable

Use `--use-codex-config` only when the user wants the script to reuse the active Codex provider. Read the active model, provider base URL, and bearer token from `$HOME/.codex/config.toml` without printing secrets.

CLI options:

- `--prompt <text>` or `--prompt-file <path>`
- `--input-image <path|base64|data-url>`; repeat for multiple images
- `--image <output-path>`
- `--model <model>` for the outer Responses model
- `--tool-model <model>` for an explicit relay-specific tool override
- `--tool-size <size>`; default `2048x1152`
- `--tool-quality <auto|low|medium|high>`; default `high`
- `--metadata <path>` to choose the metadata path
- `--no-metadata` to disable metadata output
- `--base-url <url>`
- `--api-key <key>`
- `--timeout-ms <milliseconds>`

CLI values override environment and Codex configuration values.

## Metadata and Diagnostics

Write metadata beside the image by default using `<image-path>.json`, for example:

```text
outputs/hero-image.png
outputs/hero-image.png.json
```

Include:

- Outer model
- Optional tool model
- Requested prompt
- `revised_prompt` when present in the Responses result
- Requested size and quality
- Input-image count
- Output path and byte count

Never include API keys, bearer tokens, Base64 image data, or the complete API response. Use the metadata to confirm whether the relay revised the prompt and which request settings were used.

## Output Handling

Extract common Responses image shapes:

- `data:image/...;base64,...`
- `b64_json`
- `base64`
- `image_base64`
- `result` fields containing image Base64
- Direct image URLs returned by the relay

Verify that the output file exists and has nonzero size. If extraction fails, report only the response shape and output item types, not credentials or image payloads.
