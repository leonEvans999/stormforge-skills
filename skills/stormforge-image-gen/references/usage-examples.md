# Usage Examples

Run commands from the repository root, or adjust the script path when the skill is installed elsewhere.

## Text-to-image

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "Editorial photograph of a translucent orange chair in a concrete gallery, hard side light, subtle film grain, no text" `
  --output "outputs\chair.png" `
  --size "2048x1152" `
  --quality high
```

## Prompt file

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt-file "prompts\campaign.md" `
  --output "outputs\campaign.png"
```

## Aspect ratio convenience

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "A cinematic mountain road at blue hour" `
  --output "outputs\road.png" `
  --ar "16:9" `
  --resolution 4k
```

## Multiple references

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "Use the first image for product geometry and the second for color and lighting direction" `
  --ref "references\product.png" `
  --ref "references\style.webp" `
  --output "outputs\variation.png"
```

## Raw Base64 or Data URL

`--input-image` accepts raw image Base64 or a complete `data:image/...;base64,...` URL. Prefer `--input-image-base64-file` for large values so credentials and payloads are not placed in shell history.

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "Create a polished variation" `
  --input-image-base64-file "references\input.base64.txt" `
  --output "outputs\variation.png"
```

## Multiple outputs

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "Four distinct logo-mark directions for a developer tool, no lettering" `
  --output "outputs\concept.png" `
  --n 4
```

This writes `concept-01.png` through `concept-04.png` and a task manifest.

## Dry run and JSON output

```powershell
node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt-file "prompts\hero.md" `
  --output "outputs\hero.png" `
  --dry-run `
  --json
```
