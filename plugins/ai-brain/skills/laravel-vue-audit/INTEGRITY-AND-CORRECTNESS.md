# D6: Integrity / dead wiring · D7: Correctness and concurrency

## When to use
D6 runs on every subsystem and has the highest hit rate per minute. D7 runs on every subsystem that writes data, with priority on money, payroll, invoices, numbering, scheduling, and time tracking.

## Core discipline
**D6:** a reference points at something that does not exist, or something exists that nothing references. Proof is the **lookup that came back empty**, recorded in `evidence` (e.g. "rg `function search` in app/Http/Controllers/WageTypeController.php: no match; no trait or parent defines it").
**D7:** name the input or state that produces the wrong result, and the expected result. "Could be racy" without the interleaving is not a finding.

## D6 pattern catalog

### Routes → missing controller methods
- `tools/route-integrity.cjs` output, then the hunter checks each unresolved item for: traits (`use XTrait;`), parent classes, `__call`, `Route::resource(...)->only/except`, invokables, and `Route::controller(X::class)->group`.
- Impact: critical if the route is linked from the UI (search `route('name')`, `href`, Ziggy `route()` in Vue, and `router.visit('/path')`). Otherwise high (the route 500s if hit). A dead route that nobody links to → medium, and the fix is to delete it.

### Queries → missing columns
- Start from `tools/column-check.cjs` output (deterministic, handles multi-line chains and transaction closures), then extend it by hand to what the tool skips: relation chains (`$user->shifts()->where(...)`), joins, variables as column names, raw SQL, and validation rules.
- `where('col')`, `orderBy('col')`, `select`, `pluck('col')`, `$model->col` writes, `$fillable` entries, validation `unique:table,col` / `exists:table,col`, and Resource fields, checked against `tools/schema-map.cjs`.
- **Do not dismiss a tool miss as a "collection" call without checking where the chain starts.** `Model::...->get([...])` is a query even when the chain spans many lines with closures in between. Only a chain on an already-loaded Collection (`$users->pluck('x')`) is a collection call. On PlanMe a hunter dismissed exactly this and missed `users.shift_type`.
- Watch for: `$appends` accessors (not columns), JSON paths (`col->key`), aliases from `selectRaw`, `withCount` aliases (`x_count`), and columns added by packages (`spatie/*` tables, `notifications`, `jobs`).
- Impact: a query against a missing column is a runtime SQL error, so it is high or critical by usage. A `$fillable` entry for a missing column → low (it is ignored silently, but it signals drift).

### Relations → missing models, FKs, or methods
- `belongsTo(Foo::class)` where `Foo` doesn't exist, the FK column is missing, or the relation name is used in `with('bar')` while no `bar()` method exists (this throws `RelationNotFoundException`).

### Frontend → backend wiring
- Ziggy `route('x.y')` / `route()` names in Vue or Blade that are not in `route:list`. `useForm().post(route('…'))` to an undefined name. Inertia `render('Pages/X')` where `resources/js/Pages/X.vue` doesn't exist (case-sensitive on Linux prod; Windows dev hides it, which makes this a **classic** deploy break).
- Props used in a page (`props.foo`) that the controller never sends → undefined at runtime. Check every `Inertia::render` call for that page.
- Translation keys used (`__('x.y')`, `$t('x.y')`, `trans()`) that are missing from `lang/*` for a supported locale. The UI then shows the raw key. Count per locale.

### Unused code (lower impact, cheap)
- Controllers, methods, jobs, mails, Vue components, or composables with no references; routes with no links and no external consumers (but check `api.php` consumers: those could be external → needs_validation); translation keys defined but never used.
- Impact low. Likelihood is not applicable, so use low. The value is the deletion. Batch these into **one** finding per subsystem (`D6:unused-code:<subsystem>`) with the list in `locations`.

## D7 pattern catalog

### Money arithmetic
- Floats for money: `(float)`, `floatval`, `* 1.081`, `round($x, 2)` on intermediate values, DECIMAL columns cast to `float`/`double`, and JS `Number` arithmetic on CHF amounts (`0.1 + 0.2`).
- Swiss specifics: CHF cash rounding to 0.05 (`round($x * 20) / 20` done on floats can mis-round; on integer **Rappen** use `intdiv`/`round` on ints), MWST/VAT rates, and AHV/ALV/BVG percentages applied per line versus per total (a mismatch between invoice lines and the total).
- The project convention may already be "integer cents" or `brick/money`/`moneyphp`. Then the finding is the **deviation** from it.
- Evidence: a concrete input (e.g. 3 lines of 33.35 at 8.1% MWST) and the wrong versus expected result. Compute it by hand or in a harness the verifier can re-run. Do not run target code.

### Missing transactions
- Multi-write operations (create the parent plus children, debit plus credit, status change plus ledger entry, payroll finalize plus payslips) without `DB::transaction` (or with `DB::beginTransaction` and no rollback on every path). The consequence is partial state on exception.
- Events or notifications dispatched inside the transaction that act on uncommitted data → `afterCommit` / `ShouldDispatchAfterCommit` / `DB::afterCommit`.

### Races and numbering
- Invoice, payslip, or document numbers computed as `max('number') + 1` or `count() + 1` without a lock or unique index. Two concurrent requests get the same number. Fix: `lockForUpdate()` in a transaction on a counter row, plus a **unique index** as a backstop.
- Check-then-act sequences (`if (!exists) create`) without `firstOrCreate` + a unique index, or `upsert`.
- Read-modify-write counters (`$m->balance += x; save()`) → `increment()` / an atomic update.
- Jobs that are not idempotent while the queue retries (`tries > 1`) → `ShouldBeUnique` or idempotency keys.

### Time and dates
- `now()` / `Carbon::now()` vs `today()` in different timezones (`config('app.timezone')` versus a user's TZ), storing local time without a TZ, `Carbon` mutability (`$date->addDay()` mutates a shared instance, use `CarbonImmutable` or `->copy()`), period boundaries (`<=` vs `<` on end dates, `endOfDay` missing), DST in shift/duration calculations (`diffInHours` across a DST switch), and `diffInMinutes` sign and absolute-value changes in Carbon 3 (L11+ ships Carbon 3, where `diffIn*` returns signed floats; code written for Carbon 2 that assumes positive ints breaks).

### Error handling
- Swallowed exceptions: `catch (\Exception $e) {}` or `catch (...) { return null; }` without logging or a rethrow on paths where failure matters (payments, mail, sync jobs).
- `report()`-less catches in jobs (the failed job looks successful).
- `firstOrFail` vs `first` misuse that leads to a null dereference later.

### Validation versus storage
- A validation `max:255` against a column `string(100)` (insert error), `nullable` validation against a non-null column, `integer` validation for a DECIMAL. These link to D8.

## Version notes
- Carbon 3 (L11+): signed float `diffIn*`. Carbon 2 (L10): absolute ints by default. Always check `nesbot/carbon` in composer.lock.
- `ShouldDispatchAfterCommit` on events: L10.30+/L11. `DB::afterCommit` everywhere.

## Validation rules
1. D6: the evidence must include the empty lookup **and** the checked alternatives (trait, parent, macro, `__call`, resource defaults, package-provided tables or columns). A missing piece of either → rejected or needs_validation.
2. D6 Inertia page and case: compare the exact case of the path in `render()` against the filesystem.
3. D6 unused code: confirm with a search that includes Blade, Vue, JS strings (`'ComponentName'`), dynamic `component :is`, `config/*`, console schedule, and event maps. Dynamic usage that cannot be resolved → needs_validation.
4. D7 money: the verifier recomputes the example. No example → needs_validation or rejected.
5. D7 races: name the two interleaved requests or jobs and the shared row. A path that can't run concurrently (a single admin cron with `withoutOverlapping`) → rejected.
6. D7 transactions: confirm that ≥2 writes exist, that a failure between them is possible (an exception path, an external call in between), and that no outer transaction exists in the caller.

## Idiomatic fixes
Add or remove the method or route · fix the column name or add a migration · `DB::transaction(fn () => …)` · `lockForUpdate` + a unique index · `increment()` · `firstOrCreate`/`upsert` + unique · integer Rappen + a money cast or `brick/money` · `CarbonImmutable` (`Date::use(CarbonImmutable::class)`) · `afterCommit` · log and rethrow · `ShouldBeUnique`.
