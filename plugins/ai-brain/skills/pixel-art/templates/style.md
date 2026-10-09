# Pixel-art style: {{NAME}}

Reusable style definition for the `pixel-art` skill. Pass this file's path (or the style name)
to the skill to generate new assets in exactly this look.

## Identity
- **Name:** {{NAME}}
- **Era / preset:** {{ERA_PRESET}}
- **Mood:** {{MOOD}}

## Canvas
- **Default canvas size:** {{CANVAS_W}}x{{CANVAS_H}} px — a default, not a limit; each asset gets
  a suggested size (items 16–24, chunky mascots 32, characters with real anatomy 48–64, scenes 64+)
- **Export scale:** {{EXPORT_SCALE}}x (nearest-neighbour)
- **Background:** {{BACKGROUND}}

## Palette (max {{MAX_COLORS}} colours — no colour outside this list)
| Char | Hex | Role |
|---|---|---|
| `.` | transparent | background |
{{PALETTE_ROWS}}

Hex list for `pixelize.py`: `{{PALETTE_HEX_LIST}}`

Palette chars for `pixelize.py --chars` (same order as the hex list): `{{PALETTE_CHARS}}`

## Rendering rules
- **Outline:** {{OUTLINE_RULE}}
- **Shading:** {{SHADING}}
- **Light direction:** {{LIGHT_DIRECTION}}
- **Dithering:** {{DITHERING}}
- **Perspective:** {{PERSPECTIVE}}
- **Detail level:** {{DETAIL_LEVEL}}

## Proportions
- **Head-count by canvas:** {{HEAD_COUNTS}}
- **Limbs:** {{LIMB_RULES}}
- **Build:** {{BUILD_RULES}}

## Do
{{DO_LIST}}

## Don't
{{DONT_LIST}}

## Engine
- **Engine:** {{ENGINE}}
- **Fixed GPT prompt prefix** (the subject sentence goes in front of it):
  ```
  {{GPT_PROMPT_PREFIX}}
  ```
- **pixelize settings:** `--size {{CANVAS_W}}x{{CANVAS_H}} --palette "{{PALETTE_HEX_LIST}}" --scale {{EXPORT_SCALE}} --tolerance {{PIXELIZE_TOLERANCE}}`

## References
{{REFERENCE_PATHS}}
