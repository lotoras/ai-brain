# D5 (Laravel): Framework conformance

## When to use
Every backend subsystem. Measure against **the project's own conventions first** (target AGENTS.md / CLAUDE.md / existing patterns), then against Laravel defaults.

## Core discipline
Conformance findings need a **concrete consequence**: a broken `config:cache` or `route:cache`, mass-assignment exposure, logic that can't be tested or reused, an upgrade blocker, inconsistent behavior across endpoints, or silent type bugs. "Laravel usually does X" alone is an observation. If the project consistently does something its own way, and that way works, it is not a finding.

## Pattern catalog

### `env()` outside config (real bug)
- Anchor: `env\(` in `app/`, `routes/`, `resources/views/`, `database/` (seeders are a grey area: they run in deploy scripts with cached config).
- Consequence: after `php artisan config:cache`, `.env` is not loaded and `env()` returns **null** (or the default) at runtime. If production uses `config:cache` (check deploy scripts, `composer.json` scripts, docs, Forge/Envoyer files), this is a live defect: impact high/critical, effort S.
- Fix: add a key in `config/*.php` → `config('x.y')`.

### Validation in controllers
- `$request->validate([...])` / `Validator::make` inside controllers, especially when duplicated or long → a **FormRequest**. The consequence is untestable, duplicated rules and no `authorize()` hook. A single 2-rule inline validate in a one-off action → observation.

### Mass assignment and input handling (tag `security-adjacent`)
- `protected $guarded = [];` combined with `create($request->all())` / `update($request->all())` / `fill($request->input())` lets any column, including `is_admin`, `company_id`, `role`, or `paid_at`, be set by the client.
- `$request->all()` passed into `create/update` even with `$fillable`, when `$fillable` includes sensitive columns.
- Fix: `$request->validated()` / `$request->safe()->only([...])` with an explicit `$fillable`.
- Report it with the framework consequence. Link "run security-audit for depth". No exploit analysis.

### Authorization consistency (tag `security-adjacent`)
- One action in a controller lacks the `authorize()` / `Gate` / policy / `can:` middleware that its siblings have (compare per controller and per resource group). The consequence is an inconsistent access rule. Flag the inconsistency only; do not attempt deep authz analysis.

### Unescaped output (tag `security-adjacent`)
- `{!! $model->field !!}` with user- or model-controlled data (not trusted, admin-authored HTML that the CMS intends to render, such as cms block HTML fields; check BLOCKS.md). Fix: `{{ }}`, or sanitize on write (HTMLPurifier) when HTML is intended.

### Route-model binding
- `Model::findOrFail($id)` / `where('id', $id)->firstOrFail()` at the start of actions whose route parameter could be bound → typed `Model $model` parameters (with `scopeBindings()` for nested resources). The consequence is boilerplate plus missed scoping. On nested routes without scoping (`/companies/{company}/employees/{employee}` where the employee isn't checked to belong to the company), tag it `security-adjacent`.

### Response shaping
- Returning raw models or arrays (`return $model;`, `->toArray()`, hand-built arrays) from JSON APIs or as Inertia props where the shape is reused → **API Resources** (`JsonResource`). The consequence is leaked columns (hidden fields, timestamps, pivot), shape drift between endpoints, and N+1 risk. Inertia apps often pass arrays deliberately. It is a finding only when the same model is shaped differently in several places or the props leak sensitive columns.

### Casts and enums
- String or int status columns compared against literals across the code (`'status' => 'approved'` in 10 files) → a backed **enum** + cast. Dates kept as strings and parsed manually → `'date'`/`'datetime'`/`'immutable_datetime'` casts. JSON columns `json_decode`d by hand → the `array`/`AsCollection`/`AsArrayObject` casts. Money → an integer cast or a custom cast (see D7).

### Fat controllers and misplaced logic
- Controller methods over ~80 lines with business rules, or controllers over ~500 lines / ~15 actions → Actions, services, or a resource split. The consequence must be concrete: the logic is reused elsewhere (link D4), it can't be unit-tested, or it mixes concerns that change separately.
- Business logic in Blade views or in model accessors that query.
- Models with HTTP or session access (`request()`, `auth()` inside models) are hidden coupling and break in queues and console.

### Framework misuse
- `DB::raw` with interpolated variables (security-adjacent; also a correctness issue).
- Helpers like `config()` / `app()` inside loops is not a finding. Calling `Model::query()` in a constructor is.
- Events/listeners or observers that do heavy synchronous work (link D2).
- `Route::get` for state-changing actions (logout, delete) breaks prefetch and caches. It is a correctness finding (D7), tagged security-adjacent.
- Closures in routes files: these used to prevent `route:cache` (fixed in L8+, so not a finding on L10+ unless there is serialization trouble).

## Version notes
- **L10** (cms): `app/Http/Kernel.php`, the `$casts` property, `$request->validated()`, and the Mix bundler. No `casts()` method, no `once()`. Do not recommend L11 skeleton changes as findings. Upgrade advice belongs in D10.
- **L11+**: `bootstrap/app.php` holds middleware, exceptions, and routing. `casts()` method. Per-second rate limiting. `Model::automaticallyEagerLoadRelationships()` is 12.x only, so check the minor version.
- **L12/L13**: check the `laravel/framework` minor in composer.lock before you suggest new APIs. When unsure, describe the fix in L11 terms.
- **Inertia**: `Inertia::render` props shaping (see PERF-BACKEND). The shared props middleware is `HandleInertiaRequests`.

## Validation rules
1. `env()`: confirm the call is outside `config/` and not in a `config/*.php` file itself. Check whether deploys run `config:cache` (search the repo for it). Unknown → still confirmed as a defect (`config:cache` is the documented production step), with likelihood medium.
2. Mass-assignment: confirm that the request data really reaches `create/update/fill` unfiltered, and that `$guarded` or `$fillable` allows a sensitive column. If `$fillable` is tight and contains only safe fields → rejected.
3. FormRequest / Resource / route-binding suggestions need a consequence beyond style (duplication, a missed authorize, leaked columns, inconsistency). Otherwise → observation.
4. Fat-controller findings need the size **and** a reuse or test consequence. Line count alone → observation.
5. Check the project conventions doc before you flag a pattern the project chose deliberately.
6. cms branches: the fix must respect core vs customer layer (see SKILL.md anti-pattern 11).

## Idiomatic fixes
`config()` keys · FormRequests + `validated()` · explicit `$fillable` · policies + `authorize()` / `can:` middleware · implicit binding + `scopeBindings()` · `JsonResource` · enums + casts · Actions/services · `Route::post/delete` for mutations · `Inertia::render` with Resources.
