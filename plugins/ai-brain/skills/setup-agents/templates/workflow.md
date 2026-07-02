# Workflow — How to Handle Change Requests

This is the orchestration rule. When referenced, follow this process end-to-end.

## Phase 1: Understand

1. **Read the files involved.** Understand what exists before proposing anything.
2. **Identify the layer.** Where does this change belong?
{{LAYER_MAP}}
3. **Identify the minimal change.** The least work that solves the problem, reusing existing
   helpers, services, components, and patterns. No refactors of surrounding code, no abstractions
   for one-off changes.

## Phase 2: Plan

4. **State the problem and solution in plain language** before writing code — what's wrong, what
   changes, which files.
5. **Check for existing tests** covering the affected behavior. If none exist, suggest the right
   test type to the user and wait for their answer before proceeding.

## Phase 3: Execute with Sub-Agents

**Every code edit MUST go through a named sub-agent — no direct `Edit` / `Write` from the main
thread, even for one-line changes.** The main thread plans and verifies only. Dispatch by layer:

{{DISPATCH_LIST}}

If a change spans multiple layers, dispatch the corresponding coders **in parallel** (single
message, multiple `Agent` tool calls), each with only the context relevant to its layer.

### What the main thread may do directly
- Read files (`Read`, `Grep`, `Glob`) within the reading discipline below
- Run read-only shell commands (git status/log/diff, tests, linters)
- Write plan files in plan mode and memory files
- Dispatch sub-agents

## Phase 4: Verify

- **Review what the sub-agents produced** — minimal, matches the plan, follows existing patterns,
  nothing unrelated touched.
- **Run the tests** for the affected area: {{TEST_COMMAND}}

## Reading discipline

The main Claude thread is for synthesis, trade-offs, planning, and user interaction. The domain
architects run on Opus by default and are Fable-upgradeable — when the task says to use Fable,
dispatch them with `model: "fable"` (the dispatch-time override beats their frontmatter default).
Test planning ({{TEST_PLANNER_NAMES}}) is always Opus. File reading that doesn't contribute to
judgment work goes to a **Haiku** sub-agent (`Explore` or `general-purpose` dispatched with
`model: "haiku"`). Sonnet is reserved for execution by the named coders ({{CODER_NAMES}}).

### Delegate to Haiku (`model: "haiku"`)
- Broad / unknown scope — "find every place that does X", "map this area"
- Large-file scans where only a pattern or a few snippets are needed
- Git archaeology across multiple files
- Cross-cutting greps that would flood the main context

### Read directly from the main thread (Fable 5)
- Verifying a sub-agent's summary on any load-bearing claim
- Targeted reads of a known small file (1–3 files) where you know exactly what you need
- The plan file itself while iterating in plan mode

### Suggested flow per task
1. Fable 5: receive task, think about scope.
2. Haiku (`Explore`, `model: "haiku"`): broad mapping, returns a summary.
3. Fable 5: read 1–3 key files to verify what the plan hinges on.
4. Fable 5: write the plan, resolve trade-offs, interact with the user.
5. Sonnet (named coder): execute the plan.
6. Fable 5: verify the diff, run tests, report back.

Reading sprees and mass greps in the main thread are a smell — more than a couple of exploratory
reads in a row means stop and dispatch an agent.

## Rules

- **Minimal changes only.** No comments, docblocks, or refactors on code you didn't need to change.
- **Use what exists.** Don't create new abstractions unless the task requires it.
- **Don't create files unnecessarily.** Prefer editing existing files.
- **Ask, don't assume.** Ambiguity or multiple valid approaches → ask the user first.
