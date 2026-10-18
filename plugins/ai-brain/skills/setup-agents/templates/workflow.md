# Workflow — How to Handle Change Requests

This is the orchestration rule. When referenced, follow this process end-to-end.

## How to proceed — per task, in order
1. **Detect the session model** (statusline / session-model-guard injection): Fable 5 → strict
   orchestrator (never edit directly); Opus → planner in the main thread (direct-edit exception);
   anything else → follow this workflow as written.
2. **Map the task to delegates**: plan/design → `<domain>-architect` (Opus); code changes →
   `<domain>-coder` (Sonnet via `model: "sonnet"` for plan-driven work; Haiku via
   `model: "haiku"` for purely mechanical, exactly-specified edits; Opus on escalation);
   planned-work tests → `testing-coder`
   (Sonnet; Codex via `codex:codex-rescue` only when the user says "use codex"), test infrastructure →
   `testing-architect` / `testing-coder`; locate sweeps →
   Explore subagent (`model: "haiku"`, effort low for plain greps, medium for broad mapping;
   fallback `model: "sonnet"` at low effort only if Haiku is unavailable or its sweep comes back
   thin); verify/check passes → Haiku (effort low); judgment reads (summarise, audit, compare) → Opus at low
   effort (`model: "opus"`).
3. **Write the brief** per the Brief contract (objective, exact paths, gathered findings,
   constraints, output format + word cap); reference plan files in `.claude/plans/` instead of
   pasting plan text.
4. **Dispatch** (in parallel when layers are independent), then **verify**: review the compact
   return, run {{TEST_COMMAND}}, confirm the diff is minimal before reporting done. If the task
   fans out across many files/layers/concerns, script it as a **workflow** instead of hand-chaining
   dispatches — see "Dynamic workflows (Workflow tool)". Planned work follows Phases 3–7
   (`testing-coder` tests → Sonnet code → verify → Opus simplify last; with "use codex": Codex tests →
   Sonnet code → verify → Codex review → Opus simplify last).

## Phase 1: Understand

1. **Read the files involved.** Understand what exists before proposing anything.
2. **Identify the layer.** Where does this change belong?
{{LAYER_MAP}}
3. **Identify the minimal change.** The least work that solves the problem, reusing existing
   helpers, services, components, and patterns. No refactors of surrounding code, no abstractions
   for one-off changes.

**Place it where it belongs (first time).** Put each new function in the layer that owns its concept from the start — don't inline logic that belongs to a deeper layer into a thin outer layer (controller, route, UI component, event handler) and refactor it into the owning layer later. Ask which layer owns the responsibility and put it there; outer layers stay thin and delegate. If the same logic would live at two or more call sites, give it a single home in the owning unit and have callers call it — never duplicate it. A scatter-then-extract "double take" means the placement decision was skipped.

## Phase 2: Plan

4. **State the problem and solution in plain language** before writing code — what's wrong, what
   changes, which files. For planned work (multi-file feature/bugfix) write it to
   `.claude/plans/<slug>.md` **with acceptance criteria** — the tests in Phase 3 are derived from it.
5. **Check for existing tests** covering the affected behavior. If none exist, suggest the right
   test type to the user and wait for their answer before proceeding.

## Phase 3: Tests — planned work only

Micro-edits skip Phases 2–3. For planned work, the `testing-coder` (Sonnet) writes the **failing
tests first** from the plan file — failing tests only, no non-test source edits, return the test
files + test command + red output. Confirm the tests fail for the right reason before moving on.
Test infrastructure (fixtures, factories, helpers) stays with {{TEST_PLANNER_NAMES}} / the testing
coders.

**Codex pipeline (opt-in)** — only when the user explicitly says "use codex" ("with codex", "via
codex", "run it through codex"; bare mentions of Codex as subject matter are NOT triggers), **Codex
writes the failing tests first** (spec-first, decorrelated from the implementer): dispatch the
`codex:codex-rescue` agent with the same brief. If Codex is unavailable or out of quota, fall back to
the `testing-coder`.

## Phase 4: Implement with Sub-Agents

**Every code edit MUST go through a named sub-agent — no direct `Edit` / `Write` from the main
thread, even for one-line changes.** (Opus sessions: see the direct-edit exception — never on Fable.) *(Direct-edit exception: any single-file change, or a small
sequential change whose context the main thread already holds, may be done directly — never on
Fable.)* Writing/editing its own plan file
(`*.md` under `.claude/plans/`) is exempt from this rule on every model, Fable included. The main
thread plans and verifies only. Dispatch by layer:

{{DISPATCH_LIST}}

If a change spans multiple layers, dispatch the corresponding coders **in parallel** (single
message, multiple `Agent` tool calls), each with only the context relevant to its layer.

When Phase 3 produced tests, the coder's goal is to make them pass (green). A coder never edits
those tests — if one looks wrong, it flags it in its return and the orchestrator decides.

### What the main thread may do directly
- Read files (`Read`, `Grep`, `Glob`) within the reading discipline below
- Run read-only shell commands (git status/log/diff, tests, linters)
- Write plan files in plan mode and memory files
- Dispatch sub-agents

## Phase 5: Verify

- **Review what the sub-agents produced** — minimal, matches the plan, follows existing patterns,
  nothing unrelated touched.
- **Run the tests** for the affected area: {{TEST_COMMAND}}
- After **2 failed fix rounds**, stop retrying: escalate to an Opus coder, or hand off to
  `/codex:rescue` when the Codex pipeline is on.

## Phase 6: Review (Codex) — only on "use codex"

Not a default phase: review otherwise stays with the Stop-hook offer and the explicit review /
sensitive-path triggers. When the user opted into the Codex pipeline ("use codex"), run
`node "<plugin>/scripts/codex-companion.mjs" review --scope working-tree` through a Haiku relay
(`adversarial-review` instead if `src/auth/**`, `**/migrations/**`, or `**/billing/**` were
touched). Give findings to a Sonnet coder to fix under
`superpowers:receiving-code-review` discipline (verify each finding, don't blindly apply), then
re-run the tests. **Fallback** — Codex unavailable or out of quota: `superpowers:requesting-code-review`.
The Codex plugin's stop-review gate stays disabled (it duplicates this phase; 900s timeout).

## Phase 7: Simplify (Claude Opus, last)

Run `/simplify` last — it needs whole-repo context — then re-run the tests. The global threebrain
Stop hook offers this and Review (Simplify · Review · Review + Simplify · No); micro-edits skip
straight to that ask.

## Session-model discipline

The main Claude thread is for synthesis, trade-offs, planning, and user interaction. Model tier
determines what the main thread may do directly.

### Fable 5 session (default — strict orchestrator)

Fable 5 is a pure orchestrator. It **never** calls `Edit` or `Write` directly — not even
one-liners, except its own plan file (`*.md` under `.claude/plans/`). Every code change goes
through a named coder (plan-driven/well-specified coding and test writing → Sonnet; purely
mechanical, exactly-specified edits (verbatim find/replace, ID swaps, template copy/sync) → Haiku,
escalating to Sonnet on failed verification; Opus for escalation). Planning goes through an Opus
architect. Broad locate exploration goes to a Haiku sub-agent (fallback `model: "sonnet"` at low
effort only if Haiku is unavailable or its sweep comes back thin; Haiku effort: low for plain greps,
medium for broad mapping); verify/check passes go to Haiku (effort low); judgment reads go to Opus
at low effort.

**Suggested flow per task:**
1. Fable 5: receive task, think about scope.
2. Haiku (`Explore`, `model: "haiku"`): broad mapping, returns a summary.
3. Fable 5: read 1–3 key files to verify what the plan hinges on.
4. Fable 5: write the plan, resolve trade-offs, interact with the user.
5. Named coder (Sonnet via `model: "sonnet"`; Opus for escalation): execute the plan.
6. Fable 5: verify the diff, run tests, report back.

#### Delegate to Haiku (`model: "haiku"`; fallback `model: "sonnet"` at low effort only if Haiku is unavailable or its sweep comes back thin; effort: low for plain greps, medium for broad mapping)
- Broad / unknown scope — "find every place that does X", "map this area"
- Large-file scans where only a pattern or a few snippets are needed
- Git archaeology across multiple files
- Cross-cutting greps that would flood the main context
- Verify/check passes (`node --check`, diffs, dry-run checks, pass/fail) — effort low

Judgment reads (summarise behaviour, audit, compare, explain) go to Opus at low effort
(`model: "opus"`), not Haiku.

#### Read directly from the main thread (Fable 5 only)
- Verifying a sub-agent's summary on any load-bearing claim
- Targeted reads of a known small file (1–3 files) where you know exactly what you need
- The plan file itself while iterating in plan mode

Reading sprees and mass greps in the main thread are a smell — more than a couple of exploratory
reads in a row means stop and dispatch an agent.

### Opus session

Opus keeps planning and architecture in the main thread. Delegate implementation to named coders
(Sonnet for plan-driven work, Haiku for purely mechanical edits, Opus for escalation) when work fans out, broad locate exploration and verify/check passes to Haiku sub-agents, and judgment reads to Opus
at low effort.

**Direct-edit exception:** any single-file change, or a small sequential change whose context the
main thread already holds, may be done directly from the Opus main thread. Delegate to a named coder
when the work fans out across files/layers or bulky reads would flood the main context. Never apply
this exception on Fable 5. Writing or editing its
own plan file (`*.md` under `.claude/plans/`) is always allowed directly, Fable 5 included.

The domain architects (Opus by default) are Fable-upgradeable in non-Fable sessions only — when
the task explicitly says to use Fable, dispatch them with `model: "fable"` (dispatch-time override
beats the frontmatter default); in Fable 5 sessions architects always stay Opus — the
orchestrator's plan review is the Fable pass, never double-pay. Test planning
({{TEST_PLANNER_NAMES}}) is always Opus. Architect effort ladder: `high` by default, `xhigh` for
hard/cross-cutting designs, then Fable via the explicit upgrade above. The named coders
({{CODER_NAMES}}) keep `model: opus` in frontmatter but plan-driven / well-specified coding, test
writing are dispatched with `model: "sonnet"`; purely mechanical, exactly-specified edits (verbatim
find/replace, ID swaps, template copy/sync) are dispatched with `model: "haiku"`, escalating to
Sonnet on failed verification — effort `medium` by default. Escalate to Opus (frontmatter default) for cross-cutting, security,
auth/billing or migration work, no written plan, a single dependent chain, or a Sonnet coder that
returned blocked / failed verification. A stuck Sonnet coder returns `Open questions` instead of
guessing; the orchestrator asks the architect (`SendMessage`) or re-dispatches on Opus. Agent frontmatter can't set effort; the effort values apply to workflow `agent()` stages — plain `Agent` dispatches run at the session effort. Route each role to the cheapest tier that holds quality: sweep effort before switching model; cheaper workers pay off for well-specified or parallel work, not for a single dependent chain.

## Token-efficient handoffs

### Brief contract (every Agent dispatch)
Every brief to a sub-agent must include:
1. **Objective** in 1–2 sentences.
2. **Exact file paths + line ranges** when known.
3. **All findings already gathered**, pasted in — the agent starts fresh and must not re-explore
   what is already known.
4. **Applicable constraints and conventions**.
5. **Required output format and word cap**.

"Go look around" briefs are forbidden when findings already exist.

### Return contract
`Result / Files changed (path:lines) / Deviations / Open questions`

- Coders: ≤200 words total; never paste diffs back.
- Explorers: ≤300 words; when findings exceed ~40 lines write them to `.claude/findings/<slug>.md`
  and return conclusions + path only.
- Architects: write the full plan to `.claude/plans/<task-slug>.md`; return only the path, a
  3–5 bullet summary, and open questions (≤10 lines total).

`.claude/plans/` and `.claude/findings/` are gitignored scratch space — safe to delete, prune
when stale (>1 week).

### No duplicate exploration
- Paste Haiku findings verbatim into architect/coder briefs — one distillation, not two rounds.
- Run parallel Haiku scans for independent areas (single message, multiple `Agent` calls).
- Prefer continuing an existing agent (`SendMessage`) over respawning a fresh one.

### Anti-patterns
- Whole-file `Read` when a line range suffices.
- `Grep` without `head_limit` in the main thread.
- Forwarding raw tool output instead of the distilled finding.
- Two agents exploring the same area.
- Spawning a fresh agent when the previous one can continue.

## Dynamic workflows (Workflow tool)

**Standing authorization:** multi-agent orchestration via the **Workflow** tool is authorized as a
standing default in this project — treat this rule as my explicit opt-in. Don't ask "should I run a
workflow?" and don't wait for the `ultracode` keyword; script one whenever the task has the shape
below. *(Source of truth for this section: ai-brain `skills/setup-agents/templates/workflow.md` —
edit it there and copy verbatim; keep it project-agnostic.)*

**Default to a workflow.** Once a task fans out, a script-driven run (`agent()` / `pipeline()` /
`parallel()`) is the orchestration, not a hand-chained sequence of `Agent` dispatches:
- multi-file or multi-layer feature work (plan → implement per layer → verify)
- reviews, audits, security/perf sweeps (fan out, then judge)
- migrations and mechanical rewrites across many files
- research sweeps over an unfamiliar area, verify-findings passes over a list of claims

**Stay with a single `Agent` dispatch** for one-file/one-step changes, a single targeted question, a
lookup, or conversational work. Nothing trivial gets a workflow — but when in doubt, workflow.

### Model mapping inside `agent()` — mandatory

`agent()` inherits the **main-loop model** when nothing is set; in a Fable 5 session that silently
runs every stage on Fable. Never allow it: **every `agent()` call carries an explicit `agentType`
or `model`.**

| Stage | Set on `agent()` | Effective model |
|---|---|---|
| Exploration, mapping, greps (locate) | `model: 'haiku'`, `effort: 'low'` plain greps / `'medium'` broad mapping (fallback `model: 'sonnet', effort: 'low'` only if Haiku is unavailable or its sweep comes back thin) | Haiku 5.5 |
| Verify / check passes | `model: 'haiku'`, `effort: 'low'` | Haiku 5.5 |
| Judgment reads (summarise, audit, compare) | `model: 'opus', effort: 'low'` | Opus |
| Well-specified / plan-driven code edits, test writing | `agentType:` the named coder, `model: 'sonnet'`, `effort: 'medium'` | Sonnet 5.5 |
| Purely mechanical, exactly-specified edits (verbatim find/replace, ID swaps, template copy/sync) | `agentType:` the named coder, `model: 'haiku'`, `effort: 'medium'` | Haiku 5.5 |
| Escalated implementation (cross-cutting, security, no plan, blocked) | `agentType:` the named coder, `effort: 'medium'` | Opus (frontmatter) |
| Planning, design, judging, adversarial review | `agentType:` the named architect / test planner, `effort: 'high'` (`'xhigh'` hard designs) | Opus (frontmatter) |
| Anything else | pick one of the rows above — never omit both | — |

**Escalation:** a Sonnet coder that is stuck or finds the plan ambiguous returns it under `Open
questions` instead of guessing; the orchestrator asks the architect (`SendMessage`) or
re-dispatches the coder without the `model` override (Opus). Escalate up front for cross-cutting,
security, auth/billing or migration work, no written plan, or a single dependent chain.

`agentType` beats the inherited model and also pulls in that agent's tool restrictions and output
contract, so naming the project's own agents is the safest form. Fable stays in the main loop: it
writes the script, reviews returns, talks to the user. No workflow stage runs on Fable.

### Contracts still apply

- Each `agent()` prompt is a **self-contained brief** per the Brief contract above — a stage cannot
  see the script, the session, or its siblings.
- Use `schema` on any stage whose output a later stage consumes; free text only for the final
  stage or a human-facing summary.
- Plans go to `.claude/plans/<slug>.md`, large findings to `.claude/findings/<slug>.md`; pass
  **paths** between stages, never pasted bodies.
- The Return contract (`Result / Files changed / Deviations / Open questions`) and its word caps
  hold inside workflows exactly as for `Agent`.

### Size

Respect the session's workflow size guideline — default **medium (aim for < 15 agents)**. Prefer
depth (a few well-briefed stages) over width; go bigger only when the user asks for scale.

### Patterns

- **Pipeline (default for features):** explore (haiku) → plan (architect, writes
  `.claude/plans/<slug>.md`) → implement (named coders, `parallel` per layer, given the plan path)
  → verify (haiku + the project's test command).
- **Adversarial verify (reviews/audits):** `parallel` finders (haiku, one concern each, `schema`'d
  findings) → dedupe → **judge** (architect) that discards unreproducible findings → report file.
- **Parallel explore sweep (unfamiliar area):** `parallel` haiku explorers, one per subsystem, each
  returning a `schema`'d summary plus a findings-file path → one synthesis stage.

Long runs go **background**; report the run and collect results instead of blocking.

## Rules

- **Minimal changes only.** No comments, docblocks, or refactors on code you didn't need to change.
- **Use what exists.** Don't create new abstractions unless the task requires it.
- **Don't create files unnecessarily.** Prefer editing existing files.
- **Ask, don't assume.** Ambiguity or multiple valid approaches → ask the user first.
