# stormforge-skills

<p align="center">
  <img src="./stormforge-icon-512.png" alt="StormForge icon" width="160" />
</p>

A personal repository of reusable AI Agent skills by Leon Evans.

[Chinese README](./README.zh.md)

## Overview

`stormforge-skills` currently provides two self-contained image-generation skills. Use the direct Images API skill for providers such as NxtPath that expose `gpt-image-2` through `/images/generations` and `/images/edits`. Keep the Responses API skill for relays that expose image generation only through `/responses`.

## Available Skills

| Skill | API | Intended use |
| --- | --- | --- |
| `stormforge-image-gen` | Images API | Preferred direct `gpt-image-2` generation and editing, with references, Base64 inputs, masks, custom sizes, batches, retries, and resume. |
| `stormforge-responses-image-gen` | Responses API | Image generation and editing for relays that expose only the `/responses` `image_generation` tool. |

## Repository Structure

```text
stormforge-skills/
  .codex-plugin/plugin.json
  .claude-plugin/marketplace.json
  scripts/
    validate-skills.mjs
    test-all.mjs
    install-local.ps1
    sync-local-skills.ps1
  skills/
    stormforge-image-gen/
      SKILL.md
      agents/openai.yaml
      scripts/*.mjs
      references/*.md
    stormforge-responses-image-gen/
      SKILL.md
      agents/openai.yaml
      scripts/generate.mjs
      references/*.md
  tests/stormforge-image-gen/
  stormforge-icon-512.png
```

## Usage

Run the preferred direct Images API skill from the repository root:

```powershell
$env:OPENAI_API_KEY = "your-api-key"

node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "A premium technology product hero image, precise studio light, no text" `
  --output "outputs\hero.png"
```

The default base URL is `https://api.nxtpath.ai/v1`, the default model is `gpt-image-2`, and the default size is `2048x1152`. Override them with `OPENAI_BASE_URL`, `OPENAI_IMAGE_MODEL`, or CLI options.

For a relay that only supports Responses API image generation:

```powershell
node ".\skills\stormforge-responses-image-gen\scripts\generate.mjs" `
  --prompt "A simple carrot icon on a white background" `
  --image "outputs\carrot.png" `
  --model "gpt-5.6-sol" `
  --use-codex-config
```

See each skill's `SKILL.md` for configuration, reference-image, mask, Base64, batch, and metadata details.

## Validation

```bash
npm test
npm run validate
```

Default tests use local mock servers and do not call a paid image API. To run the optional real relay smoke test, set `STORMFORGE_RUN_LIVE_IMAGE_TESTS=1` and `OPENAI_API_KEY`, then run `npm run test:image-live`.

## License

MIT
