# Usage examples

```powershell
node ".\skills\stormforge-grok-imagine-image\scripts\generate.mjs" `
  --prompt "A minimal blue ceramic cup on a white table" `
  --output "outputs\cup.png" `
  --size 1024x1024 `
  --quality high
```

Use a prompt file:

```powershell
node ".\skills\stormforge-grok-imagine-image\scripts\generate.mjs" `
  --prompt-file ".\prompts\poster.txt" `
  --output "outputs\poster.png"
```
