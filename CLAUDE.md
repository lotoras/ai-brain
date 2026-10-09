# ai-brain

ai-brain is the user's personal Claude Code configuration and plugin repository. It is not a web
app — it ships Claude Code plugins (skills), runtime lifecycle hooks (SessionStart / PreToolUse /
Stop), and cross-platform device-provisioning scripts (`setup/setup.sh`, `setup/setup.ps1`) that
bootstrap a new machine with this environment.

**Deployment note:** the files under `setup/claude-home/**` (including `CLAUDE.md`,
`settings.json`, `keybindings.json`, `statusline-command.js`, `commands/`, and `hooks/*.js`) are
SOURCE copies that `setup/setup.sh` / `setup/setup.ps1` deploy into `~/.claude`. Editing the repo
copy alone does not take effect for the live session — after editing, redeploy via the setup
script and keep the repo copy and the deployed `~/.claude` copy in sync (`diff ~/.claude/<f>
setup/claude-home/<f>` to confirm).

## Workflow

**For any change request, follow `.claude/rules/workflow.md`** — understand the code first, plan
the minimal change, delegate to sub-agents, then verify.

**All code edits MUST go through sub-agents — no direct `Edit` / `Write` from the main thread, even
for one-line changes** (except its own plan file — `*.md` under `.claude/plans/`). (Opus sessions: see the direct-edit exception — never on Fable.) The main Claude
plans and verifies only. Dispatch by layer:
- **Skill layer** (`plugins/<plugin>/skills/<name>/SKILL.md`,
  `plugins/ai-brain/skills/setup-agents/templates/*.md`) → `skill-coder` (Sonnet for
  plan-driven, Haiku for purely mechanical; Opus on escalation), planned by `skill-architect` (Opus).
- **Hook layer** (`setup/claude-home/hooks/*.js`, `setup/setup.sh`, `setup/setup.ps1`,
  `merge-settings.js`, `setup/claude-home/{CLAUDE.md,settings.json,keybindings.json,
  statusline-command.js,commands/}`) → `hook-coder` (Sonnet for plan-driven, Haiku for purely mechanical; Opus on
  escalation), planned by `hook-architect` (Opus).
- **Verification / tests** → `testing-coder` (Sonnet for plan-driven, Haiku for purely mechanical; Opus on
  escalation), planned by `testing-architect` (Opus).

**Model policy:** domain architects run on **Opus** by default (effort `high`, `xhigh` for hard or
cross-cutting designs) and are **Fable-upgradeable** in
non-Fable sessions only — when the task explicitly says to use Fable (e.g. via cc-enhance "use
fable") and the session is NOT on Fable 5, dispatch them with `model: "fable"` (dispatch-time
override beats the frontmatter default); in Fable 5 sessions architects always stay Opus — the
orchestrator's plan review is the Fable pass, never double-pay. Test planners (testing-architect) are
always **Opus**; coders keep frontmatter `model: opus` — plan-driven / well-specified coding, test
writing are dispatched on **Sonnet** (`model: "sonnet"`); purely mechanical, exactly-specified edits (verbatim find/replace, ID swaps, template copy/sync) on **Haiku** (`model: "haiku"`), escalating to Sonnet on failed verification; escalate to
**Opus** for cross-cutting/security/auth/billing/migration work, no written plan, a single
dependent chain, or a Sonnet-dispatched coder that returned blocked/failed verification (a stuck
coder returns `Open questions` instead of guessing; the orchestrator asks the architect or
re-dispatches on Opus) (effort `medium` — agent frontmatter can't set effort; the effort values apply to workflow `agent()` stages — plain `Agent` dispatches run at the session effort);
locate exploration is **Haiku** (`Explore` / `general-purpose` with `model: "haiku"`; fallback
`model: "sonnet"` at low effort only if Haiku is unavailable or its sweep comes back thin; Haiku effort: low for plain greps, medium for broad mapping), verify/check passes are **Haiku** (effort low), judgment
reads are **Opus** at low effort. Route each role to the cheapest tier that holds quality: sweep effort before switching model; cheaper workers pay off for well-specified or parallel work, not for a single dependent chain. **Fable 5 sessions** are strict orchestrators — no direct
`Edit`/`Write`, ever, except its own plan file (`*.md` under `.claude/plans/`). **Opus sessions**
plan in the main thread; the direct-edit exception (any single-file change, or a small sequential
change whose context the main thread already holds) applies only to Opus, never Fable. The after-task simplify/review pass
is handled by the global threebrain Stop hook — its routing lives there, not here.

Multi-layer changes dispatch multiple coders **in parallel** (single message, multiple `Agent` tool
calls). See `.claude/rules/workflow.md` → "Session-model discipline" for the full reading rule.
Briefs are self-contained and returns compact — see `.claude/rules/workflow.md` → Token-efficient
handoffs.

**Dynamic workflows:** multi-agent orchestration via the **Workflow** tool is authorized as a
standing default here — treat this as my explicit opt-in; never ask first. Use a workflow for
anything with fan-out shape (multi-file feature, review/audit, migration, research sweep, verify
pass); a single `Agent` dispatch stays right for one-step work. Every `agent()` stage sets
`agentType` or `model` explicitly — locate exploration → `model: "haiku"`, judgment reads →
`model: "opus"` at low effort, verify/check passes → `model: "haiku"` (effort low), plan-driven implementation → the named coder with
`model: "sonnet"`, purely mechanical edits → the named coder with `model: "haiku"`, escalated implementation → the named coder (Opus), planning/judging → the architect (Opus, effort `high`/`xhigh`); nothing inherits Fable. Full rules:
`.claude/rules/workflow.md` → "Dynamic workflows".

Plans and large findings travel as files (`.claude/plans/`, `.claude/findings/`), not inline text.
Per task: detect session model → map delegates → brief per contract → dispatch → verify. Full
procedure: `.claude/rules/workflow.md` → How to proceed.
