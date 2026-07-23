---
name: stormforge-responses-image-gen
description: 'Generate raster images through an OpenAI-compatible Responses API relay using the image_generation tool. Use when the user wants AI image generation via POST /v1/responses with tools image_generation, especially for relay providers that do not support /images/generations.'
---

# StormForge Responses Image Gen

Generate images by calling an OpenAI-compatible `/responses` endpoint with the `image_generation` tool, then save the returned image to disk.

## When to Use

Use this skill when the user asks to generate an image through a relay or custom OpenAI-compatible API that supports this request shape:

```json
{
  "model": "gpt-5.6-sol",
  "input": "Generate an image...",
  "tools": [{ "type": "image_generation", "model": "gpt-5.6-sol" }]
}
```

Do not use this skill for the native Codex `image_gen` tool or for providers that only support `/images/generations`. The image-generation tool model is always set to `gpt-5.6-sol` by default; users do not need to pass an image-model parameter.

## Runtime

Use Node.js 18 or newer. No Bun, npm package install, or third-party dependency is required.

## Script

Run the bundled Node script from this repository:

```powershell
node ".\skills\stormforge-responses-image-gen\scripts\generate.mjs" `
  --prompt "A simple carrot icon on a white background." `
  --image "outputs\carrot.png" `
  --model "gpt-5.6-sol" `
  --tool-size "1536x1024" `
  --tool-quality "high" `
  --use-codex-config
```

After installing the skill into Codex, the same script can also be run from `$env:USERPROFILE\.codex\skills\stormforge-responses-image-gen\scripts\generate.mjs`.

## Configuration

Preferred environment variables:

- `OPENAI_BASE_URL`: relay base URL, usually ending in `/v1`
- `OPENAI_API_KEY`: relay API key
- `OPENAI_RESPONSES_IMAGE_MODEL`: default image-capable Responses model
- `OPENAI_IMAGE_MODEL`: fallback model variable
- `RESPONSES_IMAGE_TIMEOUT_MS`: request timeout in milliseconds, default `120000`
- `OPENAI_REQUEST_TIMEOUT_MS`: fallback request timeout variable

If the user already configured Codex with a custom provider, use `--use-codex-config` only when appropriate. The script reads these fields from `$HOME/.codex/config.toml` without printing secrets:

- active `model`
- active `model_provider`
- provider `base_url`
- provider `experimental_bearer_token`

CLI flags override config/env:

- `--base-url <url>`
- `--api-key <key>`
- `--model <model>`
- `--prompt <text>` or `--prompt-file <path>`
- `--image <output-path>`
- `--tool-size <size>` optionally adds `size` to the image_generation tool
- `--tool-quality <auto|low|medium|high>` optionally adds `quality` to the image_generation tool; omitted values use the provider default
- `--timeout-ms <milliseconds>` overrides the default 120000ms request timeout

The script always sends `model: "gpt-5.6-sol"` inside the `image_generation` tool. It uses IPv4-first DNS resolution and a 120-second default timeout for slow relays.

## Prompting

Put exact dimensions and style in the prompt for maximum relay compatibility, for example:

```text
A cute pixel art carrot, centered composition, 1024x1024 square canvas, crisp 16-bit pixel art style, chunky blocky orange carrot body with green leafy top, subtle pixel shading, charming game item icon, clean white background, no text, no watermark.
```

## Output Handling

The script accepts common Responses image shapes and extracts:

- `data:image/...;base64,...`
- `b64_json`
- `base64`
- `image_base64`
- `result` fields containing image base64
- image URLs returned by the relay

After generation, verify the output file exists and has nonzero size. If extraction fails, inspect the script error message; it includes the response fields seen but not the API key.