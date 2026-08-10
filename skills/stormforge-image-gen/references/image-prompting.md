# Image Prompting

A strong image prompt behaves like a compact art-direction brief rather than a list of adjectives.

## Recommended structure

1. **Purpose and format**: hero image, editorial illustration, product render, icon, poster, or background.
2. **Primary subject**: describe the exact object, character, environment, or action.
3. **Composition**: framing, camera angle, visual hierarchy, negative space, and crop safety.
4. **Visual language**: photography, 3D, vector, collage, ink, printmaking, or another concrete medium.
5. **Lighting and color**: key-light direction, contrast, palette, material response, and atmosphere.
6. **Typography**: exact text and placement, or explicitly request no text.
7. **Constraints**: elements to preserve from references and elements to exclude.

## Example

```text
Create a 16:9 launch hero image for a developer infrastructure product. A single forged metal ring floats above a dark graphite platform, viewed from a slightly low three-quarter angle. Use precise industrial product photography, hard white rim light, a restrained violet internal glow, deep charcoal shadows, and generous negative space on the left for a headline. Keep the scene minimal and premium. No logos, letters, watermarks, interface screenshots, extra objects, or decorative particles.
```

## Reference-image edits

State what must remain unchanged before describing the desired change:

```text
Preserve the bottle silhouette, cap geometry, camera angle, reflections, and background. Replace only the paper label with a matte black label using a narrow cream border. Do not add text or change the bottle color.
```

For multiple references, assign a role to each image by order. Avoid vague directions such as "make it better"; name the design problem and the intended result.
