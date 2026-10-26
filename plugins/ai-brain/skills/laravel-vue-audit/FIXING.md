# Fix mode (optional, explicit only)

Runs **only** when the user names findings: "fix LVA-012, LVA-019", "fix the quick wins", or "fix all P1". The audit itself never changes target source. Fix mode is a separate, deliberate step.

## Preconditions
1. Load the named records from the latest `~/laravel-vue-audit/<repo>/run-N/findings.json`. Refuse `rejected` and `needs_validation` records (offer to validate them first).
2. Re-check each record's locations against the current HEAD. If the cited code changed since the audit ref, re-verify the finding (fresh verifier) before you fix it.
3. The target worktree must be clean (`git status --porcelain` is empty). If it is not, stop and ask.
4. The brain protocol (if available): `brain_lock` on the files you are about to edit and `brain_task_start` with one checklist item per finding.
5. **cms multi-tenant:** a customer branch gets fixes only in the customer layer (custom blocks, `custompublic.scss`, seeders, content). A finding whose fix belongs in a core file → stop and propose "fix on `master`, then `/upgrade-branch`".

## Procedure
1. Create the branch `audit-fix/<run-N>-<short>` from the current branch (never commit on `master`/`main` directly).
2. **Baseline**: run the project's checks that exist, with the DB isolated (`phpunit.xml` must point to a test DB or sqlite `:memory:`, otherwise skip the tests and say so):
   - `"$PHP" artisan test` (or `vendor/bin/pest` / `phpunit`)
   - `"$PHP" vendor/bin/phpstan analyse --no-progress` (if installed)
   - `"$PHP" vendor/bin/pint --test` (if installed, on the changed files only, as a style gate)
   - `node_modules/.bin/vue-tsc --noEmit` (if installed)
   - the frontend build (`npm run build` via `$NODE`) when Vue or JS files change and the project builds locally. **cms:** the built assets are committed (see the cms AGENTS.md).
   Record which ones failed **before** any change, so that pre-existing failures are not blamed on the fix.
3. **One finding per commit**, in priority order:
   1. Write or extend a **regression test first** where feasible: a feature test for D6 routes or columns, a query-count assertion for N+1 (`DB::enableQueryLog()`; assert `count(DB::getQueryLog())` stays constant for 1 vs N rows), a unit test with the exact money example for D7, a test that asserts a unique violation or lock for races. Confirm that it **fails** on the current code.
   2. Apply the smallest idiomatic fix from the record's `remediation` (version-correct; new migrations only, never edit released ones).
   3. Run the regression test plus the baseline checks. Everything that passed before must still pass, and the new test must pass.
   4. Commit: `fix(<area>): <title> (LVA-NNN)` with the consequence in the body and the attribution footer.
   5. If verification fails and a reasonable second attempt also fails: `git reset --hard HEAD` for this finding only (nothing has been committed yet), and mark it `fix_failed` with the failing output.
4. Do not bundle unrelated refactors. Do not reformat untouched code.

## Output
Append to `<run-dir>/FIXES.md`: per finding, the status (`fixed|fix_failed|skipped`), the commit SHA, the test added, and the check results before and after. Report the branch name to the user. **Do not push or open a PR** unless asked.

## What fix mode never does
It never runs migrations against a non-test DB, never installs or updates dependencies (a D10 upgrade is a plan, not a fix), never touches `.env`, never force-pushes, and never edits `vendor/` or `node_modules/`.
