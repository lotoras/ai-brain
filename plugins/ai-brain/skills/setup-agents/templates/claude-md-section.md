## Workflow

**For any change request, follow `.claude/rules/workflow.md`** — understand the code first, plan
the minimal change, delegate to sub-agents, then verify.

**All code edits MUST go through sub-agents — no direct `Edit` / `Write` from the main thread, even
for one-line changes** (except its own plan file — `*.md` under `.claude/plans/`). (Opus sessions: see the direct-edit exception — never on Fable.) The main Claude
plans and verifies only. Dispatch by layer:
{{DISPATCH_LIST}}

**Model policy:** domain architects run on **Opus** by default and are **Fable-upgradeable** in
non-Fable sessions only — when the task explicitly says to use Fable (e.g. via cc-enhance "use
fable") and the session is NOT on Fable 5, dispatch them with `model: "fable"` (dispatch-time
override beats the frontmatter default); in Fable 5 sessions architects always stay Opus — the
orchestrator's plan review is the Fable pass, never double-pay. Architect effort ladder: `high` by default, `xhigh`
for hard/cross-cutting designs, then Fable via the explicit upgrade. Test planners ({{TEST_PLANNER_NAMES}}) are
always **Opus** and, with the testing coders, own test infrastructure and, via `testing-coder`, write the first failing tests for planned work (only when the user says "use codex" does **Codex write the first failing tests** via `codex:codex-rescue`); coders keep `model: opus` in frontmatter but plan-driven / well-specified coding, test
writing are dispatched with `model: "sonnet"` (**Sonnet**, effort medium), while purely mechanical, exactly-specified edits (verbatim find/replace, ID swaps, template copy/sync) are dispatched with `model: "haiku"` (**Haiku**), escalating to Sonnet on failed verification — agent frontmatter can't set effort; the effort values apply to workflow `agent()` stages — plain `Agent` dispatches run at the session effort); escalate to **Opus** for
cross-cutting, security, auth/billing or migration work, no written plan, a single dependent chain, or
a Sonnet coder that returned blocked / failed verification (a stuck Sonnet coder returns `Open
questions` instead of guessing — ask the architect or re-dispatch on Opus); locate exploration is
**Haiku** (`Explore` / `general-purpose` with `model: "haiku"`; fallback `model: "sonnet"` at low
effort only if Haiku is unavailable or its sweep comes back thin; Haiku effort: low for plain greps, medium for broad mapping), verify/check passes → **Haiku** (effort low), judgment reads are **Opus** at low
effort. Route each role to the cheapest tier that holds quality: sweep effort before switching model; cheaper workers pay off for well-specified or parallel work, not for a single dependent chain. **Fable 5 sessions** are strict orchestrators — no direct
`Edit`/`Write`, ever, except its own plan file (`*.md` under `.claude/plans/`). **Opus sessions**
plan in the main thread; the direct-edit exception (any single-file change, or a small sequential
change whose context the main thread already holds) applies only to Opus, never Fable. Simplify and Review are never automatic
pipeline phases — the global threebrain Stop hook offers them after a code change and its routing lives there, not here.

Multi-layer changes dispatch multiple coders **in parallel** (single message, multiple `Agent` tool
calls). See `.claude/rules/workflow.md` → "Session-model discipline" for the full reading rule.
Briefs are self-contained and returns compact — see `.claude/rules/workflow.md` → Token-efficient
handoffs.

**Dynamic workflows:** multi-agent orchestration via the **Workflow** tool is authorized as a
standing default here — treat this as my explicit opt-in; never ask first. Prompts enhanced via
cc-enhance end with the `use ultracode` keyword (except really small tasks) — that keyword alone arms the Workflow tool
even in sessions without this standing opt-in. Use a workflow for anything with fan-out shape
(multi-file feature, review/audit, migration, research sweep, verify pass); a single `Agent`
dispatch stays right for one-step work. Every `agent()` stage sets `agentType` or `model`
explicitly — locate exploration → `model: "haiku"`, judgment reads → `model: "opus"` at low
effort, verify/check passes → `model: "haiku"` (effort low), plan-driven / well-specified implementation → the named coder with `model: "sonnet"`, purely mechanical edits → the named coder with `model: "haiku"`, escalated
implementation → the named coder (Opus), planning/judging → the architect (Opus, `high`/`xhigh`); nothing inherits Fable. Full rules:
`.claude/rules/workflow.md` → "Dynamic workflows".

Plans and large findings travel as files (`.claude/plans/`, `.claude/findings/`), not inline text.
Per task: detect session model → map delegates → brief per contract → dispatch → verify. Full
procedure: `.claude/rules/workflow.md` → How to proceed. Planned work: `testing-coder` tests → Sonnet
code → verify (Codex writes the tests only when the user says "use codex"); Simplify and Review run only
when the user picks them in the threebrain Stop hook.
