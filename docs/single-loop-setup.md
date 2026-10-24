# Single-loop setup: from role pipelines to one focused main loop

**Status:** applied 2026-10-24 (ai-brain plugin 0.10.0, superpowers 5.1.0-fork.3), steps 1–6 in one pass. Decisions: evals skipped (no baseline was recorded), Fable folded into the single loop (`fable-edit-guard` retired), project architect/coder agents kept as on-demand files, rolled out to every `setup-agents` project except planme.
**Source:** Anthropic, [Building agents: When to fold subagents into your main agent loop](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop) (2026-10-22).

## 1. What the guide says

- **Shared context beats handoffs.** One model that has seen every step connects them better than an orchestrator reading subagent summaries. Every handoff loses something.
- **Progressive disclosure replaces splitting.** Skills and tool search load context only when it's needed, which removes the main reason to split work across subagents (keeping each context small).
- **Newer models need less scaffolding.** From Opus 4.5 on, models plan, narrate and check their own work. Routers, planners and fixed pipelines often do work the model already does. Anthropic cut Claude Code's own system prompt by over 80% for advanced models.
- **Split by context, not by role.** Splitting by team or problem type ("architect → coder → verifier") turns into a game of telephone. A subagent should get work that needs little from the rest and returns a compact result.
- **Subagents still earn their place when:** context bloat measurably hurts the main loop · tasks run in parallel and benefit from fresh, disposable contexts · black-box verification (a checker that must not see how the work was done) · tool choice or conflicting instructions break one agent.
- **Migrate by measuring.** Build about 10 real tasks with a rubric. Change one thing at a time, run each task more than once, and look at which tasks flipped, not just the average.

## 2. Where my setup stands

**Always-on policy per session** (bytes, measured 2026-10-24):

| Source | Opus session | Fable session |
|---|---|---|
| `~/.claude/CLAUDE.md` (global) | 11,578 | 11,578 |
| ai-brain `CLAUDE.md` | 5,929 | 5,929 |
| ai-brain `.claude/rules/workflow.md` | 17,291 | 17,291 |
| `session-model-guard` injection | 4,389 | 5,226 |
| superpowers `using-superpowers` injection | 5,421 (full) | 1,599 (condensed) |
| **Total** | **≈44.6 KB (~11k tokens)** | **≈41.6 KB** |

Projects provisioned by `setup-agents` carry about the same load: the `workflow.md` template is 19,040 B and the CLAUDE.md section 5,100 B.

Most of this text is **one rule set about routing work to subagents**: which model explores, plans, codes, verifies and judges, plus effort levels, escalation and brief/return contracts. The phrase "cheapest tier that holds quality" alone appears in 7 files (global CLAUDE.md, ai-brain CLAUDE.md, `workflow.md`, the `setup-agents` skill and both of its templates, `session-model-guard.js`). It is my version of the guide's "Frankenprompt": each fix added another paragraph, and none were consolidated.

The default posture is the opposite of the guide's. The rules say "when in doubt, workflow", `cc-enhance` appends `use ultracode` to almost every prompt, and planned work always runs Haiku explore → Opus architect → Sonnet testing-coder → Sonnet coders → Haiku verify.

## 3. Audit: keep or fold

**Keep** = the split is by context (bulky output, parallel fresh contexts, black-box checking) or by capability (a different model can do something Claude can't). **Fold** = the split is by role, so the main loop should do it.

| # | Part | Split by | Verdict | Why |
|---|---|---|---|---|
| 1 | Opus main loop plans and makes small edits directly (direct-edit exception) | — | **Keep, widen** | This already is the single loop. Make it the default for all sequential work, not an exception. |
| 2 | Haiku `Explore` locate sweeps | context | **Keep, narrow** | Right for unknown-scope sweeps, large logs and git archaeology whose raw output I don't need. Wrong for targeted reads of 1–3 known files: the main loop should read those itself (1M context). |
| 3 | Domain architects (`*-architect`, Opus) writing plans for the main thread | role | **Fold** | In an Opus session the architect is the same model as the main loop, so the plan file becomes a lossy handoff to myself. The main loop writes and revises the plan (the guide's "plan on turn one, revise as results arrive"). |
| 4 | Domain coders (`skill-coder`, `hook-coder`, …) for sequential work | role | **Fold** | The 5-part brief contract exists to make up for the handoff loss. For a single dependent chain the main loop already holds the context. |
| 5 | Coders for many-file mechanical edits / independent layers in parallel | context | **Keep** | Parallel, fresh contexts, compact returns. This is exactly the guide's keep case. Haiku for verbatim edits, Sonnet for well-specified ones. |
| 6 | `testing-coder` writes red tests from the plan before implementation | context (black-box) | **Keep, make optional** | Tests written without seeing the implementation are black-box verification. Use it for planned multi-file work. For small changes the main loop writes the tests. |
| 7 | Haiku verify/check passes (`node --check`, diffs, `setup.ps1 -Check`) | role | **Fold** | Running a command with short output doesn't need a subagent. The main loop runs checks and reads the result. Keep a subagent only for huge outputs. |
| 8 | Opus-at-low-effort "judgment reads" (summarise, audit, compare) | role | **Fold** | Same model as an Opus main loop, minus the context. Keep only for parallel multi-source research. |
| 9 | Standing Workflow opt-in + "when in doubt, workflow" | — | **Keep the opt-in, flip the default** | The tool must stay armed (the hook injection is what authorizes it), but the default becomes "when in doubt, single loop". Workflows are for parallel fan-out: multi-concern reviews, research sweeps, many-file migrations. |
| 10 | Fable 5 as a strict orchestrator + `fable-edit-guard` | role | **Decide (step 6)** | The strongest role split: the most capable model is forbidden from doing the work and spends its turns on briefs. It's a cost decision, so measure it instead of assuming. |
| 11 | `session-model-guard` routing essays | — | **Shrink** | Keep the workflow opt-in sentence (technically required) and one short line per model. Drop the restated routing table. |
| 12 | threebrain: Codex review / adversarial review / rescue | capability + black-box | **Keep** | A decorrelated model reviewing a diff is the guide's black-box verification. Trigger-gated already. |
| 13 | threebrain: ChatGPT in Chrome for video/audio/YouTube | capability | **Keep** | Perception Claude lacks; not a role split. |
| 14 | media-gen, pixel-art, stop-animation, animated-sections, site-style, recolor-icons, ssh-pageant | skill (domain procedure) | **Keep** | This is the guide's target model: skills hold procedure, loaded on demand. Run `/skill-doctor` once to find dead weight. |
| 15 | Global CLAUDE.md "Media generation" and "Design work" routing tables | — | **Fold into skill descriptions** | They restate what each skill's `description` already triggers on. Progressive disclosure means the skill list does this job. |
| 16 | superpowers `using-superpowers` session injection ("1% chance → invoke") | — | **Trim** | Claude Code already lists skills and loads them on demand. On Opus, switch to `CONDENSED.md` or drop the injection, then check that brainstorming/debugging still trigger. |
| 17 | superpowers `subagent-driven-development`, `dispatching-parallel-agents` | role / context | **Keep as on-demand skills** | Fine when explicitly chosen for a large plan. They must not be the default path. |
| 18 | `threebrain-after-task` Stop hook (Simplify / Review ask) | — | **Keep** | One user-gated ask after code changes; no automatic subagents. |
| 19 | `noop-agent-guard` | — | **Keep** | Cheap safety net. It will fire less once background orchestration is rare. |
| 20 | `ssh-guard` | — | **Keep** | Unrelated to orchestration. |
| 21 | Plan/findings files (`.claude/plans/`, `.claude/findings/`) | — | **Keep** | A plan file is the main loop's working memory and acceptance criteria. Findings files only for the subagents that remain. |
| 22 | Brief + return contracts, token-economy rules | — | **Keep, shorten** | Still right for every remaining subagent. They need 5 lines, not a section. |
| 23 | `cc-enhance` appends `use ultracode` by default | — | **Flip** | Append it only when the task splits into independent parallel parts. |
| 24 | `setup-agents` provisions architect/coder pairs + a 19 KB workflow rule into each project | role | **Rework (step 5)** | New lean template: single-loop rule (~40 lines), `testing-coder` kept, architect/coder pairs optional. Existing projects untouched until it's proven. |

## 4. Target shape

1. **Default:** the session model works in one loop. It reads, plans (a plan file for multi-step work), edits, runs the checks and verifies, loading skills and tools on demand.
2. **Spawn only for a context reason:**
   - bulky reads whose raw output isn't needed → Haiku `Explore`, ≤300-word return;
   - independent parallel work that benefits from fresh contexts → a Workflow (every `agent()` sets `model` or `agentType`);
   - black-box verification → `testing-coder` red tests from the plan, or a Codex review.
3. **Capability delegates unchanged:** Codex, ChatGPT in Chrome, media-gen, pixel-art.
4. **Always-on policy target:** under 15 KB total (from ~44 KB), with each rule stated once.

## 5. How to measure

**Eval set:** 10 real tasks from my projects, frozen as prompts in `docs/single-loop-evals.md` (to be written in step 0). Mix them, for example:

- 2 × single-file fixes (hook bug, skill wording)
- 2 × multi-file features in a real project (one with tests, e.g. an ai-brain hook + its `.test.js`)
- 1 × debugging a failing test
- 1 × multi-file refactor or migration
- 1 × review of an existing diff
- 1 × research or "map this area" question
- 1 × design or frontend task routed through a skill
- 1 × media or skill-triggering task (checks that progressive disclosure still fires the right skill)

**Per run, record:**

| Task | Run | Pass (rubric) | Wall time | Cost / tokens | Subagents spawned | My corrections | Notes |
|---|---|---|---|---|---|---|---|

- **Rubric:** 2–4 yes/no checks per task (tests green, right files touched, nothing unrelated changed, right skill loaded).
- **Run each task twice per configuration.** Intermittent regressions show up in only one run.
- **Compare by flipped tasks:** list every task that passed before and fails after (or vice versa) and read those transcripts. The averages come second.
- **Keep a change** if no task flips to fail and cost or time improve. Otherwise revert it (`git revert` in ai-brain, then redeploy with `setup.ps1`).

## 6. Migration steps (one at a time)

Each step: edit the `setup/claude-home/**` source → redeploy with `setup/setup.ps1` → `diff ~/.claude/<f> setup/claude-home/<f>` → run the eval set → keep or revert.

| Step | Change | Files | Measure |
|---|---|---|---|
| **0** | Write the 10-task eval set and record a **baseline** on the current setup. | `docs/single-loop-evals.md` (new) | Full table, 2 runs each |
| **1** | **Flip the default:** single loop when in doubt; workflows only for parallel fan-out. `cc-enhance` stops adding `use ultracode` by default. | global `CLAUDE.md` (Dynamic workflows), `session-model-guard.js` (opt-in wording), `cc-enhance/SKILL.md` Step 1.8, ai-brain `workflow.md` | Subagent count, cost and time drop with no failed flips |
| **2** | **Opus does sequential work itself:** fold architects, sequential coders, Haiku checks and Opus judgment reads (audit rows 3, 4, 7, 8). Keep Haiku sweeps, parallel coders and `testing-coder`. | global `CLAUDE.md` (Handoffs, Token economy), `session-model-guard.js` (Opus block), ai-brain `CLAUDE.md` + `workflow.md` | The multi-file feature and refactor tasks especially |
| **3** | **Deduplicate the always-on policy:** state each rule once (global CLAUDE.md), cut the hook to the opt-in plus one line per model, fold the Media/Design tables into skill descriptions. | global `CLAUDE.md`, `session-model-guard.js`, affected `SKILL.md` descriptions | Bytes (target < 15 KB) and the skill-triggering tasks |
| **4** | **Trim superpowers:** Opus gets `CONDENSED.md` (or no injection). | `plugins/superpowers/hooks/session-start`, `FORK.md` | Brainstorming, debugging and TDD still trigger when they should |
| **5** | **Lean `setup-agents`:** new single-loop `workflow.md` template, architect/coder pairs optional, `testing-coder` kept. Re-provision one project first. | `setup-agents/SKILL.md`, `templates/*` | Run the eval set in the re-provisioned project |
| **6** | **Fable decision:** run the eval set with Fable as strict orchestrator vs. Fable working in a single loop. Keep or retire `fable-edit-guard` and the Fable-upgrade rules on the numbers. | `fable-edit-guard.js`, `session-model-guard.js` (Fable block), `cc-enhance` Step 1.6 | Quality vs. cost per task |

## 7. Draft replacement wording

### 7a. Global `~/.claude/CLAUDE.md`: replaces "Handoffs across models" (planned-work part), "Dynamic workflows" and most of "Token economy"

```markdown
## Working style: one main loop
Work in one main loop by default: read, plan, edit, run the checks and verify yourself, loading
skills and tools on demand. For multi-step work, write `.claude/plans/<slug>.md` first (with
acceptance criteria) and revise it as results come in.

Spawn only for a context reason, never to split by role (architect → coder → verifier):
- **Bulky reads** whose raw output isn't needed (unknown-scope sweeps, big logs, git archaeology)
  → Haiku `Explore`, ≤300-word return.
- **Independent parallel work** that benefits from fresh contexts (multi-concern review, research
  across sources, mechanical edits across many files) → a Workflow; every `agent()` sets `model`
  or `agentType` (Haiku for sweeps and verbatim edits, Sonnet for well-specified coding, Opus for
  judgment).
- **Black-box verification**: red tests from the plan by `testing-coder` (Codex when I say
  "use codex") for planned multi-file work, or a Codex review.

Briefs for spawned agents are self-contained (objective, paths, findings, output format);
returns are `Result / Files changed / Deviations / Open questions`, ≤200 words.
```

The threebrain lines (Codex review/rescue, ChatGPT in Chrome for video/audio, media-gen) and the Stop-hook paragraph stay as they are.

### 7b. `session-model-guard.js` injection

```text
SESSION_WORKFLOW_POLICY: The user has opted into the Workflow tool for this session; this block
satisfies the opt-in on its own, so don't ask first. Default to one main loop. Use a workflow only
for independent parallel work (multi-concern reviews, research sweeps, many-file mechanical edits).
Every agent() call sets agentType or model.

Opus: work in the main loop — read, plan, edit and verify yourself. Spawn only for bulky reads
(Haiku Explore), independent parallel work (Workflow) or black-box verification.
```

The Fable block waits for step 6. Sonnet/Haiku sessions keep the opt-in only, as now.

### 7c. `setup-agents/templates/workflow.md` (lean version, replaces the 19 KB template)

```markdown
# Workflow
1. **Understand:** read the files involved; find the layer that owns the change.
2. **Plan:** for multi-step work, write `.claude/plans/<slug>.md` with acceptance criteria.
   Minimal change, existing patterns, no unrelated refactors.
3. **Tests:** planned multi-file work → `testing-coder` writes red tests from the plan first
   (black-box). Small changes → write the test yourself.
4. **Build:** do it in the main loop. Spawn only for bulky reads, independent parallel work
   (Workflow) or black-box checks.
5. **Verify:** run {{TEST_COMMAND}} and {{LINT_COMMAND}} yourself; read the diff before
   reporting done.
```

### 7d. `cc-enhance` Step 1.8

```markdown
## Step 1.8 — Ultracode keyword (only for parallel fan-out)
Add `use ultracode` as the Task's final sentence only when the task splits into independent parts
that can run in parallel (a multi-concern review, a research sweep, a mechanical edit across many
files). Otherwise omit it. If the raw task says "ultracode", always include it, exactly once.
```

## Decisions (2026-10-24)

- **Evals:** skipped for this pass; the eval set and baseline in §5 stay the method for the next change.
- **Fable:** works in one main loop like Opus. `fable-edit-guard` is retired (unwired by `RETIRED_HOOK_COMMANDS` in `setup/merge-settings.js`); the effort WARN stays. "use fable" now means one on-demand architect reviews the plan with `model: "fable"` in a non-Fable session.
- **Architect agents:** kept as on-demand files; coders are for parallel fan-out, `testing-coder` for black-box red tests.
- **Rollout:** every `setup-agents` project except planme migrated via `setup-agents` → "Migrate an existing provisioning".
