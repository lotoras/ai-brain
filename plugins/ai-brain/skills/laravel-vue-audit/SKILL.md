---
name: laravel-vue-audit
description: Code-health audit for Laravel + Vue 3 apps (Inertia, Blade+Vue islands, or Vue Router/Pinia SPA). Finds slow (N+1, missing indexes, heavy bundles), duplicated, broken-wiring, incorrect (money/transactions/races), and non-idiomatic ("not the Laravel/Vue way") code with source-grounded evidence and independent verification. Use for any audit request in a Laravel or Vue project — "audit this", "run an audit", "audit the app / codebase", "code audit", "code-health check", "audit/review this Laravel/Vue app" — and for performance or duplication sweeps, conformance reviews, PR review with --diff, or a requested audit report. Not a security audit: a security-audit request or deep security analysis goes to the security-audit skill.
---

# Laravel + Vue Audit

Find code that is **slow, duplicated, broken, incorrect, or fighting the framework** in Laravel + Vue 3 apps. For each issue, give the owner the source evidence, the concrete consequence, a priority, an effort estimate, and the smallest idiomatic fix. Without a concrete consequence, a candidate is not a finding. Generic best-practice nags are not findings.

Adapted from the methodology of [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) (MIT, see [NOTICE.md](NOTICE.md)). It keeps that skill's discipline: evidence bar, coverage ledger, fresh verifiers, schema-validated output, and profiles. Its security breadth is dropped.

## Operating modes

The skill runs in **guidance mode** by default. Loading it does not authorize a full audit or the creation of files.

- **Guidance mode**: for questions ("is this N+1?", "how should this be a FormRequest?"), focused reviews of a file or PR, or triage of one finding. Use the relevant companion file(s) only. Do not create an output directory and do not run all phases. The evidence bar still applies to anything you call a defect.
- **Full audit mode**: for explicit requests to audit a codebase, a "full/complete review", or report artifacts. Run all six phases and write the files below.
- **Fix mode**: only on an explicit request that names findings ("fix LVA-012, LVA-019"). Follow [FIXING.md](FIXING.md). The audit phases never modify target source.

If the request could mean either guidance or a full audit, ask one focused question before creating files.

## Execution safety (all modes)

- Source inspection is read-only. Never edit target source, `.env`, the database, `vendor/`, or `node_modules/` during an audit.
- Use only locally installed tools ([TOOLING.md](TOOLING.md)). Never run `composer install/update`, `npm install`, `npx <pkg>` that fetches a package that is not installed, `migrate`, `db:seed`, `queue:work`, `schedule:run`, or anything that sends mail, calls payment/provider APIs, or touches a shared or live database.
- Executing target code is limited to read-only introspection (`artisan route:list --json`, `artisan about`, `artisan model:show`) and the project's **existing** test, analysis, and lint commands. Point those at an isolated test database (sqlite `:memory:` or the phpunit.xml testing DB) and never at the dev or live DB. If `phpunit.xml` does not isolate the DB, do not run tests: report a `needs_validation` blocker.
- Use the project's binaries (`$PHP_BINARY`/`$NODE_BINARY` from `.env`, the laragon PHP matching `composer.json`'s `php` constraint), never a guessed global one.
- Never use the CMS MCP `live` instance or any production URL as evidence.

## Full audit setup

Resolve these values before reconnaissance:

- **Skill dir**: the directory that contains this file.
- **Target**: the absolute repo root. **Repo name**: its directory name (for a multi-tenant cms, add `@<branch>`).
- **Output dir**: `~/laravel-vue-audit/<repo-name>/run-<N>/` (next unused N), always outside the target. Hunters and verifiers get `<output>/agents/<agent-id>/scratch/` for temporary files. Agent IDs match `^[a-z0-9][a-z0-9_-]{0,63}$`.
- **Source ref**: `git rev-parse HEAD`, branch, and the dirty flag. For `--diff <ref>`: record the merge base and the changed file list.

The parent is the only writer of `run-metadata.json`, `architecture.md`, `coverage-ledger.json`, `findings.json`, `REPORT.md`, `QUICK-WINS.md`, and `NEEDS-VALIDATION.md`. Agents return structured JSON and never write shared files.

`run-metadata.json` holds at least `run_id`, `repo`, `target`, `source_ref`, `dirty`, `profile`, `scope_paths`, `diff_base` (or null), `stack` (from recon), `tools_available`, `budget` (or null), `prior_runs`, and `run_status` (`in_progress|complete|incomplete`) plus `incomplete_reason` when needed.

## Profiles and scope

Pick the profile from the request, or propose one based on size. The default is `standard`. Record it in metadata and state it in the report.

- **`quick`**: a fast first look or a re-run. Run the tool pass, then one hunter wave with **one hunter per dimension group** across the whole app (subsystem = `all`), and a single critic pass whose additions become `deferred`. Give each candidate one fresh verifier, which does Phase 3 and Phase 5 in one pass. Priority dimensions: D6, D2, D7, D5. The others run only if they are cheap.
- **`standard`**: ledger units = subsystem × dimension, then hunting waves until the critic accepts no new units. Phase 3 and Phase 5 are separate passes.
- **`deep`**: units are split further (per controller group / per page group). Add an optional local confirmation (query-count tests, see PERF-BACKEND.md). Run critic waves to a clean pass and give critical subsystems (money, payroll, auth) a second independent pass.
- **Scoped** (`paths:` / one subsystem / one dimension): only in-scope units are planned. Everything else becomes `out_of_scope`, never `covered`.
- **`--diff <ref>`** (PR review): seed units only for subsystems that contain changed files. Hunters may read unchanged code for context but report only issues that the diff **introduced or touched**. Pre-existing issues next to the diff go into `observations` with "pre-existing".

A `quick`, scoped, or diff run must call itself a partial pass. Profiles change breadth and never the evidence bar.

**Budget.** One ledger unit is roughly one hunter, and one candidate is roughly one verifier (quick) or two (standard/deep). When a budget is set, reserve the critic call(s) and about 30% for verification before assigning hunters. Units the budget cannot reach become `deferred` with reason `budget`. Never thin out the evidence to fit a budget.

## Dimensions (stable IDs)

There is no D1: security is out of scope. See "Security-adjacent" below.

| ID | Dimension | Companion |
|---|---|---|
| D2 | Performance, backend | [PERF-BACKEND.md](PERF-BACKEND.md) |
| D3 | Performance, frontend | [PERF-FRONTEND.md](PERF-FRONTEND.md) |
| D4 | Duplication (literal + semantic) | [DUPLICATION.md](DUPLICATION.md) |
| D5 | Framework conformance | [LARAVEL-CONFORMANCE.md](LARAVEL-CONFORMANCE.md), [VUE-CONFORMANCE.md](VUE-CONFORMANCE.md) |
| D6 | Integrity / dead wiring | [INTEGRITY-AND-CORRECTNESS.md](INTEGRITY-AND-CORRECTNESS.md) |
| D7 | Correctness and concurrency | [INTEGRITY-AND-CORRECTNESS.md](INTEGRITY-AND-CORRECTNESS.md) |
| D8 | Data model health | [DATA-MODEL.md](DATA-MODEL.md) |
| D9 | Config and ops readiness | [OPS-AND-DEPS.md](OPS-AND-DEPS.md) |
| D10 | Dependency health (offline) | [OPS-AND-DEPS.md](OPS-AND-DEPS.md) |
| D11 | Type safety and test gaps | [TYPES-TESTS-A11Y-I18N.md](TYPES-TESTS-A11Y-I18N.md) |
| D12 | Accessibility and i18n (light) | [TYPES-TESTS-A11Y-I18N.md](TYPES-TESTS-A11Y-I18N.md) |

**Security-adjacent.** Some framework-hygiene issues are cheap to spot during D5 and have a security side effect: `$guarded = []` or `$request->all()` passed into `create/update/fill`, `{!! !!}` / `v-html` with model or user data, and a controller action with no `authorize`/policy/middleware where its siblings have one. Tag these `security-adjacent`. Report them with their framework consequence, and the report adds "run security-audit for depth". Do not do trust-boundary or exploit analysis here.

**Legacy Vue 2** (brokerware, deinunternehmen, or any `vue@^2`): detect it and emit **one** D5 finding, "Vue 2 is EOL, migration needed", with an inventory (component count, Vue 2-only APIs used, vue-router/vuex versions). Do not run the deep Vue rules against Vue 2 code.

## Evidence bar (what makes a finding)

Each companion file has the dimension-specific rules. Across all of them:

1. **Source-grounded.** Every location is a repo-relative `file:line` that the verifier re-read. Tool output (larastan, jscpd, eslint, vue-tsc) is a **candidate**, never a finding, until a hunter has read the code and established the consequence.
2. **Concrete consequence.** Name what goes wrong: extra queries per request at a stated scale, a broken `config:cache`, a 500 on a route, money that is off by a rounding step, an untestable 200-line action, an upgrade blocker, a mass-assignment exposure. "Not best practice" is not a consequence.
3. **Dimension minimums.**
   - Perf (D2/D3): a trace (loop → lazy relation; query → no matching index; import → bundle) **plus expected scale** (which table/page, and rough row/payload counts if they can be known from seeders, factories, docs, or domain).
   - Duplication (D4): **≥2 locations**, a named extraction target (scope, Action, FormRequest, composable, component, trait), and a divergence verdict (`identical|minor|diverged`). Diverged copies are a bug risk and rank higher.
   - Conformance (D5): the concrete consequence above. Pure style goes to `observations` (REPORT.md) and **never** to findings.
   - Integrity (D6): the broken reference and the proof that its target does not exist (the grep or migration scan that came back empty).
   - Correctness (D7): the input or state that produces the wrong result, and the expected result.
4. **Visible counter-evidence wins.** Before you claim a problem, look for the control that already handles it: eager loads in a scope, a global `$with`, `preventLazyLoading`, a caching layer, a composite index added in a later migration, a trait method, `__call`/macro routing, an `Inertia::defer`. If one exists, there is no finding.
5. **`needs_validation`** is for a source-grounded candidate where a decisive fact is not visible: production row counts, whether a route is actually used, deployed queue workers, or a test DB that cannot run. Name the exact blocker and a plan (`local` = a bounded check in the sandbox rules above; `owner` = something Marc can look up). It carries no priority. It is not a parking place for vague ideas.

## Priority, impact, effort

Only `confirmed` findings are prioritised.

- **Impact** (`low|medium|high|critical`): what happens when it bites.
  - critical: data or money is wrong, a core page or route is broken, or production is down (for example a `config:cache` break where `env()` returns null in prod, or a missing method on a used route).
  - high: a user-visible slowdown on a main path (N+1 on a list page, a several-MB bundle), a silent wrong result in an edge case, or a race on numbering.
  - medium: a measurable but bounded cost, or duplication that has already diverged, a maintainability trap, or an upgrade blocker.
  - low: a local inefficiency or friction with a small blast radius.
- **Likelihood** (`low|medium|high`): how often the triggering path runs or the condition occurs. A hot path or common input is high, an admin-only or rare path is low.
- **Priority** comes from impact × likelihood (ranks: low 1, medium 2, high 3, critical 4; likelihood low 1, medium 2, high 3): product ≥ 9 → **P1**, ≥ 6 → **P2**, ≥ 3 → **P3**, otherwise **P4**. The validator enforces this.
- **Effort** (`S` ≤ 1h, a local change · `M` ≤ 1 day, several files and a test · `L` > 1 day, a migration, an API change, or a refactor across modules).
- **Quick win** = priority P1/P2 and effort S. QUICK-WINS.md lists these first.

## Workflow (full audit)

1. **Reconnaissance**: detect the stack, map routes/controllers/models/pages, inventory tools, read prior runs, write `architecture.md`, and seed the ledger. See [RECONNAISSANCE.md](RECONNAISSANCE.md).
2. **Deterministic tool pass, then hunting waves**: run the installed tools read-only to produce candidate lists ([TOOLING.md](TOOLING.md)), then run hunters per ledger unit followed by a coverage critic ([HUNTING.md](HUNTING.md)).
3. **Candidate validation**: a fresh verifier per candidate fingerprint tries to refute it ([VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md)).
4. **Structured output**: write `findings.json` and run `node <skill>/validate-findings.cjs` and `node <skill>/validate-coverage-ledger.cjs` until both pass.
5. **Record verification**: a fresh agent per confirmed/needs_validation record checks the final record (merged into Phase 3 for `quick`).
6. **Reports**: `REPORT.md`, `QUICK-WINS.md`, and `NEEDS-VALIDATION.md` are derived from the final JSON. Prose never changes a verdict.

The run ends in exactly one of two states: (a) all artifacts are written and both validators pass, or (b) `run_status: "incomplete"` with a reason that the report discloses.

## Prior runs

If `~/laravel-vue-audit/<repo>/run-*/` exists, read the latest `findings.json` and `coverage-ledger.json`.
- A prior `confirmed` record whose cited code is unchanged is **carried**. It keeps its fingerprint and `id`, goes through the current verifier, and is excluded from hunters.
- A prior record whose code changed becomes a revalidation target.
- Prior `rejected` records suppress only the exact same claim on unchanged code.
- Prior `deferred` or `blocked` units become current work.
- Keep `id`s stable across runs (`LVA-NNN`). New findings take the next unused number.

## Anti-patterns

1. Best-practice checklists presented as findings ("should use a Service class") without a consequence.
2. Tool output pasted as findings without reading the code.
3. Claiming an N+1 without checking `with()`, `$with`, `load()`, `loadMissing`, scopes, and Resource `whenLoaded`.
4. Claiming a missing index without reading **all** migrations (later ones add indexes), or for a table that will stay tiny.
5. Duplication with one location, or "these look similar" without an extraction target.
6. Style (naming, ordering, brace placement, `pint` diffs) in findings. These go to observations.
7. Deep security analysis. Tag `security-adjacent` and point to security-audit.
8. Running migrations, seeders, installs, or anything against a non-test DB.
9. Prioritising `needs_validation` records, or writing the report before verification.
10. Flagging Laravel 12 idioms on a Laravel 10 branch (or the reverse). Check the version notes in each companion.
11. On the multi-tenant `cms`: recommending edits to core files that `master` owns as the fix for a customer branch. Prefer a new block or custom layer (see the cms AGENTS.md), or say "fix on master and upgrade the branch".

## Files

- Phase docs: [RECONNAISSANCE.md](RECONNAISSANCE.md) · [TOOLING.md](TOOLING.md) · [HUNTING.md](HUNTING.md) · [VALIDATION-AND-REPORTING.md](VALIDATION-AND-REPORTING.md) · [FIXING.md](FIXING.md)
- Contracts: `report-schema.json`, `validate-findings.cjs`, `validate-coverage-ledger.cjs` (shared core in `lib/schema-core.cjs`)
- Bundled target helpers (read-only): `tools/schema-map.cjs`, `tools/route-integrity.cjs`, `tools/column-check.cjs`, `tools/phpstan-signal.cjs`, `tools/dupe-scan.cjs`
- Parent pipeline helpers: `tools/consolidate.cjs` (Phase 2→3), `tools/assemble-findings.cjs` (Phase 4), `tools/apply-phase5.cjs` (Phase 5), `tools/render-report.cjs` (Phase 6)
- Agent dir conventions: hunters `agents/h-*/scratch/result.json` · Phase 3 verifiers `agents/v-*/scratch/{batch,decision}.json` · Phase 5 `agents/p5-*/scratch/{records,decision}.json` · negative controls `agents/negative-control/` (never prefixed `v-`)
- Self-tests: `node validate-findings.test.cjs && node validate-coverage-ledger.test.cjs && node tools/tools.test.cjs`
