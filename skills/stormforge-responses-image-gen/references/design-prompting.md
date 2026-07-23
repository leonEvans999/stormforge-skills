# Design Prompting Guide

Use this guide before invoking `scripts/generate.mjs` when a user asks for a polished visual, poster, cover, hero image, product graphic, illustration, or other design-led output.

## Build a Concise Design Brief

Preserve explicit user requirements, then cover only the categories that materially affect the result:

1. **Objective** — State what the image must communicate and where it will be used.
2. **Subject** — Identify the main subject, supporting elements, environment, and required text.
3. **Composition** — Specify focal placement, framing, negative space, depth, balance, and camera angle.
4. **Visual hierarchy** — Define what viewers should notice first, second, and third.
5. **Color system** — Give a controlled palette, contrast strategy, and mood.
6. **Typography** — State exact text, placement, typographic character, and readability requirements when text is needed.
7. **Lighting and materials** — Describe light direction, softness, contrast, surface qualities, and rendering medium.
8. **Art direction** — Name concrete visual traits instead of vague adjectives such as "beautiful" or "premium".
9. **Constraints** — Include canvas size, aspect ratio, preservation requirements, exclusions, and prohibited artifacts.

## Recommended Prompt Shape

```text
Objective:
Create a [asset type] for [use case and audience].

Subject:
[Main subject, environment, supporting elements, exact visible text.]

Composition and hierarchy:
[Primary focal point, secondary information, negative space, framing, depth, balance.]

Color and typography:
[Palette, contrast, text treatment, readability, placement.]

Lighting, materials, and art direction:
[Lighting, texture, medium, stylistic traits, level of realism.]

Output constraints:
[Size/aspect ratio, elements to preserve, no watermark, no unintended text, no clutter, other exclusions.]
```

## Reference Images

When references define the identity of a person, object, product, or character, say explicitly that the references describe the same identity. State what may change and what must remain unchanged. Do not replace reference evidence with a long generic description that could encourage the model to invent a similar but different subject.

Example:

```text
Use the subject in the supplied reference images as the same identity. Preserve the face, proportions, hair, signature accessories, product geometry, and recognizable markings. Change only the scene, pose, lighting, clothing when requested, rendering style, and composition.
```

## Guardrails

- Do not invent brand guidelines, logos, claims, legal text, or product specifications.
- Quote exact required text and keep it short when possible.
- Do not silently remove user constraints to make the prompt more aesthetic.
- Avoid long lists of unrelated style names.
- Prefer specific visual decisions over generic quality adjectives.
- Keep the final prompt concise enough that the central concept remains clear.
