# Reconnaissance

### Phase 1: Detect the stack, map the app, seed the ledger

Recon is read-only. The parent can do it alone for small apps. For large ones it launches 2–3 `Explore` agents in parallel. They return facts with `file:line` and write nothing.

## 1a. Stack detection (parent, deterministic)

Read `composer.json`, `composer.lock`, `package.json`, `package-lock.json`, the `vite.config.*` / `webpack.mix.js` files, `bootstrap/app.php`, and `app/Http/Kernel.php` (if present). Record in `run-metadata.json` → `stack`:

| Fact | How |
|---|---|
| `laravel` major | `laravel/framework` in composer.lock (`10`, `11`, `12`, `13`) |
| `php` constraint | composer.json `require.php` → choose the laragon PHP binary that satisfies it |
| `frontend_mode` | `inertia` if `inertiajs/inertia-laravel` is present; `spa` if `vue-router` and no Inertia; `blade-islands` if Blade views mount Vue (`createApp(` in resources/js plus `@vite`/`mix(` in blade); `blade-only` |
| `inertia` major | `inertiajs/inertia-laravel` and `@inertiajs/vue3` versions (2 vs 3: v3 dropped `router.on('finish')` style, check notes) |
| `bundler` | `vite` / `mix` (Mix means: no `import.meta.glob`, chunks come from `webpackChunkName`) |
| `vue` major | `vue` in the lockfile. **2.x → legacy path** (one migration finding, skip the deep Vue rules) |
| `state` | `pinia` / `vuex` / none |
| `ts` | `typescript` + `tsconfig.json`, and the share of `<script setup lang="ts">` vs plain `<script setup>` (count with `grep -l`) |
| `structure` | the existence of `app/Actions`, `app/Services`, `app/Http/Requests`, `app/Http/Resources`, `app/Policies`, `app/Enums`, `resources/js/Composables` (casing varies) |
| `cms` | is this the multi-tenant cms (`BLOCKS.md` present, `resources/views/public/blocks`)? If so, record the `branch` and treat `master`-owned core vs customer layer as a fix constraint |

## 1b. App map

Get the map from the framework where you can and grep only as a fallback:

1. **Routes**: `"$PHP" artisan route:list --json` (read-only, needs a bootable app, no DB). If it fails to boot, parse `routes/*.php` and record the boot failure (it may itself be a D9 finding, e.g. an exception at boot). Keep the JSON in the agent scratch, since D6 reuses it.
2. **Controllers / Actions / Services / Jobs / Listeners / Commands**: files under `app/`, with method counts and line counts (`wc -l`). Flag files over 500 lines as complexity hotspots.
3. **Models**: `app/Models/*` with `$fillable/$guarded`, `$casts`/`casts()`, relations, `$with`, global scopes.
4. **Schema**: every `database/migrations/*` file in order, which gives a derived column/index/FK map per table. Include `Schema::table` alters and `dropColumn`. If `database/schema/*.sql` (a squashed dump) exists, read it first.
5. **Frontend**: `resources/js/Pages/**` (Inertia), `resources/js/{components,Components}/**`, composables, stores, the router file, and the entry (`app.js/ts`), including how pages resolve (`import.meta.glob` eager or lazy).
6. **Tests**: `tests/Feature`, `tests/Unit`, and Pest vs PHPUnit, and which subsystems have none.
7. **Subsystems**: group by domain and do not use one bucket per folder. Use the route prefixes and name groups (`payroll.*`, `shifts.*`, `admin.*`), plus a controller namespace and its pages. Aim for 5–15 subsystems. Each gets a stable `subsystem` ref: its main repo-relative path or route-name prefix (e.g. `routes:payroll.*` or `app/Http/Controllers/Payroll`).

## 1c. Tool inventory

Probe what is installed **without installing anything** (see TOOLING.md for the commands) and record `tools_available` in the metadata: `phpstan/larastan` (with level from `phpstan.neon`), `pint`, `phpunit/pest`, `eslint` + `eslint-plugin-vue`, `vue-tsc`, `jscpd` (only if it is in `node_modules/.bin` or a global install; `npx --no-install jscpd`), and `composer audit` / `npm audit` (network, so these are owner-run only).

## Prior runs

Read the latest `~/laravel-vue-audit/<repo>/run-*/findings.json` and `coverage-ledger.json` if they exist. For each prior record, `git diff --stat <prior_ref>..HEAD -- <cited files>` decides whether it is same-source (carry) or changed (revalidate). Record the prior paths in the metadata. Missing priors: say so.

## `architecture.md` (≤ 800 words)

1. The product in one paragraph: users, the main flows, and the money or payroll areas (they matter for D7).
2. The stack facts from 1a and the version notes that apply (L10 vs L12/13, Inertia 2 vs 3, Mix vs Vite).
3. The subsystem list with refs, starting paths, route counts, and hotspots.
4. Data scale hints: tables likely to be large (time entries, shifts, logs, audit trails, invoices × lines), from domain plus seeders and factories. They calibrate D2 impact.
5. Existing project conventions (AGENTS.md / CLAUDE.md in the target): e.g. "money in cents", "Actions not Services". **Conformance is measured against the project's own stated conventions first, Laravel/Vue defaults second.**
6. Tools available and the tool-pass candidate counts per dimension.
7. Prior-run carry and revalidate summary.

## Coverage ledger

`coverage-ledger.json` is a JSON array of units. **Unit = subsystem × dimension.** The quick profile uses subsystem `all` (ref `profile/quick/all`). Deep splits a subsystem into child refs (`<ref>#<group>`).

```json
{
  "coverage_id": "app%2FHttp%2FControllers%2FPayroll::D2",
  "subsystem": "Payroll",
  "subsystem_ref": "app/Http/Controllers/Payroll",
  "dimension": "D2",
  "companions": ["PERF-BACKEND.md"],
  "starting_paths": ["app/Http/Controllers/Payroll", "app/Services/Payroll"],
  "tool_candidates": 3,
  "prior_status": "none",
  "wave": 1,
  "status": "planned",
  "agent_id": null,
  "reviewed_paths": [],
  "checks": [],
  "result_fingerprints": [],
  "unresolved": [],
  "observations": []
}
```

- `coverage_id` = `encodeURIComponent(subsystem_ref)` + `::` + dimension (RFC 3986 encoding that also escapes `!'()*`). It is deterministic, so the same unit gets the same ID across runs. Sort by `coverage_id`.
- `prior_status` ∈ `none|new|prior_confirmed_same_source|prior_confirmed_changed_source|prior_needs_validation|prior_deferred|prior_blocked|prior_covered_same_source|prior_covered_changed_source`.
- `not_applicable` is for dimensions that do not apply to a subsystem (e.g. D3 for a backend-only API subsystem, D12 when there is no UI). It needs a reason in `unresolved`. Seed it explicitly. Do not omit the unit.
- `observations` is parent bookkeeping (style and pre-existing notes for REPORT.md). It is not coverage evidence.

State table (the validator enforces it):

| status | agent_id | reviewed_paths / checks | result_fingerprints | unresolved |
|---|---|---|---|---|
| `planned` | null | empty | empty | empty |
| `not_applicable` / `out_of_scope` / `deferred` | null | empty | empty | non-empty reason |
| `in_progress` | owner | empty | empty | empty |
| `blocked` | owner | both non-empty | empty | non-empty blocker |
| `covered` | owner | both non-empty | empty | empty |
| `candidate` | owner | both non-empty | non-empty | optional |

Each check is `{ "agent_id", "pattern", "method": "source|tool|local", "reviewed_paths": [...], "result" }`. `pattern` names the companion catalog entry (e.g. `PERF-BACKEND.md#N+1 in loops`). The unit-level `reviewed_paths` equals the union of the check paths. A `tool` check must state that a hunter read the code: a tool hit alone never closes a unit.

Run `node <skill>/validate-coverage-ledger.cjs <output>/coverage-ledger.json` after seeding and after every update.
