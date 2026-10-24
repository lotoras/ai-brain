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

**For any change request, follow `.claude/rules/workflow.md`.** Work in one main loop — read, plan
(`.claude/plans/<slug>.md` for multi-step work), edit, run the checks and verify yourself. Spawn
only for a context reason: bulky reads (Haiku `Explore`), independent parallel work (a Workflow;
every `agent()` sets `agentType` or `model`), or black-box verification (`testing-coder` red tests
from the plan for planned multi-file work; Codex only when the user says "use codex").

Agents in `.claude/agents/`:
- **Skill layer** (`plugins/<plugin>/skills/**`, setup-agents templates) → `skill-coder` (fan-out) · `skill-architect` (on-demand)
- **Hook layer + provisioning + config snapshot** (`setup/**`) → `hook-coder` (fan-out) · `hook-architect` (on-demand)
- **Verification** → `testing-coder` (black-box red checks) · `testing-architect` (on-demand)

The architects are on-demand (a separate design pass when asked); the coders are for parallel
fan-out, not sequential work. Verify with `node --check`, the hooks' `*.test.js` files,
`pwsh setup\setup.ps1 -Check` and `diff ~/.claude/<f> setup/claude-home/<f>`.
