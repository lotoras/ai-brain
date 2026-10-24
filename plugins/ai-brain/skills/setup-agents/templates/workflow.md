# Workflow — how to handle change requests

Work in one main loop: read, plan, edit, run the checks and verify yourself, loading skills and
tools on demand. Spawn agents only for a context reason (step 4), never to split by role.

1. **Understand** — read the files involved and find the layer that owns the change:
{{LAYER_MAP}}
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
     sets `agentType` or `model` — {{CODER_NAMES}} with `model: "sonnet"` for well-specified code,
     `model: "haiku"` for verbatim edits; Opus for judgment;
   - **black-box verification** → `testing-coder` red tests or a Codex review.

   The architects ({{ARCHITECT_NAMES}}) are on-demand: use one only when the user asks for a
   separate design pass.
5. **Verify** — run {{VERIFY_COMMANDS}} yourself and read the diff before reporting done.
   Simplify and Review are offered by the global threebrain Stop hook, not here.

## Spawned agents
Briefs are self-contained: objective, exact paths + line ranges, findings already gathered,
constraints, output format + word cap. Returns: `Result / Files changed (path:lines) / Deviations /
Open questions`, ≤200 words (explorers ≤300). Plans and large findings travel as files
(`.claude/plans/`, `.claude/findings/` — gitignored scratch). Prefer continuing an agent
(`SendMessage`) over respawning. Waiting on background work: end the turn; never spawn a
placeholder agent.

## Project specifics
{{PROJECT_SPECIFICS}}
