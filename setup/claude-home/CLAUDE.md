# Global notes

## Working style: one main loop
Work in one main loop by default — every session model, Fable 5 included: read, plan, edit, run the
checks and verify yourself, loading skills and tools on demand. For multi-step work, write
`.claude/plans/<slug>.md` first (with acceptance criteria) and revise it as results come in.

Spawn only for a context reason, never to split by role (architect → coder → verifier):
- **Bulky reads** whose raw output isn't needed (unknown-scope sweeps, big logs, git archaeology)
  → Haiku `Explore`, ≤300-word return. Known files (1–3) you read yourself.
- **Independent parallel work** that benefits from fresh contexts (multi-concern review, research
  across sources, mechanical edits across many files) → a Workflow; every `agent()` sets `model`
  or `agentType` (Haiku for sweeps and verbatim edits, Sonnet for well-specified coding, Opus for
  judgment).
- **Black-box verification**: red tests from the plan by `testing-coder` (Codex when I say
  "use codex") for planned multi-file work, or a Codex review.

Briefs for spawned agents are self-contained (objective, paths, findings, output format); returns
are `Result / Files changed / Deviations / Open questions`, ≤200 words. Project `*-architect` /
`*-coder` agents are on-demand — use them when I ask or for parallel fan-out. Waiting on background
work: end the turn (it notifies you); never spawn a placeholder agent (`noop-agent-guard` denies it).

The Workflow tool only accepts an opt-in delivered as session context, so `session-model-guard`
injects it as `SESSION_WORKFLOW_POLICY` at every session start. Keep that block in sync with this
section.

## Media & design (any project)
The skills trigger on their own descriptions (media-gen, recolor-icons, pixel-art, site-style,
frontend-design, animated-sections, stop-animation, dataviz). Generate one asset at a time and never
substitute stock or searched assets. Icons: dark on transparent unless a color is asked. Real things
changing → video; typographic / geometric / UI → code. Verify UI with claude-in-chrome screenshots
at 1440 and 390 + console.

## Chat log (any project)
The `chat-log` Stop hook logs every code-changing turn (prompt, result, files, repo @ commit) to
`~/.claude/chat-log`, a clone of the private repo `lotoras/claude-chat-log` synced across devices.
For "did I do this before / remember when I… / do it like I did there", use the **chat-log** skill.

## SSH (any project)
SSH is blocked only inside the SecureIT CMS folders (cms-local, secureit-cms-site-manager, cms-mcp — the `ssh-guard` hook routes those to `/sitemanager`); everywhere else connect via Pageant with the **ssh-pageant** skill.

## Capability delegates
See the **threebrain** skill: Codex for review / adversarial / rescue, ChatGPT (in-browser, via
claude-in-chrome) for video/audio/YouTube perception Claude can't do natively (upload the file or
paste the link), media-gen for finished image/icon/video assets. Creative generation and
large-context analysis stay with Claude. One delegate per task; pass the user's phrasing through;
serialize browser work.

**Codex pipeline — opt-in only**, when I explicitly say "use codex" ("with codex", "via codex",
"run it through codex"; or cc-enhance carries it in). Bare mentions of Codex as subject matter are
not triggers. Then: **Codex writes the failing tests** (`codex:codex-rescue`, tests only) → the main
loop makes them pass (never editing the tests) → verify (2 failed fix rounds → `/codex:rescue`) →
done. Codex unavailable → `testing-coder` writes the tests. Codex (default `gpt-6-astra` @ high for
review/rescue, pinned in `~/.codex/config.toml`; tests use `gpt-6.1-sol` @ medium (high for risky
domains) per call) runs on the ChatGPT subscription only (forced) and reads the project's CLAUDE.md
as its project doc — never use the plugin's stale `spark` alias; keep its stop-review gate off.

**"use fable"** (explicit directive only): in a non-Fable session, have one on-demand architect
review the plan file with `model: "fable"`; in a Fable 5 session just work in the loop.

## After-task pass
After finishing any task that **changed code**, the `threebrain-after-task` Stop hook asks whether
to run a threebrain pass — **Simplify** (`/simplify`) · **Review** (`/codex:review`) · **Review +
Simplify** (Review → fix → Simplify last) · **No**. Review auto-switches to
`/codex:adversarial-review` when `src/auth/**`, `**/migrations/**`, or `**/billing/**` were touched.
Let the hook be the single ask: do **not** also offer a threebrain pass in prose, and stay silent on
read-only / Q&A tasks. Simplify runs on Opus; Review is done by Codex, triggered and relayed
verbatim by a Haiku subagent that never reviews the code itself.
