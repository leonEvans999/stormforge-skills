# stormforge-skills

<p align="center">
  <img src="./stormforge-icon-512.png" alt="StormForge 图标" width="160" />
</p>

Leon Evans 的个人可复用 AI Agent 技能仓库。

[English README](./README.md)

## 概述

`stormforge-skills` 当前提供两个彼此独立的图片生成技能。对于 NxtPath 这类通过 `/images/generations` 和 `/images/edits` 提供 `gpt-image-2` 的服务，优先使用直接 Images API 技能；对于仅通过 `/responses` 提供图片生成能力的中转服务，继续使用 Responses API 技能。

## 可用技能

| 技能 | API | 适用场景 |
| --- | --- | --- |
| `stormforge-image-gen` | Images API | 首选的 `gpt-image-2` 直接生成与编辑技能，支持参考图、Base64 输入、蒙版、自定义尺寸、批处理、重试和断点续跑。 |
| `stormforge-responses-image-gen` | Responses API | 用于仅提供 `/responses` `image_generation` 工具的中转服务，支持图片生成和编辑。 |

## 仓库结构

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

## 使用方式

在仓库根目录运行首选的直接 Images API 技能：

```powershell
$env:OPENAI_API_KEY = "your-api-key"

node ".\skills\stormforge-image-gen\scripts\main.mjs" `
  --prompt "A premium technology product hero image, precise studio light, no text" `
  --output "outputs\hero.png"
```

默认接口地址为 `https://api.nxtpath.ai/v1`，默认模型为 `gpt-image-2`，默认尺寸为 `2048x1152`。可以通过 `OPENAI_BASE_URL`、`OPENAI_IMAGE_MODEL` 或 CLI 参数覆盖这些配置。

如果中转服务只支持 Responses API 图片生成：

```powershell
node ".\skills\stormforge-responses-image-gen\scripts\generate.mjs" `
  --prompt "A simple carrot icon on a white background" `
  --image "outputs\carrot.png" `
  --model "gpt-5.6-sol" `
  --use-codex-config
```

配置、参考图、蒙版、Base64、批处理和元数据说明，请查看各技能目录中的 `SKILL.md`。

## 校验

```bash
npm test
npm run validate
```

默认测试使用本地模拟服务器，不会调用需要付费的图片接口。

## 许可证

MIT
