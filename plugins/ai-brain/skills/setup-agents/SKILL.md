---
name: setup-agents
description: Use when the user wants to set up Claude Code agents for the current project — "set up agents", "set up agents for this project", "provision the agent lineup", "add architects and coders here", "give this project the newco-style agents". Provisions a stack-agnostic architect/coder/testing lineup into .claude/agents/ plus a workflow rule and CLAUDE.md section, applying the user's standard model policy.
---

# setup-agents — provision the agent lineup for the current project

Set up the user's standard Claude Code agent lineup in whatever project this is invoked in.

## The invariant — split by function, not by language

The lineup is the same regardless of programming language or framework. What an agent **does** is
fixed; the stack only flavors names, descriptions, conventions, and commands:

| Function | Agent(s) | Tools | Model |
|---|---|---|---|
| **Think** (plan/design) | `<domain>-architect` | read-only + explore dispatch: `Bash, Read, Glob, Grep, Agent(Explore, general-purpose)` | `fable` |
| **Build** (implement) | `<domain>-coder` | read+write: `Bash, Glob, Grep, Read, Edit, Write` | `sonnet` |
| **Test — plan** | `testing-architect` (+ `browser-testing-architect` if e2e) | read-only | `opus` (for now) |
| **Test — write** | `testing-coder` (+ `browser-testing-coder` if e2e) | read+write | `sonnet` |
| **Explore** (research/info) | `Explore` / `general-purpose` dispatches | — | `haiku`, always |

Split per **layer** only when the project genuinely has more than one (e.g. backend + frontend →
two architect/coder pairs). A mono-layer project (CLI tool, API-only service, library, script
collection) gets a single pair. Never invent layers the project doesn't have.

After-task simplify/review passes are global (threebrain Stop hook) — do not re-provision them
here; the CLAUDE.md section template already references them without restating their routing.

## Flow

### 1. Inventory what exists (never clobber)
List `.claude/agents/`, check for `.claude/rules/workflow.md` and a Workflow section in the
project's `CLAUDE.md`. **Never overwrite an existing file.** Existing agents are reported and
skipped; if the user explicitly wants one replaced, ask first. This inventory and the detection
pass in step 2 are independent — dispatch the Explore agent in the same message and inventory
while it runs.

### 2. Detect the project (one Haiku Explore subagent)
Dispatch a single `Explore` subagent with `model: "haiku"` to report:
- **Stack**: languages/frameworks from manifests (`composer.json`, `package.json`,
  `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `Gemfile`, …) and lockfiles.
- **Layers**: is there a real backend/frontend split (separate dirs, two frameworks), or one layer?
- **Test tooling**: unit/feature framework (Pest, PHPUnit, Vitest, Jest, pytest, go test, cargo
  test…) and e2e tooling (Playwright, Cypress, Pest browser plugin) — e2e agents only if found.
- **Commands**: how to run tests, lint, build (scripts in manifests, Makefile, CI config).
- **Conventions**: skim `README` and existing `.claude/rules/*.md` for layering rules, naming,
  helpers, and patterns worth enforcing. (The project `CLAUDE.md` is already loaded in the invoking
  session — use it directly instead of having the agent re-read it.)

### 3. Decide the lineup
- One `<domain>-architect` + `<domain>-coder` pair **per layer**. Name by domain, not generically:
  `laravel-`, `react-`, `django-`, `go-`, `cli-` — whatever the detected stack calls itself.
- Always `testing-architect` + `testing-coder`, adapted to the detected test framework.
- `browser-testing-architect` + `browser-testing-coder` **only** when e2e tooling exists.
- Extra single coders (styling, translations, docs) only when the project shows clear evidence of
  that being a distinct, recurring workstream.

### 4. Generate the agent files
Fill the templates from `${CLAUDE_PLUGIN_ROOT}/templates/` into `.claude/agents/<name>.md`:
- `architect.md` / `coder.md` — one filled copy per layer
- `testing-architect.md` / `testing-coder.md`
- `browser-testing-architect.md` / `browser-testing-coder.md` (only if e2e)

Templates are skeletons: replace every `{{PLACEHOLDER}}` with **real, project-specific content**
discovered in step 2 (actual helper names, actual commands, actual layering) — never leave generic
filler or unreplaced placeholders. Keep the frontmatter shape exactly: `name`, `description`
(single-line, quoted, trigger-rich), `tools`, `model`, `color` (pick distinct colors). The `model`
values in the templates are the policy — do not change them.

### 5. Install the workflow rule and CLAUDE.md section
- Write `.claude/rules/workflow.md` from `templates/workflow.md` (create `.claude/rules/` if
  needed), filling in the project's agent names and verify commands. If the project already has a
  workflow rule, propose a merge instead of replacing it.
- Append the filled `templates/claude-md-section.md` to the project's `CLAUDE.md` (create the file
  with just that section if absent).

### 6. Report
List created vs. skipped files, the chosen lineup with models, and remind the user that new agents
are picked up on the next session start (or via `/agents`).
