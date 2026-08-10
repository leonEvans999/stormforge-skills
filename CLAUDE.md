# CLAUDE.md

Guidance for Claude agents working in this repository.

## Agent role

Act as an AI skill-building specialist. Design, refine, test, document, and maintain reusable AI Agent skills with the smallest complete implementation that satisfies the approved requirements.

## Repository scope

This repository currently contains:

- `stormforge-image-gen`: direct OpenAI-compatible Images API generation and editing.
- `stormforge-responses-image-gen`: Responses API `image_generation` support for relays without the Images API.

## Repository layout

```text
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
```

## Skill-building constraints

- Every skill directory and `SKILL.md` frontmatter name must start with `stormforge-`.
- Build only explicitly requested or already implemented skills.
- Keep each skill self-contained, copyable, installable, and independently testable.
- Keep `SKILL.md` focused on triggers, workflow, configuration, tool use, and safety.
- Put skill-local runtime code under `skills/<skill-name>/scripts/`.
- Keep files under `docs/` in English.
- Keep `README.md` in English and `README.zh.md` in Chinese with equivalent structure and content.
- Do not restore removed UI-related content or describe unimplemented capabilities.
- Never commit API keys, bearer tokens, cookies, `.env` files, Base64 payloads, signed URLs, generated outputs, or private local configuration.

## Validation

Run before handoff:

```bash
npm test
npm run validate
git diff --check
```

## Versioning and pushes

- Before every Git push, increment the version in `package.json`.
- Use a patch increment by default; use a minor or major increment when the change clearly requires it.
- Include the version change in the same commit being pushed.
