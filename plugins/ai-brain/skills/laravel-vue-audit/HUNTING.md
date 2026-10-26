# Hunting

### Phase 2b: Coverage-led hunting waves

The parent assigns `planned` ledger units to fresh agents. Group the units of one subsystem across **related** dimensions into one hunter (D2+D8, D6+D7, D5+D4, D3+D12) when that keeps the prompt focused. Never let one hunter own unrelated subsystems in `standard`/`deep`. In `quick`, one hunter per dimension group covers subsystem `all`.

Agent types: use `laravel-craftsman` for backend-heavy units (D2, D5-Laravel, D6, D7, D8, D9) and `vue3-architect` for frontend units (D3, D5-Vue, D12). Use `general-purpose` for D4/D10/D11 or mixed units. In every case the agent is **read-only**: the prompt forbids edits explicitly, because both specialist agents are write-capable by default.

**Ranking** when a budget or profile caps hunters: (1) D6 integrity and D7 money/concurrency on hot or financial subsystems, (2) D2 on list/index pages and on large tables, (3) prior gaps and changed source, (4) the rest. Ties break by `coverage_id`.

Before launch, set the units to `in_progress` with `agent_id`, then validate the ledger.

## Required hunter prompt (in this order)

"Verbatim" below can mean either pasting the text or giving the absolute path with the instruction "Read this file in full before you start". Agents have Read access, and paths keep prompts small and exact. Never send only a file *name* or a summary.

1. Role: "You are a read-only code-health hunter for a Laravel + Vue app. Find source-grounded defects in your assigned units and return exactly one JSON object matching the contract at the end. Do not edit, create, or delete any file in the target. You may write only to <scratch>."
2. `architecture.md`, verbatim.
3. The assigned units: `coverage_id`, subsystem, dimension, starting paths, and **the tool-pass candidate slice** for those units (the file:line list plus the tool name).
4. The companion file(s) for each dimension, **verbatim** (they are small by design). For D5 send only the half that applies (Laravel and/or Vue). For Vue 2 targets send only VUE-CONFORMANCE.md#Legacy Vue 2.
5. The core method and candidate gate below.
6. Exclusions: carried prior fingerprints (fingerprint + title only) and peer-owned coverage IDs.
7. The structured result contract below plus the `confirmed` and `needs_validation` branches of `report-schema.json`, verbatim.

## Core hunting method (include verbatim)

```text
## Method
READ THE CODE. A tool hit or grep match is a pointer, not evidence. Open the file, read the
whole method and its callers, and decide what actually happens at runtime.

For each candidate:
1. Name the concrete consequence (extra queries at scale N, a 500, wrong money, a cache break,
   duplicated rule that already diverged, an untestable unit, an upgrade blocker).
2. Find the counter-evidence first: eager loads (with/load/loadMissing/$with/scopes),
   preventLazyLoading, caching, later migrations adding the index, traits/parents/macros
   providing the method, Inertia defer/lazy, project conventions in AGENTS.md/CLAUDE.md.
   If a control handles it, drop the candidate.
3. Check the framework VERSION notes in the companion; do not apply L12 idioms to L10 or
   Inertia 3 APIs to Inertia 2.
4. Trace callers: is this path hot (index/list/dashboard, per-request middleware, scheduled
   job over all rows) or cold (one-off admin action)? That sets likelihood.
5. Write the smallest idiomatic fix and a regression check (test or query-count assertion).

DEPTH BOUND: settle each candidate either way and move on. Stop when every assigned unit has a
disposition. Variants of one root cause in your units: one candidate, several locations.
A different root cause outside your units: return it under "uncovered".

NO EXECUTION beyond: reading files, ripgrep, and the bundled read-only helpers. Do not run
artisan commands that touch the DB, tests, migrations, installs, or network tools.

STYLE IS NOT A FINDING. Naming, formatting, ordering, "I'd use a Service here" without a
consequence → put it in "observations".
```

## Candidate gate (include verbatim)

```text
## Candidate gate
1. Every location is repo-relative file:line that you opened. No absolute paths.
2. A confirmed proposal states consequence + counter-evidence checked + likelihood reason.
   Dimension minimums: D2/D3 need `scale`; D4 needs >=2 locations, `extraction_target`,
   `divergence`; D6 needs the empty lookup that proves the target is missing (in evidence).
3. If a decisive fact is not visible in source (prod row counts, whether a route is used,
   deployed workers), propose needs_validation with exact blockers and a plan. No priority.
4. Tag `security-adjacent` for mass-assignment / unescaped output / missing authorize-vs-siblings;
   do not do exploit analysis.
5. Fingerprint: stable, source-derived, `<dimension>:<category>:<primary-file-or-symbol>`,
   e.g. `D6:missing-controller-method:WageTypeController@search`. No line numbers, agent, or verdict.
   Format ^D<n>:<kebab-category>:<symbol>$, symbol chars [A-Za-z0-9._:/@+-], may start with _ (use - for spaces).
6. Return an empty candidates array if nothing survives.
```

## Structured hunter result

Return exactly one JSON object and no prose around it. **Also write the same JSON to `<scratch>/result.json`**, so that the parent consolidates from a file instead of re-typing it (verifiers do the same with `<scratch>/decision.json`):

```json
{
  "units": [
    {
      "coverage_id": "…",
      "disposition": "covered|candidate|blocked",
      "reviewed_paths": ["app/…"],
      "checks": [
        {"agent_id": "h-payroll-d2", "pattern": "PERF-BACKEND.md#N+1 in loops", "method": "source",
         "reviewed_paths": ["app/…"], "result": "PayrollController@index eager-loads employees.contracts; no N+1"}
      ],
      "candidate_fingerprints": [],
      "unresolved": []
    }
  ],
  "candidates": [],
  "observations": ["style or pre-existing note, file:line"],
  "uncovered": [{"subsystem_ref": "…", "dimension": "D7", "starting_paths": ["…"], "reason": "…"}]
}
```

A `candidates` entry is a `report-schema.json` record that uses `proposed_verdict` in place of `verdict` and **omits `id`** (the parent assigns `LVA-NNN`). For a proposed `confirmed`: every required field of that branch. For a proposed `needs_validation`: that branch's fields, with no impact/priority/effort.

Every assigned `coverage_id` appears once. `covered` means checks are present and there are no fingerprints. `candidate` lists its fingerprints. `blocked` has checks plus an unresolved blocker.

## Parent consolidation

- Validate each unit result. On a malformed result, put the unit back to `planned` for a fresh hunter and do not repair it.
- Copy checks, paths, fingerprints, and unresolved items into the ledger, and observations into the unit's `observations`.
- Merge candidates by fingerprint, then by root cause (the same root cause in several places is one candidate with several locations; for D4 that is the point).
- Link each fingerprint from the unit whose `dimension` matches the fingerprint prefix (same subsystem). A grouped hunter (D2+D8) that finds a D8 issue closes the D8 unit with it. If no matching unit exists, create it (`prior_status: "new"`) instead of linking it across dimensions. The validator rejects cross-dimension links.
- Tool-pass candidates that no hunter addressed stay listed in the unit's `unresolved` until the critic reassigns them. They never silently disappear.
- Run `validate-coverage-ledger.cjs`.

## Coverage critic

After each wave, run one fresh `Explore` agent with `architecture.md`, the ledger, and the candidate fingerprints. It reads source and returns only:

```json
{"missing_units": [{"subsystem_ref": "…", "dimension": "D2", "starting_paths": ["…"], "reason": "source-backed gap"}],
 "reassign_ids": ["coverage_id closed without real checks"],
 "stop": false}
```

The critic looks for: routes or pages with no unit, units closed with tool-only checks, a subsystem where D2 was "covered" but its index pages were never read, tool candidates no hunter addressed, and prior `needs_validation`/`deferred` items left untouched.

- `standard`/`deep`: queue the accepted units and reassignments and repeat until a critic returns nothing (stop).
- `quick`: one critic only. Accepted items become `deferred` with reason `quick_profile_final_critic`.
- Scoped: out-of-scope gaps become `out_of_scope`.
