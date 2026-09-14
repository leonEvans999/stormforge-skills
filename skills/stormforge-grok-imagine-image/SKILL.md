---
name: stormforge-grok-imagine-image
description: Generate raster images through an OpenAI-compatible Images API using the local Grok configuration at ~/.grok/config.toml and the xai/grok-imagine-image model. Use when the user wants Grok Imagine image generation through the API.
---

# StormForge Grok Imagine Image

This standalone skill uses `%USERPROFILE%/.grok/config.toml` for the API connection and sends an OpenAI-compatible Images API request with the default model `xai/grok-imagine-image`.

## Use it when

- The user asks to generate an image with Grok Imagine.
- The local Grok CLI configuration should provide the API URL and key.
- The relay exposes `POST /images/generations`.

## Run

```powershell
node ".\skills\stormforge-grok-imagine-image\scripts\generate.mjs" `
  --prompt "A cinematic red fox in a snowy forest" `
  --output "outputs\grok-fox.png"
```

The script reads `%USERPROFILE%\.grok\config.toml`, uses `xai/grok-imagine-image`, sends `aspect_ratio` and `resolution` controls, writes the image, and writes `<output>.json` metadata by default.

## Options

- `--prompt` or `--prompt-file`
- `--output` / `--image`
- `--model`, `--size`, `--aspect-ratio`, `--resolution`, `--quality`, `--n`
- `--config` for an alternate config path
- `--overwrite`, `--timeout-ms`
- `--metadata`, `--no-metadata`, `--metadata-prompt`
- `--json`, `--debug`

Never print or commit API keys, authorization headers, image Base64, signed URLs, or complete raw API responses.

