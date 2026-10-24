## Workflow

**For any change request, follow `.claude/rules/workflow.md`.** Work in one main loop — read, plan
(`.claude/plans/<slug>.md` for multi-step work), edit, run the checks and verify yourself. Spawn
only for a context reason: bulky reads (Haiku `Explore`), independent parallel work (a Workflow;
every `agent()` sets `agentType` or `model`), or black-box verification (`testing-coder` red tests
from the plan for planned multi-file work; Codex only when the user says "use codex").

Agents in `.claude/agents/`:
{{AGENT_LIST}}

The architects are on-demand (a separate design pass when asked); the coders are for parallel
fan-out, not sequential work. Verify with {{VERIFY_COMMANDS}}.
