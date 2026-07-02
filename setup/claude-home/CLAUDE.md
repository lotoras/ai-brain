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

Project agents follow a standard model policy: architects/planners default to **Opus** and are
**Fable-upgradeable** — upgrade only when the task says to use Fable (typically via cc-enhance
"use fable"), by dispatching with `model: "fable"` (the dispatch-time override beats the
frontmatter default). Coders run **Sonnet**; exploration is always **Haiku**.

After finishing any task that **changed code**, the `threebrain-after-task` Stop hook will ask
whether to run a threebrain pass — **Simplify** (`/simplify`) · **Review** (`/codex:review`) ·
**Both** · **No**. Let the hook be the single ask: do **not** also offer a threebrain pass in prose
yourself. Stay silent on read-only / Q&A tasks (the hook stays silent there too). Models for the
pass: **Simplify** runs on **Fable 5** (dispatch a `model: "fable"` subagent if the session isn't on
Fable 5); **Review** is done by **Codex**, triggered/relayed by a **Sonnet** subagent — Sonnet never
reviews the code itself.
