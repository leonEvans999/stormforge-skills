# stormforge-skills

<p align="center">
  <img src="./stormforge-icon-512.png" alt="StormForge 图标" width="160" />
</p>

Leon Evans 的个人 AI 技能仓库。

[English README](./README.md)

## 概览

`stormforge-skills` 是一个用于存放可复用 AI Agent 技能的仓库。当前仓库提供一个 Responses API 图片生成功能，能够通过兼容 OpenAI 的 `/v1/responses` 接口和 `image_generation` tool 生成位图图像。

## 可用技能

| 技能 | 说明 |
| --- | --- |
| `stormforge-responses-image-gen` | 通过兼容 OpenAI 的 Responses API 中转接口生成图片，并将结果保存到本地。 |

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
    stormforge-responses-image-gen/
      SKILL.md
      agents/openai.yaml
      scripts/generate.mjs
  stormforge-icon-512.png
```

## 使用方式

在仓库根目录运行 `stormforge-responses-image-gen` 脚本：

```powershell
node ".\skills\stormforge-responses-image-gen\scripts\generate.mjs" `
  --prompt "A simple carrot icon on a white background." `
  --image "outputs\carrot.png" `
  --model "gpt-5.6-sol" `
  --use-codex-config
```

该脚本也可以通过环境变量或显式 CLI 参数配置。详情见 [`skills/stormforge-responses-image-gen/SKILL.md`](./skills/stormforge-responses-image-gen/SKILL.md)。

## 校验

```bash
npm run validate
```

## 许可证

MIT
