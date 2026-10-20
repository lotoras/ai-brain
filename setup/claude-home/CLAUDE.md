# Global notes

## Media generation (any project)
When the user asks to **create / generate / make / draw** an image, picture, icon, logo,
illustration, or video, use the **media-gen** skill (**Codex** image generation via `codex_image.py`, ChatGPT subscription; ChatGPT in Chrome as fallback) — generate **one asset at a time**. Default **video**: the **OpenRouter API** via `openrouter.py`; key is `OPENROUTER_API_KEY` in `ai-brain/.env`. Don't substitute stock or searched assets for a
generation request. For pixel art / sprites use the **pixel-art** skill (Opus-direct by default,
Codex on request; reuse the saved style .md for consistency).

For **icons**: deliver them **dark on a transparent background by default** (knock out the bg, no
recolor). Recolor only when asked — **solid** in the named color, **gradient** only if "gradient" is
said; if the user says "recolor" with no color, **ask which**. Use the **recolor-icons** skill. For an
icon system/library, advise tracing to SVG.

## Design work (any project)
Route design tasks to the matching skill (in claude-designs, `site-style` runs in its local mode):

| Task | Skill |
|---|---|
| Base styling, palette, fonts, DESIGN.md | `ai-brain:site-style` |
| New UI / page / section, aesthetic direction | `frontend-design` (`superpowers:brainstorming` first when the brief is vague) |
| Animated banner / hero / section, text effects, scroll-driven UI | `animated-sections` (free component registries via shadcn / Magic UI MCP, ported to the project; Lottie via LottieFiles MCP) |
| Object transformation on scroll / loop / hover (photoreal, physical) | `stop-animation` (video-based) |
| Cinematic background video loop | `media-gen` video (OpenRouter) |
| Images / logos / illustrations · icons · sprites · charts | `media-gen` · `media-gen` → `recolor-icons` · `pixel-art` · `dataviz` |
| Verify | claude-in-chrome screenshots at 1440 and 390 + console |

Rule of thumb: real things changing → video; typographic / geometric / abstract / UI → code. Video routes keep media-gen's cost gate. Creative concepts stay with Claude.

## SSH (any project)
SSH is blocked only inside the SecureIT CMS folders (cms-local, secureit-cms-site-manager, cms-mcp — the `ssh-guard` hook routes those to `/sitemanager`); everywhere else connect via Pageant with the **ssh-pageant** skill.

## Handoffs across models
See the **threebrain** skill for the orchestration model: Codex for review / adversarial / rescue, ChatGPT (in-browser, via claude-in-chrome) for
video/audio/YouTube perception Claude can't do natively (upload the file or paste the link);
creative generation (graphic concepts, inventive website components) stays with Claude; media-gen
for finished image/icon/video assets. Large-context text/code analysis stays with Claude (Opus, 1M
context). One delegate per task; pass the
user's phrasing through; serialize browser work.

Planned work (multi-file feature/bugfix) runs all-Claude by default: Haiku explores → Opus plans
(`.claude/plans/<slug>.md` with acceptance criteria) → `testing-coder` (Sonnet) writes the failing
tests → Sonnet coders make them pass (never editing the tests) → Claude verifies (2 failed fix rounds
→ Opus coder) → done. The pipeline ends at verify: **Simplify and Review are not pipeline phases** —
they run only when the user picks them in the `threebrain-after-task` Stop hook (the explicit review
phrases and the forced sensitive-path adversarial review are unchanged). Micro-edits skip the
plan/test phases.

**Codex pipeline — opt-in only**, when the user explicitly says "use codex" ("with codex", "via
codex", "run it through codex"; or cc-enhance carries it in). Bare mentions of Codex as subject
matter are not triggers. Then: **Codex writes the failing tests** (`codex:codex-rescue`, tests only)
→ Sonnet coders make them pass (never editing the tests) → Claude verifies (2 failed fix rounds →
`/codex:rescue`) → done. No automatic Codex review and no automatic Simplify — the Stop hook's offer
is the only trigger for both. Codex unavailable → `testing-coder` writes the tests.
Codex (default `gpt-6-astra` @ high for review/rescue, pinned in `~/.codex/config.toml`; tests use
`gpt-6.1-sol` @ medium (high for risky domains) per call) runs on the ChatGPT subscription only (forced) and reads the project's
CLAUDE.md as its project doc — never use the plugin's stale `spark` alias; keep its stop-review gate off.

Project agents follow a standard model policy: architects/planners default to **Opus** and are
**Fable-upgradeable** in non-Fable sessions only — upgrade only when the task explicitly says to
use Fable (typically via cc-enhance "use fable") and the session is NOT on Fable 5, by dispatching
with `model: "fable"` (the dispatch-time override beats the frontmatter default); in Fable 5
sessions architects always stay Opus — the orchestrator's plan review is the Fable pass, never
double-pay. Architects run at effort high, xhigh for hard/cross-cutting designs. Coders default
to **Opus** in frontmatter and are **Sonnet/Haiku-dispatchable**: plan-driven/well-specified coding and test
writing dispatch with `model: "sonnet"`; purely mechanical, exactly-specified edits (verbatim
find/replace, ID swaps, template copy/sync) dispatch with `model: "haiku"`, escalating to Sonnet on
failed verification; escalate to **Opus** for
cross-cutting, security/auth/billing/migrations, no written plan, a single dependent chain, or a
Sonnet coder that returned blocked/failed verification. A stuck Sonnet coder returns `Open
questions` instead of guessing — ask the architect (`SendMessage`) or re-dispatch on Opus. Effort
medium by default, low for mechanical edits; agent frontmatter can't set effort — the effort values apply to
workflow `agent()` stages, plain `Agent` dispatches run at the session effort. Locate
sweeps run on **Haiku** (effort low for plain greps, medium for broad mapping; fallback **Sonnet at
low effort** only if Haiku is unavailable or its sweep comes back thin), verify/check passes on
**Haiku** (effort low), judgment reads (summarise, audit, compare) on **Opus at low effort**.
Route each role to the cheapest tier that holds quality: sweep effort before switching model; cheaper workers pay off for well-specified or parallel work, not for a single dependent chain. **Fable 5 sessions**
run as strict orchestrators (no direct edits except its own plan file — `*.md` under
`.claude/plans/`; effort medium). **Opus sessions** plan and
reason in the main thread and may make any single-file change, or a small sequential change whose
context they already hold, directly (never on Fable); they delegate to named coders when work fans
out across files/layers or bulky reads would flood the main context. The `session-model-guard`
SessionStart hook injects the per-model policy at the start of each session.

## Dynamic workflows (standing opt-in)
Multi-agent orchestration via the **Workflow** tool is authorized as a standing default on every
project — treat this as my explicit opt-in; never ask first, never wait for the `ultracode` keyword.
Use a workflow (`agent()` / `pipeline()` / `parallel()`) for anything with fan-out shape: multi-file
features, reviews/audits, migrations, research sweeps, verify passes. A single `Agent` dispatch stays
right for one-step or conversational work. **Every `agent()` stage sets `agentType` or `model`
explicitly** — stages inherit the main-loop model, so an unset stage runs on Fable, which is never
wanted: exploration/locate → `model: "haiku"` (fallback `model: "sonnet"` at low effort only if Haiku is
unavailable or its sweep comes back thin; Haiku effort: low for plain greps, medium for broad
mapping), verify/check passes → `model: "haiku"` with `effort: "low"`,
judgment reads → `model: "opus"` with `effort: "low"`, well-specified/plan-driven coding and test
writing → the named coder with `model: "sonnet"` (`effort: "medium"`), purely mechanical,
exactly-specified edits (verbatim find/replace, ID swaps, template copy/sync) → the named coder with
`model: "haiku"` (`effort: "medium"`, escalating to Sonnet on failed verification), cross-cutting/security/no-plan/escalated implementation → the named coder on its
Opus default, planning/judging → its architect (Opus, `effort: "high"`, `"xhigh"` for hard
designs). Stay within the workflow size guideline (default
medium, < 15 agents). Per-project detail: `.claude/rules/workflow.md` → "Dynamic workflows".

This section alone does **not** arm the tool: the Workflow tool only accepts an opt-in that arrives
as session context or in my own message, so `session-model-guard` injects it as a
`SESSION_WORKFLOW_POLICY` block at every session start — on all four model classes, including the
Sonnet/Haiku sessions that get no other policy. The text above is the human-readable source of
truth; the hook block is what actually authorizes the tool. Keep the two in sync.

## Token economy
Sub-agent briefs are self-contained: objective (1–2 sentences), exact file paths + line ranges,
all gathered findings pasted in, applicable constraints, required output format and word cap.
Returns are compact and structured: `Result / Files changed (path:lines) / Deviations / Open
questions`; coders ≤200 words, explorers ≤300 words. No duplicate exploration — paste Haiku
findings verbatim into architect/coder briefs. Prefer continuing an existing agent (`SendMessage`)
over respawning. Anti-patterns: whole-file reads when a range suffices, unguarded `Grep` in the
main thread, forwarding raw tool output, two agents covering the same area, spawning a
placeholder/no-op agent to wait on background work (end the turn instead; they notify you —
the `noop-agent-guard` PreToolUse hook denies it).

After finishing any task that **changed code**, the `threebrain-after-task` Stop hook will ask
whether to run a threebrain pass — **Simplify** (`/simplify`) · **Review** (`/codex:review`) ·
**Review + Simplify** (Review → fix → Simplify last) · **No**. Review auto-switches to
`/codex:adversarial-review` when `src/auth/**`, `**/migrations/**`, or `**/billing/**` were touched.
The hook also detects edits made by subagents and `codex:codex-rescue` dispatches. The Review handoff runs the plugin's `codex-companion.mjs` script (the slash command is user-only), and the hook stays silent until pending background agents finish. Let the hook be
the single ask: do **not** also offer a threebrain pass in prose yourself. Stay silent on read-only
/ Q&A tasks (the hook stays silent there too). Models for the pass: **Simplify** runs on **Opus**
(dispatch a `model: "opus"` subagent if the session isn't on Opus); **Review** is done by **Codex**,
triggered/relayed by a **Haiku** subagent — Haiku only triggers the Codex review and relays
Codex's output verbatim, never summarising or reviewing the code itself.

Plans and large findings travel as files (`.claude/plans/<task-slug>.md`,
`.claude/findings/<slug>.md`) — architects/explorers return the file path plus a ≤10-line summary;
coders read the file directly. Per-task procedure: detect session model → map delegates → brief each
per the self-contained-brief contract → dispatch → verify output. The `fable-edit-guard`
PreToolUse hook hard-enforces (fail-open) that Fable 5 sessions never edit from the main thread,
apart from plan files under `.claude/plans/`.
