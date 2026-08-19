## Workflow

**For any change request, follow `.claude/rules/workflow.md`** — understand the code first, plan
the minimal change, delegate to sub-agents, then verify.

**All code edits MUST go through sub-agents — no direct `Edit` / `Write` from the main thread, even
for one-line changes** (except its own plan file — `*.md` under `.claude/plans/`). The main Claude
plans and verifies only. Dispatch by layer:
{{DISPATCH_LIST}}

**Model policy:** domain architects run on **Opus** by default and are **Fable-upgradeable** in
non-Fable sessions only — when the task explicitly says to use Fable (e.g. via cc-enhance "use
fable") and the session is NOT on Fable 5, dispatch them with `model: "fable"` (dispatch-time
override beats the frontmatter default); in Fable 5 sessions architects always stay Opus — the
orchestrator's plan review is the Fable pass, never double-pay. Test planners ({{TEST_PLANNER_NAMES}}) are
always **Opus**; all coders execute on **Sonnet**; exploration is always **Haiku** (`Explore` /
`general-purpose` with `model: "haiku"`). **Fable 5 sessions** are strict orchestrators — no direct
`Edit`/`Write`, ever, except its own plan file (`*.md` under `.claude/plans/`). **Opus sessions**
plan in the main thread; the micro-edit exception (one file,
a few lines, location known) applies only to Opus, never Fable. The after-task simplify/review pass
is handled by the global threebrain Stop hook — its routing lives there, not here.

Multi-layer changes dispatch multiple coders **in parallel** (single message, multiple `Agent` tool
calls). See `.claude/rules/workflow.md` → "Session-model discipline" for the full reading rule.
Briefs are self-contained and returns compact — see `.claude/rules/workflow.md` → Token-efficient
handoffs.

**Dynamic workflows:** multi-agent orchestration via the **Workflow** tool is authorized as a
standing default here — treat this as my explicit opt-in; never ask first. Use a workflow for
anything with fan-out shape (multi-file feature, review/audit, migration, research sweep, verify
pass); a single `Agent` dispatch stays right for one-step work. Every `agent()` stage sets
`agentType` or `model` explicitly — exploration → `model: "haiku"`, implementation → the named
coder (Sonnet), planning/judging → the architect (Opus); nothing inherits Fable. Full rules:
`.claude/rules/workflow.md` → "Dynamic workflows".

Plans and large findings travel as files (`.claude/plans/`, `.claude/findings/`), not inline text.
Per task: detect session model → map delegates → brief per contract → dispatch → verify. Full
procedure: `.claude/rules/workflow.md` → How to proceed.
