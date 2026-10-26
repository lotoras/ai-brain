# D9: Config and ops readiness · D10: Dependency health (offline)

## When to use
Once per app (subsystem `app`), plus per subsystem for queue, scheduler, and logging usage.

## Core discipline
**D9:** something that works on the dev box but breaks or degrades in production. Name the production condition (config cached, queue worker absent, fresh server from `.env.example`, logs shipped). **D10:** work offline from lockfiles only. Never run `composer audit`/`npm audit`/`outdated`; those are owner-run commands for the report.

## D9 pattern catalog

### `.env.example` drift
- Keys read in `config/*.php` (`env('X')`) that are missing from `.env.example`, so a fresh deploy silently uses the defaults. Keys in `.env.example` that nothing reads (cruft). Secrets with real-looking values committed in `.env.example` (tag `security-adjacent`).
- Method: list `env\('([A-Z0-9_]+)'` in `config/` and diff it against the `.env.example` keys. Never read or print `.env` values. Key names only.

### Queue wiring
- Jobs implementing `ShouldQueue` while `.env.example` / `config/queue.php` defaults to `sync`. Is that intentional? Is there a worker definition (Supervisor conf, Horizon, docker-compose, deploy docs)?
- No `failed_jobs` table migration (or `job_batches` when batches are used). No `$tries`/`$backoff`/`failed()` on jobs that call external services. `retry_after` smaller than the job's runtime gives duplicate execution (link D7 idempotency).
- Mail and notifications sent synchronously in requests (link D2).

### Scheduler wiring
- Commands defined in `routes/console.php` (L11+) or `app/Console/Kernel.php` (L10) without `withoutOverlapping()` when they can run longer than their interval, or without `onOneServer()` with several app servers. Is the cron entry (`schedule:run`) documented?
- Scheduled closures that swallow exceptions.

### Logging and PII
- `Log::info($request->all())`, logging full models (salaries, AHV numbers, IBAN, health data, passwords on failed logins), or `dd()`/`dump()`/`ray()` left in app code. The consequence is PII in log files and shipping (a GDPR/DSG issue: tag `security-adjacent`).
- `LOG_LEVEL=debug` / `APP_DEBUG=true` as defaults in `.env.example` for production templates.

### Boot and cache safety
- Code that fails `config:cache` (`env()` outside config, linked from D5) or `route:cache` (duplicate route names: check `route:list` for duplicates; closures serialize fine on L8+). `event:cache` and `view:cache` are rarely an issue.
- Service providers that query the DB in `register()`/`boot()` (this breaks artisan commands on a fresh DB and adds a query per request).

### Storage and files
- `public` disk usage without `storage:link` in the deploy docs. Local-disk storage in a multi-server setup. Temp files never cleaned.

## D10 pattern catalog (offline)

### Lockfile facts
- Framework and runtime: `laravel/framework` major versus support status (L10 security support ended Feb 2025; L11 bug fixes until Sep 2025 and security until Mar 2026; check current dates against https://laravel.com/docs/releases in the report, but do not fetch it). PHP constraint versus installed. Node engine.
- Abandoned packages: composer.lock entries with `"abandoned": true` or a replacement name.
- Known EOL frontend: `vue@2`, `vuex@3`, `laravel-mix` (maintenance mode, Vite is the default since L9.19), `moment`, `@inertiajs/inertia` (pre-1.0 package names), `vue-template-compiler`.
- Duplicated majors in `package-lock.json` (two copies of vue, two lodash majors) make the bundle larger (link D3).
- Patches or forks: `patches/` folders, `repositories` entries in composer.json with VCS forks, which are an upgrade burden. Observation unless outdated.

### Known-advisory names (offline heuristic)
- Report packages whose locked version is below a fix you know with certainty only, and phrase it as needs_validation with the owner plan "run `composer audit` / `npm audit`". Do not assert CVEs from memory as confirmed.

## Version notes
- L10: scheduler in `app/Console/Kernel.php`, `failed_jobs` migration shipped by default.
- L11+: scheduler in `routes/console.php`, the jobs and cache tables come in the default migrations, and the database queue is the default (`QUEUE_CONNECTION=database`).

## Validation rules
1. `.env.example` drift: cite the `config/*.php` line and confirm that the key is absent from `.env.example`. Never include `.env` values.
2. Queue findings need the job class, its dispatch site, and evidence about worker configuration (present or absent). Absent with no docs → needs_validation (owner: "is a worker running in prod?") unless the default is `sync` and the code expects async behavior. In that case it is confirmed.
3. PII logging needs the logged data to actually contain personal or financial fields (follow the variable).
4. D10 support-status claims must cite the version from composer.lock. Advisory claims are always needs_validation.

## Idiomatic fixes
Add the keys to `.env.example` · `config()` keys · `failed_jobs` migration + `$tries`/`$backoff`/`failed()` · `withoutOverlapping()->onOneServer()` · `Log::info('…', ['id' => $model->id])` context without PII · remove `dd()` · providers without DB access in `boot()` · an upgrade plan (L10→L12, Mix→Vite) as an L-effort finding with steps.
