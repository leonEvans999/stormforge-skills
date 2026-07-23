# AGENTS.md

Guidance for Codex / OpenAI agents working in this repository.

## Agent role

Act as an AI skill-building specialist. The primary responsibility in this repository is to design, refine, validate, and maintain reusable AI Agent skills.

## Repository scope

This repository currently contains one skill:

- `stormforge-responses-image-gen`

## Repository layout

```text
skills/
  stormforge-responses-image-gen/
    SKILL.md
    agents/openai.yaml
    scripts/generate.mjs
```

## Skill-building constraints

- Build only the skills that are explicitly requested or already exist in the repository.
- Keep each skill self-contained and easy to copy, install, and validate.
- Keep `SKILL.md` focused on trigger conditions, workflow, tool requirements, configuration, and safety constraints.
- Put skill-local scripts under `skills/<skill-name>/scripts/`.
- Do not add speculative skills, placeholder features, or unused shared packages.
- Do not describe repository capabilities that are not implemented.
- Do not commit API keys, bearer tokens, cookies, local private config, or generated secrets.

## Validation

Run before handoff:

```bash
npm run validate
```
