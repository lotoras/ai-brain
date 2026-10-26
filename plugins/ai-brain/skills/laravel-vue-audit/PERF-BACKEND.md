# D2: Backend performance

## When to use
Every subsystem that has controllers, jobs, commands, or Inertia/API responses touching Eloquent or the query builder.

## Core discipline
A perf finding is **a trace plus a scale**. The trace is: the request or job entry → the loop or response builder → the query that repeats or scans. The scale is: which table, its rough row counts (from seeders, factories, domain, or docs; otherwise say "unknown → needs_validation"), and how often the path runs. Something that is slow in theory on a 30-row lookup table is not a finding.

## Pattern catalog

### N+1 in loops
- Anchors: `foreach (\$\w+ as`, `->map(fn`, `->each(`, `@foreach` in Blade, and `JsonResource::collection` / `->through(` on paginators, followed by a `->relation` property access or `->relation()->` inside.
- Also check API Resources: a `toArray` that touches `$this->relation` without `whenLoaded('relation')` is an N+1 whenever the controller does not eager-load.
- Accessors / `$appends` that query (`getXAttribute` → `$this->rel->…`, `Attribute::get(fn () => $this->items()->sum(...))`) give an N+1 on every serialization.
- Policies called in a loop (`@can` per row) that query relations.
- Counter-evidence: `with([...])`, `load`, `loadMissing`, `$with` on the model, a scope applying `with`, `Model::preventLazyLoading()` in AppServiceProvider (it throws in dev, which makes an N+1 unlikely to survive), `chaperone()` (L11+), `withCount`/`withSum` already present.

### Counting and existence
- `->get()->count()`, `->get()->isEmpty()`, `->get()->first()`, `count(Model::where(...)->get())`, and `->all()->where(...)` (collection filtering after loading everything).
- Fix: `->count()`, `->exists()`, `->first()`, a DB-side `where`.

### Unbounded reads
- `Model::all()` / `->get()` on a growing table in a request path, without `paginate`/`cursorPaginate`/`limit`. Exports or reports over all rows without `chunkById`/`lazyById`/`cursor`.
- Scheduled commands that load whole tables into memory.
- Counter-evidence: the table is bounded by design (settings, roles, wage types per tenant), or the query is scoped to a small parent.

### Missing indexes
- Compare the real query shapes (`where`, `orderBy`, `whereHas` subqueries, FK joins, `unique` lookups) against `tools/schema-map.cjs` output.
- Laravel's `foreignId()->constrained()` creates an index on MySQL (InnoDB adds one for FKs). A plain `unsignedBigInteger('x_id')` without `->index()` or a foreign key has **no** index.
- Composite filters (`where tenant_id = ? and date between`) want a composite index in the right column order. A single-column index on the low-selectivity column barely helps.
- `whereDate(col, …)`, `whereYear`, and `LOWER(col)` defeat indexes. Use range bounds instead.
- `orderBy` on a non-indexed column combined with pagination over large tables.
- Validation: read **every** migration for the table, including later `Schema::table` additions, and `database/schema/*.sql`. If the DB is MySQL and the column is an FK with `constrained()`, it is indexed.

### Wide selects / hydration cost
- `select *` on tables with large text/json columns (descriptions, payloads, logs) for list views. Fix: `select([...])` or `->without` heavy columns. This is only a finding when the column is actually large and the view is a list.
- Hydrating thousands of models only to `pluck`/`sum` → use `->pluck()`, `->sum()`, `->value()` in the DB.

### Aggregates in PHP
- `$model->items->sum('amount')` / `->count()` per row → `withSum`, `withCount`, `withAvg`, `withExists`.
- `->groupBy()` on a Collection after `get()` where SQL `GROUP BY` would do it.

### Sync heavy work
- Mail, PDF generation (Browsershot, dompdf), external HTTP, image processing, or large exports inside the request cycle. Fix: a queued job (`ShouldQueue`), `dispatch()->afterResponse()` for light ones, or `Mail::queue`.
- Validation: is a queue worker configured (QUEUE_CONNECTION not `sync` in `.env.example`, Supervisor/Horizon docs)? If not, the fix also needs ops work (D9). Say so.

### Caching opportunities
- Expensive, rarely changing reads computed per request (settings, permissions trees, holiday calendars, tax tables). Fix: `Cache::remember` / `rememberForever` with explicit invalidation on write, or `once()` (L11+) for per-request memoization.
- Not a finding if the computation is cheap or the data changes per request.

### Inertia payload size (frontend_mode=inertia)
- Large props on every visit: whole collections, unpaginated relations, a big `HandleInertiaRequests::share()` (shared props run on **every** request, including partial reloads unless wrapped in closures).
- Inertia 2: `Inertia::defer(fn () => …)`, `Inertia::optional(fn …)` (`lazy` is deprecated), `Inertia::merge` for infinite scroll, and partial reloads (`only:`) on the client.
- Inertia 3: check the installed docs/types in `vendor/inertiajs` before you recommend an API. Do not guess names.
- Evidence: the prop source and an estimated size (rows × fields). If you can't estimate it, use needs_validation.

### Repeated queries per request
- The same lookup is executed in middleware, the controller, and the view (e.g. `auth()->user()->company` resolved several times without memoization, or settings queried per helper call).

## Version notes
- L10: no `once()`, no `chaperone()`, and `Model::shouldBeStrict()` exists (L9.35+). `lazyById`/`chunkById` exist.
- L11+: `once()`, `chaperone()`, slimmer skeleton (no Kernel.php: middleware lives in `bootstrap/app.php`).
- L12/13: same as L11 for these patterns. Check `composer.lock` before you suggest any newer API.

## Validation rules
1. Reject an N+1 if any eager-load path covers the relation on **this** call path (follow the controller → service → query builder; check `$with` and global scopes).
2. Reject an index finding unless all migrations and squashed schema dumps for the table have been read, or if the table is small by design.
3. Scale is required. If it is unknown and decisive, use needs_validation with the owner plan "SELECT COUNT(*) FROM <table> on prod or a staging copy".
4. Likelihood comes from callers: a list/index/dashboard/API index route is high, a detail page is medium, an admin one-off or a nightly job over a small set is low.
5. A queue recommendation must check whether the project already queues anything. If it doesn't, the effort is at least M.
6. Optional local confirmation (deep profile only): an existing or new **scratch** feature test with `DB::enableQueryLog()` or `DB::listen` counting queries for N vs N+1 rows, run only under the isolated-DB rule. Record the counts in `local_check`.

## Idiomatic fixes
`with()/load()` + `whenLoaded` in Resources · `withCount/withSum/withExists` · `exists()/count()` · `paginate/cursorPaginate` · `chunkById/lazyById` for batch work · a composite index migration (new migration file; never edit an old one) · `ShouldQueue` jobs · `Cache::remember` + invalidation in an observer or model event · Inertia `defer/optional` + client `only:` reloads · `Model::preventLazyLoading(! app()->isProduction())` as a guard rail (an S-effort quick win when absent).
