# Global notes

## Media generation (any project)
When the user asks to **create / generate / make / draw** an image, picture, icon, logo,
illustration, or video, use the **media-gen** skill (browser → **Gemini** default, or ChatGPT if
named) — generate **one asset at a time**. Don't substitute stock or searched assets for a
generation request.

For **icons**: deliver them **dark on a transparent background by default** (knock out the bg, no
recolor). Recolor only when asked — **solid** in the named color, **gradient** only if "gradient" is
said; if the user says "recolor" with no color, **ask which**. Use the **recolor-icons** skill. For an
icon system/library, advise tracing to SVG.

## Handoffs across models
See the **threebrain** skill for the orchestration model: Codex for review / adversarial / rescue,
Gemini for large-context or multimodal analysis, media-gen for visual generation. One delegate per
task; pass the user's phrasing through; serialize browser work.

After finishing any task that **changed code**, offer a threebrain pass over the changes —
**Simplify** (`/simplify`) · **Review** (`/codex:review`) · **Both** · **No**. This is enforced by the
`threebrain-after-task` Stop hook; stay silent on read-only / Q&A tasks.
