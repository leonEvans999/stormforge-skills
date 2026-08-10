# Batch Format

A batch file may contain a top-level task array or this versioned object:

```json
{
  "version": 1,
  "jobs": 4,
  "defaults": {
    "model": "gpt-image-2",
    "size": "2048x1152",
    "quality": "high",
    "format": "png"
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
      "prompt": "Replace the package with a minimal black box.",
      "output": "outputs/product-edit.webp",
      "inputImages": ["references/product.png"],
      "format": "webp",
      "compression": 85
    }
  ]
}
```

Paths resolve relative to the batch file. A task must provide exactly one of `prompt`, `promptFile`, or `promptFiles`. Multiple prompt files are concatenated in order with two blank-line separators.

Accepted aliases:

| Canonical field | Aliases |
| --- | --- |
| `output` | `image` |
| `inputImages` | `ref`, `referenceImages` |
| `ar` | `aspectRatio` |
| `n` | `count` |

Run:

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" --batchfile "batch.json" --jobs 4
```

Use `--resume` after an interrupted or partially failed batch. The script writes `<batch-file>.results.json` atomically after each task and verifies successful output hashes before skipping them.

Existing files are protected by default. Use `--overwrite` only when replacement is intended. `--resume` and `--overwrite` are mutually exclusive.

Retries can cause extra billable generations when a relay finishes work but the network fails before the response reaches the client. The default is two retries after the initial request.
