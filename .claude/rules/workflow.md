# Workflow — how to handle change requests

Work in one main loop: read, plan, edit, run the checks and verify yourself, loading skills and
tools on demand. Spawn agents only for a context reason (step 4), never to split by role.

1. **Understand** — read the files involved and find the layer that owns the change:
   - `plugins/<plugin>/skills/<name>/SKILL.md`, colocated helper scripts, plugin manifests and the
     templates under `plugins/ai-brain/skills/setup-agents/templates/` → **skill layer** (skill
     definitions, agent templates, prompt/Markdown content).
   - `setup/claude-home/hooks/*.js` (+ their `*.test.js`) → **hook layer** (Node lifecycle hooks:
     SessionStart, PreToolUse, Stop).
   - `setup/setup.sh`, `setup/setup.ps1`, `setup/merge-settings.js` → **provisioning**.
   - `setup/claude-home/{CLAUDE.md,settings.json,keybindings.json,statusline-command.js,commands/}`
     → **config snapshot** — SOURCE files deployed into `~/.claude` by the setup scripts.
   Put new logic in the layer that owns it from the start; outer layers stay thin and delegate.
   Logic needed at two or more call sites gets one home in the owning unit.
2. **Plan** — for multi-step work, write `.claude/plans/<slug>.md` with acceptance criteria and
   revise it as results come in. Minimal change, existing helpers and patterns, no unrelated
   refactors, no new files or abstractions the task doesn't need. Ambiguity or several valid
   approaches → ask the user.
3. **Tests** — check for existing tests covering the behavior; if none exist, suggest the right
   test type and ask. Planned multi-file work → `testing-coder` writes the red tests from the plan
   first (black-box; Codex writes them only when the user says "use codex"). Small changes → write
   the test yourself.
4. **Build** — in the main loop. Spawn only for:
   - **bulky reads** whose raw output you don't need (unknown-scope sweeps, big logs, git
     archaeology) → Haiku `Explore`, ≤300-word return; known files you read yourself;
   - **independent parallel work** that benefits from fresh contexts (multi-concern review,
     research sweep, many-file mechanical edits, independent layers) → a Workflow; every `agent()`
     sets `agentType` or `model` — `skill-coder`, `hook-coder` with `model: "sonnet"` for
     well-specified code, `model: "haiku"` for verbatim edits; Opus for judgment;
   - **black-box verification** → `testing-coder` red tests or a Codex review.

   The architects (`skill-architect`, `hook-architect`, `testing-architect`) are on-demand: use one
   only when the user asks for a separate design pass.
5. **Verify** — run the checks yourself and read the diff before reporting done:
   `node --check <file>`; `node setup/claude-home/hooks/<hook>.test.js`;
   `echo '<json>' | node setup/claude-home/hooks/<hook>.js`; `bash setup/setup.sh --check`;
   `pwsh setup\setup.ps1 -Check`; `diff ~/.claude/<f> setup/claude-home/<f>`.
   Simplify and Review are offered by the global threebrain Stop hook, not here.

## Spawned agents
Briefs are self-contained: objective, exact paths + line ranges, findings already gathered,
constraints, output format + word cap. Returns: `Result / Files changed (path:lines) / Deviations /
Open questions`, ≤200 words (explorers ≤300). Plans and large findings travel as files
(`.claude/plans/`, `.claude/findings/` — gitignored scratch, prune when older than a week). Prefer
continuing an agent (`SendMessage`) over respawning. Waiting on background work: end the turn;
never spawn a placeholder agent.

## Project specifics
- **Deploy after editing the config snapshot or hooks.** A change under `setup/claude-home/**` is
  not live until redeployed with `setup/setup.ps1` / `setup/setup.sh`; keep the repo copy and the
  deployed `~/.claude` copy in sync and confirm with `diff`.
- **Hooks:** CommonJS, Node built-ins only, fail open (exit 0 on every path), stdout is JSON-only,
  keep the docblock truthful. Each hook has a `*.test.js` fixture file run with `node <file>`.
- **Retiring a hook:** remove its snapshot entry and add its command to `RETIRED_HOOK_COMMANDS` in
  `setup/merge-settings.js` (array union would otherwise keep it wired), plus the setup scripts'
  retired-files list.
- **Skills:** trigger-rich single-line frontmatter `description`, imperative procedural body,
  real verified paths. Bump the plugin version in `plugins/<plugin>/.claude-plugin/plugin.json`
  and `.claude-plugin/marketplace.json` with each shipped change.
- The setup-agents templates stay project-agnostic; `setup-agents/SKILL.md` → "Migrate an existing
  provisioning" is the procedure for moving older projects to this layout.
