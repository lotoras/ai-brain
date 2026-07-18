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
Gemini (in-browser, via claude-in-chrome) for creative generation — graphic concepts and inventive
website components — plus video/audio/YouTube perception Claude can't do natively (upload the file
or paste the link); media-gen for finished image/icon/video assets. Large-context text/code analysis
stays with Claude (Opus, 1M context); the Gemini CLI role is retired. One delegate per task; pass the
user's phrasing through; serialize browser work.

Project agents follow a standard model policy: architects/planners default to **Opus** and are
**Fable-upgradeable** in non-Fable sessions only — upgrade only when the task explicitly says to
use Fable (typically via cc-enhance "use fable") and the session is NOT on Fable 5, by dispatching
with `model: "fable"` (the dispatch-time override beats the frontmatter default); in Fable 5
sessions architects always stay Opus — the orchestrator's plan review is the Fable pass, never
double-pay. Coders run **Sonnet**; exploration is always **Haiku**. **Fable 5 sessions**
run as strict orchestrators (no direct edits, ever; effort medium). **Opus sessions** plan and
reason in the main thread, delegate implementation to Sonnet coders, and apply the micro-edit
exception (one file, few lines, location known — never on Fable). The `session-model-guard`
SessionStart hook injects the per-model policy at the start of each session.

## Token economy
Sub-agent briefs are self-contained: objective (1–2 sentences), exact file paths + line ranges,
all gathered findings pasted in, applicable constraints, required output format and word cap.
Returns are compact and structured: `Result / Files changed (path:lines) / Deviations / Open
questions`; coders ≤200 words, explorers ≤300 words. No duplicate exploration — paste Haiku
findings verbatim into architect/coder briefs. Prefer continuing an existing agent (`SendMessage`)
over respawning. Anti-patterns: whole-file reads when a range suffices, unguarded `Grep` in the
main thread, forwarding raw tool output, two agents covering the same area.

After finishing any task that **changed code**, the `threebrain-after-task` Stop hook will ask
whether to run a threebrain pass — **Simplify** (`/simplify`) · **Review** (`/codex:review`) ·
**Both** · **No**. Let the hook be the single ask: do **not** also offer a threebrain pass in prose
yourself. Stay silent on read-only / Q&A tasks (the hook stays silent there too). Models for the
pass: **Simplify** runs on **Opus** (dispatch a `model: "opus"` subagent if the session isn't on
Opus); **Review** is done by **Codex**, triggered/relayed by a **Sonnet** subagent — Sonnet never
reviews the code itself.

Plans and large findings travel as files (`.claude/plans/<task-slug>.md`,
`.claude/findings/<slug>.md`) — architects/explorers return the file path plus a ≤10-line summary;
coders read the file directly. Per-task procedure: detect session model → map delegates → brief each
per the self-contained-brief contract → dispatch → verify output. The `fable-edit-guard`
PreToolUse hook hard-enforces (fail-open) that Fable 5 sessions never edit from the main thread.
