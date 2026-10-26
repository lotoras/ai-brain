# Deterministic tool pass

### Phase 2a: Run before hunters, read-only

Tools produce **candidates**: lists of locations that hunters must read. A tool hit is never a finding on its own. Run what is installed, skip what is not, and record both in `run-metadata.json` → `tools_available`. Never install, update, or fetch.

Write all tool output to `<output>/agents/tools/scratch/`. Summarize counts per dimension in `architecture.md` and hand each hunter the slice for its unit.

## Binaries

- PHP: read `PHP_BINARY` from the target `.env`. If it is absent, choose the newest `C:/laragon/bin/php/php-*/php.exe` that satisfies composer.json `require.php` (and that is not newer than the lockfile platform if `config.platform.php` is set). Call it `$PHP`.
- Node: `NODE_BINARY` from `.env`, else `C:/laragon/bin/nodejs/node-v22/node.exe`. Call it `$NODE`. Run local bins via `"$NODE" node_modules/<pkg>/bin/...` or `node_modules/.bin/<x>`. Use `npx --no-install` only; never plain `npx`.
- Run from the target root, but write outputs to scratch only. Do not let tools write caches into the target: pass `--no-cache` / `--cache-dir <scratch>` where supported.

## Bundled helpers (always available, dependency-free)

These live in `<skill>/tools/` and run with `$NODE`. They read the target and write JSON to stdout.

| Helper | Purpose | Feeds |
|---|---|---|
| `node <skill>/tools/schema-map.cjs <target>` | Replays `database/migrations/*` (create/table/rename/drop column, index, unique, foreign, morphs, timestamps, softDeletes) into `{table: {columns, indexes, foreign_keys}}`. Lists the migrations it could not parse in `warnings`. A squashed `database/schema/*.sql` is parsed first if present. | D2 indexes, D6 columns, D8 |
| `node <skill>/tools/route-integrity.cjs <target> [route-list.json]` | Checks that every route action `Controller@method` (or invokable) resolves to a class file that declares that method (or `__invoke`), allowing for traits in the same app, `Route::resource` default methods, and parent classes inside `app/`. Uses `artisan route:list --json` output if given, else a best-effort parse of `routes/*.php`. | D6 |
| `node <skill>/tools/column-check.cjs <target> [--schema schema-map.json] [--paths app]` | For each statement that starts a static chain on an app model (`Model::where(...)->...->get([...])`, `Model::create([...])`, including chains inside `DB::transaction(function () {...})` bodies), it checks the literal column names in the chain's own calls (where*/orderBy/pluck/value/select/get/create/update keys) against the schema. It skips closure arguments (related models), joins, `selectRaw`/`as` aliases, `withCount` aliases, accessors, and interpolated names. On PlanMe this found the multi-line `User::whereHas(...)->get([..., 'shift_type'])` miss that a manual hunter scan skipped. | D6, D8 |
| `node <skill>/tools/phpstan-signal.cjs <phpstan.json> <target>` | Filters larastan JSON to the high-signal classes (undefined app methods and variables, relation methods, `App\Models` properties, call-on-null, Carbon-on-string, wrong argument count, always-true/false) and drops the generic `Model::$prop` noise. On PlanMe, 2,885 errors become 477. | D6, D7, D11 |
| `node <skill>/tools/dupe-scan.cjs <target> [--min-tokens 70] [--paths a,b]` | Token-window clone detector for `.php`, `.vue`, `.js`, `.ts`, `.blade.php`. Normalizes identifiers, literals, and whitespace, then hashes rolling windows and merges overlaps. Output: clone groups with locations and token length. A jscpd fallback. | D4 |

A helper's output is candidates too. In particular, `route-integrity` reports "unresolved" when a method comes from a vendor parent or a macro. The hunter must check before it calls a route broken.

## Framework introspection (read-only, needs a bootable app)

```sh
"$PHP" artisan about --json                # versions, drivers, cache state
"$PHP" artisan route:list --json > <scratch>/routes.json
"$PHP" artisan model:show <Model> --json   # (L10+) columns from the live DB schema: only if the DB is a local dev DB; never live
```

`model:show` reads the configured DB. Use it only when `.env` points to localhost or sqlite. Otherwise rely on `schema-map.cjs`. A boot failure goes in the metadata and may become a D9 candidate.

## Static analysis and lint (if installed)

| Tool | Detect | Command (output → scratch) | Candidates for |
|---|---|---|---|
| larastan / phpstan | `vendor/bin/phpstan`, `phpstan.neon*` | `"$PHP" vendor/bin/phpstan analyse --error-format=json --no-progress --memory-limit=1G > <scratch>/phpstan.json` (project config and level as-is; also note the level for D11) | D6 (undefined method/property/relations), D7, D11 |
| pint | `vendor/bin/pint` | `"$PHP" vendor/bin/pint --test --format=json > <scratch>/pint.json` | **observations only** (style) |
| phpunit / pest | `vendor/bin/phpunit` / `pest` | **not in the tool pass**: only in FIXING and in `deep` local confirmation, with the DB isolated (see SKILL.md) | n/a |
| eslint + eslint-plugin-vue | `node_modules/eslint`, `node_modules/eslint-plugin-vue`, plus a project config | `node_modules/.bin/eslint --format json "resources/js/**/*.{vue,js,ts}" > <scratch>/eslint.json` with the **project config only**. If there is no config, skip it (do not invent rules) | D3, D5 Vue |
| vue-tsc | `node_modules/vue-tsc` | `node_modules/.bin/vue-tsc --noEmit -p tsconfig.json > <scratch>/vue-tsc.txt` | D11, D6 (missing props/emits) |
| jscpd | `node_modules/.bin/jscpd` or global | `jscpd --silent --reporters json --output <scratch>/jscpd --min-tokens 70 --format "php,vue,javascript,typescript" app resources/js resources/views` | D4 (prefer it over `dupe-scan` when present) |

## Grep sweeps (always)

Each companion's pattern catalog has grep anchors. In the tool pass, run the **cheap high-yield** ones across the whole app and bucket the hits by subsystem:

```sh
rg -n "env\(" app routes resources/views database --glob '!config/**'           # D5/D9 env() outside config
rg -n "\$guarded\s*=\s*\[\s*\]" app/Models                                        # D5 security-adjacent
rg -n "(create|update|fill|forceFill)\(\s*\$request->all\(\)" app                 # D5 security-adjacent
rg -n "\{!!" resources/views ; rg -n "v-html" resources/js                         # D5 security-adjacent (+D12)
rg -n "->get\(\)->(count|first|isEmpty|isNotEmpty)\(\)" app                        # D2
rg -n "::all\(\)" app/Http app/Services app/Actions                                # D2 unbounded
rg -n "catch \((\\\\?Exception|\\\\?Throwable) \$\w+\)\s*\{\s*\}" app             # D7 swallowed
rg -n "(float\)|floatval|round\()" app --glob '*Payroll*' --glob '*Invoice*'       # D7 money (refine per app)
rg -n "import\.meta\.glob\([^)]*eager:\s*true" resources/js                        # D3
rg -n "from ['\"](moment|lodash)['\"]" resources/js                                # D3
rg -n "\$listeners|\.sync=|\$on\(|\$off\(|filters:|Vue\.(set|delete|filter|mixin)" resources/js   # D5 Vue 2 leftovers
```

Use the Grep tool (ripgrep) for these. Exclude `vendor`, `node_modules`, `public/build`, `public/js`, `storage`, and `bootstrap/cache`.

## Network tools (owner-run only)

`composer audit`, `npm audit`, `composer outdated`, and `npm outdated` contact registries. **Do not run them.** Put the exact commands in REPORT.md → "Owner-run checks" (D10), so that Marc can run them.
