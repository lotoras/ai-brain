---
name: setup-agents
description: Use when the user wants to set up Claude Code agents for the current project — "set up agents", "set up agents for this project", "provision the agent lineup", "add architects and coders here", "give this project the newco-style agents", "migrate this project to the single-loop setup", "refresh the agent setup". Provisions a lean single-loop workflow rule and CLAUDE.md section plus a stack-agnostic agent lineup (testing-coder for black-box tests; on-demand architects; coders for parallel fan-out) into .claude/, or migrates an older role-pipeline provisioning to that layout.
---

# setup-agents — provision the lean single-loop setup for the current project

Set up the user's standard Claude Code layout in whatever project this is invoked in.

## The invariant — one main loop, agents only for a context reason

The session model works in one main loop: it reads, plans, edits, runs the checks and verifies
itself. Agents exist only where a split is by **context**, not by role:

| Agent(s) | Used for | Tools | Model |
|---|---|---|---|
| `testing-coder` (+ `browser-testing-coder` if e2e) | **black-box verification** — red tests from the plan for planned multi-file work; test infrastructure | read+write: `Bash, Glob, Grep, Read, Edit, Write` | `opus` frontmatter; dispatched `sonnet` (`haiku` for verbatim edits) |
| `<domain>-coder` | **parallel fan-out** — independent files/layers in a Workflow, many-file mechanical edits | read+write | `opus` frontmatter; dispatched `sonnet` (well-specified) or `haiku` (verbatim) |
| `<domain>-architect`, `testing-architect` (+ `browser-testing-architect`) | **on-demand** design / test-plan pass when the user asks (or "use fable" → `model: "fable"`) | read-only + explore dispatch: `Bash, Read, Glob, Grep, Write, Agent(Explore, general-purpose)` | `opus` |
| `Explore` / `general-purpose` dispatches (not provisioned) | **bulky reads** whose raw output isn't needed | — | `haiku` |

Split per **layer** only when the project genuinely has more than one (e.g. backend + frontend →
two architect/coder pairs). A mono-layer project gets a single pair. Never invent layers.

Codex writes the red tests only when the user says "use codex" (via `codex:codex-rescue`); no Codex
agent is provisioned. Simplify and Review are offered by the global threebrain Stop hook — never
provision them here.

## Flow

### 1. Inventory what exists
List `.claude/agents/`, check for `.claude/rules/workflow.md` and a `## Workflow` section in the
project's `CLAUDE.md`. If the workflow rule contains "Session-model discipline", "Dynamic
workflows (Workflow tool)" or "Token-efficient handoffs", the project carries the **old
role-pipeline provisioning** → go to **Migrate an existing provisioning** below instead of steps
2–5. Otherwise never overwrite an existing file: existing agents are reported and skipped; ask
before replacing one. Run this inventory while the step-2 Explore agent works.

### 2. Detect the project (one Haiku Explore subagent)
Dispatch a single `Explore` subagent with `model: "haiku"` to report:
- **Stack**: languages/frameworks from manifests (`composer.json`, `package.json`,
  `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `Gemfile`, …) and lockfiles.
- **Layers**: is there a real backend/frontend split (separate dirs, two frameworks), or one layer?
- **Test tooling**: unit/feature framework and e2e tooling (Playwright, Cypress, Pest browser
  plugin) — e2e agents only if found.
- **Commands**: how to run tests, lint, build (scripts in manifests, Makefile, CI config).
- **Conventions**: skim `README` and existing `.claude/rules/*.md` for layering rules, naming,
  helpers, and patterns worth enforcing. (The project `CLAUDE.md` is already loaded — use it
  directly.)

### 3. Decide the lineup
- Always `testing-coder` (+ `testing-architect`), adapted to the detected test framework.
- One `<domain>-architect` + `<domain>-coder` pair **per layer**, named by domain (`laravel-`,
  `react-`, `go-`, `cli-` …).
- `browser-testing-architect` + `browser-testing-coder` **only** when e2e tooling exists.
- Extra single coders only for a clear, distinct, recurring parallel workstream.

### 4. Generate the agent files
Fill the templates from `${CLAUDE_PLUGIN_ROOT}/skills/setup-agents/templates/` into
`.claude/agents/<name>.md` (`architect.md` / `coder.md` per layer, `testing-*.md`,
`browser-testing-*.md` only if e2e). Replace every `{{PLACEHOLDER}}` with **real, project-specific
content** from step 2 — never generic filler or unreplaced placeholders. Keep the frontmatter
shape exactly: `name`, `description` (single-line, quoted, trigger-rich), `tools`, `model`, `color`
(distinct colors). The `model` values in the templates are the policy — do not change them.

### 5. Install the workflow rule and CLAUDE.md section
- Write `.claude/rules/workflow.md` from `templates/workflow.md`: `{{LAYER_MAP}}` (one bullet per
  layer: paths → layer name and what it owns), `{{CODER_NAMES}}`, `{{ARCHITECT_NAMES}}`,
  `{{VERIFY_COMMANDS}}` (test + lint/build commands), `{{PROJECT_SPECIFICS}}` (layering rules,
  conventions and gotchas worth enforcing; "None yet." if there are none).
- Append the filled `templates/claude-md-section.md` to the project's `CLAUDE.md` (create it with
  just that section if absent): `{{AGENT_LIST}}` is one bullet per agent group, e.g.
  `- **Backend** (\`app/\`) → \`laravel-coder\` (fan-out) · \`laravel-architect\` (on-demand)`.
- Ensure `.claude/plans/` and `.claude/findings/` are in the project's `.gitignore` (append if
  missing; if there is no `.gitignore`, tell the user to create one).

### 6. Report
List created vs. skipped files and the lineup with models; new agents load on the next session
start (or via `/agents`).

## Migrate an existing provisioning

For projects provisioned with the old role pipeline (architect → coder → verifier, "when in
doubt, workflow", Fable strict orchestrator). Touch only `.claude/**` and `CLAUDE.md`.

1. **Isolate the project-specific content.** Diff the project's `.claude/rules/workflow.md`
   against the old template: `git -C <ai-brain> show 8283a88:plugins/ai-brain/skills/setup-agents/templates/workflow.md`
   (and `…/templates/claude-md-section.md` for the CLAUDE.md section). Everything that isn't the
   old template text with placeholders filled — layer map, commands, project rules, gotchas,
   extra sections — is project-specific. List it before writing anything.
2. **Write the lean rule.** Replace `.claude/rules/workflow.md` with `templates/workflow.md`
   filled for the project: the old layer map → `{{LAYER_MAP}}`, the old verify/test commands →
   `{{VERIFY_COMMANDS}}`, every other project-specific item from step 1 → `## Project specifics`
   (keep its wording; drop only model-routing, escalation, effort, Fable and dispatch policy that
   the new text replaces).
3. **Replace the CLAUDE.md section.** Swap only the `## Workflow` section (up to the next `## `
   heading) for the filled `templates/claude-md-section.md`; leave the rest of `CLAUDE.md`
   untouched. Keep any project-specific sentence from the old section that step 2 didn't capture.
4. **Demote the agents.** In each `.claude/agents/*-architect.md` / `*-coder.md` /
   `testing-*.md`, rewrite the `description` to the new template's wording (architects
   on-demand, coders for parallel fan-out, testing-coder for black-box red tests) keeping the
   project-specific parts (stack, units, conventions), and replace "model-tier reading split" /
   Fable-upgrade / Sonnet-dispatch prose in the body with the new template's text. Domain
   conventions in the bodies stay. Never delete agent files.
5. **Sweep.** `grep -rn` over `.claude/` and `CLAUDE.md` for `cheapest tier`, `when in doubt,
   workflow`, `strict orchestrator`, `fable-edit-guard`, `Fable-upgradeable`, `Session-model
   discipline`, `Sonnet/Haiku-dispatchable`, `use ultracode` → zero hits. No unreplaced `{{…}}`.
6. **Report** the files changed and the list of project-specific items carried over.
