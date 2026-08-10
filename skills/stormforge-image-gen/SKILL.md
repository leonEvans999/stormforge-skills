---
name: stormforge-image-gen
description: Generate or edit raster images through an OpenAI-compatible Images API, including gpt-image-2 text-to-image, reference images, Base64 inputs, masks, exact custom sizes, multiple outputs, batch concurrency, retries, resume, and non-sensitive metadata. Use this skill when the provider exposes /images/generations and /images/edits rather than the Responses API image_generation tool.
---

# StormForge Image Gen

Use this skill for direct image generation and editing through an OpenAI-compatible Images API. It defaults to NxtPath and `gpt-image-2` while allowing the base URL and image model to be configured.

## When to use

Use this skill when the user wants to:

- Generate a new image from a text prompt.
- Edit one or more local reference images.
- Supply an image as a local path, Data URL, raw Base64, or a file containing Base64.
- Apply a PNG mask to a one-image edit.
- Generate multiple variants or run a JSON batch.
- Use an OpenAI-compatible relay with `/images/generations` and `/images/edits`.

Use `stormforge-responses-image-gen` instead when the relay only exposes `/responses` with the `image_generation` tool.

## Required environment

- Node.js 20 or newer.
- `OPENAI_API_KEY` for the selected relay.
- Optional `OPENAI_BASE_URL`; default: `https://api.nxtpath.ai/v1`.
- Optional `OPENAI_IMAGE_MODEL`; default: `gpt-image-2`.

Never print, store in metadata, or commit API keys, image Base64 payloads, signed URLs, or complete raw API responses.

## Workflow

1. Convert the user's request into a specific visual prompt. State subject, composition, style, lighting, color, typography constraints, and exclusions when relevant.
2. Choose text generation or editing:
   - No reference image: `/images/generations`.
   - Reference image or mask: `/images/edits`.
3. Choose an explicit output path and suitable size. The default is `2048x1152` at high quality.
4. Run the script from the repository or installed skill directory.
5. Inspect the saved image and metadata. Report a size warning if the relay returned different dimensions.
6. Iterate by improving the prompt or supplying references; do not silently resize the returned image.

## Basic commands

Text-to-image:

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "A premium product hero image, precise studio lighting, no text" `
  --output "outputs\hero.png"
```

Reference-image edit:

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "Keep the product shape; replace the package with a matte black minimal design" `
  --input-image "references\product.png" `
  --output "outputs\product-edit.webp" `
  --format webp `
  --compression 85
```

Masked edit:

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "Replace only the transparent mask region with soft white flowers" `
  --input-image "references\scene.png" `
  --mask "references\mask.png" `
  --output "outputs\masked-edit.png"
```

Batch:

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --batchfile "batch.json" `
  --jobs 4 `
  --resume
```

## Important controls

- `--size <WxH|auto>`: exact size. `gpt-image-2` custom sizes are validated locally.
- `--ar <ratio> --resolution <1k|2k|4k>`: calculate a valid custom size.
- `--quality <auto|low|medium|high>`.
- `--format <png|jpeg|webp>` and optional JPEG/WebP `--compression <0-100>`.
- `--n <1-10>` and `--n-strategy <auto|single-request|separate-requests>`.
- `--strict-size`: preserve a mismatched response under a `.size-mismatch` filename and fail the task.
- `--overwrite`: replace existing outputs. Without it, output collisions fail.
- `--resume`: resume verified batch outputs; cannot be combined with `--overwrite`.
- `--dry-run`: resolve configuration and validate inputs without calling the API.
- `--json`: return machine-readable result data on stdout.

Compatibility aliases from the Responses skill remain accepted, including `--image`, `--tool-size`, `--tool-quality`, and `--tool-model`. Conflicting canonical and alias values fail validation.

## References

Read only the reference needed for the task:

- [Usage examples](references/usage-examples.md)
- [Configuration](references/configuration.md)
- [Batch format](references/batch-format.md)
- [Image prompting](references/image-prompting.md)
