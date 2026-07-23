# Responses Image Generation Alignment Design

Date: 2026-07-23

## Objective

Align `stormforge-responses-image-gen` with the official Responses image-generation request shape while preserving compatibility with relays that require a tool-level model override. Improve the default output quality and make image-generation prompt rewriting observable.

## Scope

1. Remove the hard-coded image tool model from default requests.
2. Add an optional `--tool-model` override and `OPENAI_IMAGE_TOOL_MODEL` environment fallback for relay-specific behavior.
3. Default image tool size to `2048x1152` and quality to `high`; explicit CLI values override the defaults.
4. Extract `revised_prompt` from Responses results and write non-sensitive generation metadata beside the output image by default.
5. Add `--metadata <path>` and `--no-metadata` controls.
6. Add reusable design-brief prompting guidance without silently rewriting prompts inside the script.
7. Preserve local-path, raw Base64, and data-URL reference-image support.

## Request Shape

Default request:

```json
{
  "model": "<responses-model>",
  "input": "<prompt>",
  "tools": [
    {
      "type": "image_generation",
      "size": "2048x1152",
      "quality": "high"
    }
  ]
}
```

Relay-specific request when `--tool-model` is supplied:

```json
{
  "model": "<responses-model>",
  "input": "<prompt>",
  "tools": [
    {
      "type": "image_generation",
      "model": "<relay-tool-model>",
      "size": "2048x1152",
      "quality": "high"
    }
  ]
}
```

## Metadata

The default metadata path is the image path with `.json` appended, for example `output.png.json`. It contains the requested prompt, revised prompt when returned, model selections, requested size and quality, input-image count, output path, and output byte count. It never contains API keys, bearer tokens, image Base64, or complete API responses.

## Prompting Policy

Keep the CLI deterministic: it sends the supplied prompt without hidden rewriting. In `SKILL.md`, require the calling agent to turn vague visual requests into a concise design brief covering objective, composition, hierarchy, palette, typography, lighting/materials, style, and constraints. Preserve explicit user requirements and avoid inventing brand facts.

## Compatibility

Existing commands remain valid. Requests now omit `tools[0].model` unless explicitly configured. Users of relays that require the previous behavior can pass `--tool-model gpt-5.6-sol` or set `OPENAI_IMAGE_TOOL_MODEL=gpt-5.6-sol`.

## Verification

- Validate invalid quality handling.
- Assert the default request omits tool model and includes `high` plus `2048x1152`.
- Assert explicit tool model, size, and quality overrides.
- Assert metadata captures `revised_prompt` without Base64 data.
- Preserve reference-image request and output-byte tests.
- Run `npm test`, `npm run validate`, and `git diff --check`.
