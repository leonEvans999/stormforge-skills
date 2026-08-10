# Configuration

## Environment variables

```text
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_IMAGE_MODEL
OPENAI_REQUEST_TIMEOUT_MS
STORMFORGE_IMAGE_MAX_JOBS
STORMFORGE_IMAGE_START_INTERVAL_MS
STORMFORGE_IMAGE_RETRIES
```

Defaults:

```text
OPENAI_BASE_URL=https://api.nxtpath.ai/v1
OPENAI_IMAGE_MODEL=gpt-image-2
size=2048x1152
quality=high
format=png
background=auto
moderation=auto
n=1
timeout=300000 ms
jobs=4
retries=2
start interval=250 ms
```

## Optional `.env` files

The script loads simple `KEY=value` files in low-to-high priority order:

```text
%USERPROFILE%\.stormforge-skills\.env
<current-directory>\.stormforge-skills\.env
```

Shell evaluation, interpolation, and command substitution are not supported. Never commit these files.

## Optional preference files

Non-secret defaults can be stored in:

```text
%USERPROFILE%\.stormforge-skills\image-gen.json
<current-directory>\.stormforge-skills\image-gen.json
```

Example:

```json
{
  "model": "gpt-image-2",
  "size": "2048x1152",
  "quality": "high",
  "format": "png",
  "jobs": 4
}
```

Credential-like fields are rejected. Keep API keys in environment variables.

## Priority

Highest priority wins:

```text
CLI
process environment
project .env
user .env
project image-gen.json
user image-gen.json
Codex provider config when explicitly enabled
built-in defaults
```

`--use-codex-config` reads only the selected provider's `base_url` and `experimental_bearer_token`. It does not use the Codex text model as the image model.

## Custom-size limits for `gpt-image-2`

- Width and height must be multiples of 16.
- Longest edge must not exceed 3840 pixels.
- Aspect ratio must not exceed 3:1.
- Total pixels must be between 655,360 and 8,294,400.
- Transparent background is rejected for `gpt-image-2`.

Valid examples include `1024x1024`, `1536x1024`, `2048x1152`, `2048x2048`, `2880x2880`, and `3840x2160`.
