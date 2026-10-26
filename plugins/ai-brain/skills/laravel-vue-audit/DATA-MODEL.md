# D8: Data model health

## When to use
Every subsystem that has models and migrations. Run it with D2 (indexes) and D6 (columns) on the same `schema-map.cjs` output.

## Core discipline
The schema is the contract between the database, the model casts, the validation, and the UI. A finding is a **mismatch or missing guarantee with a consequence**: orphan rows, silent truncation, insert errors, a failed rollback, or values the code can't represent. Use `tools/schema-map.cjs` as the source of truth for the migration-derived schema and read the migrations themselves for anything it lists under `warnings`.

## Pattern catalog

### Missing foreign keys / cascades
- `*_id` columns declared as `unsignedBigInteger`/`integer` with no `foreign()`/`constrained()`, where the parent can be deleted. The consequence is orphans (lists then show "deleted user" or crash on `->parent->name`).
- `constrained()` with no `onDelete` behavior, where deleting the parent is a normal action → a FK error at delete time. Pick `cascadeOnDelete()`, `nullOnDelete()`, or `restrictOnDelete()` deliberately.
- Soft-deleted parents with hard FKs: cascades don't fire on soft delete, so children become visible orphans. Is that intended?
- Validation: some apps deliberately avoid FKs (multi-tenant DB split, legacy imports). Check the project docs (cms DATABASE.md).

### Nullability drift
- The migration says `nullable()`, but the model cast or the code assumes non-null (`->format()` on a nullable date), or validation is `required` (dead nullable). Or the reverse: the migration is non-null without a default, while validation is `nullable`/`sometimes` (insert error on omission).
- Compare three sources: the migration, `$casts`/`casts()`, and the FormRequest or inline rules for the same field.

### Type and length mismatches
- `string('name', 100)` vs `max:255` validation. `decimal(8,2)` for amounts that can exceed 999 999.99 (payroll totals per year, invoice sums). An `integer` primary key on high-volume tables (logs, time entries) versus `bigIncrements`. `float`/`double` columns for money (link D7). `enum()` DB columns whose value set differs from the PHP enum.

### Enum drift
- A DB `enum('status', [...])`, a PHP backed enum, validation `in:` lists, and Vue status maps that disagree. A value that one layer can produce and another rejects is an insert error or invisible rows. Find every place where the value set is spelled out.

### Migration hygiene
- `down()` empty or missing for destructive `up()` (dropping columns or tables, data transforms), so a rollback fails or loses data. Only a finding if the project uses rollbacks (deploy docs, CI) or the migration is recent and unreleased.
- Edited old migrations (git log shows a migration changed after later ones exist). Environments that already ran it silently diverge.
- Data migrations mixing schema and data without chunking on big tables.
- `->change()` on L10 without `doctrine/dbal` (L10 needs it; L11+ does not).

### Model-level guarantees
- Unique business keys (employee number per company, invoice number per year) without a DB unique index (link D7 races).
- Missing `SoftDeletes` where the code queries `deleted_at`, or `withTrashed` on models without SoftDeletes.
- Polymorphic `morphTo` without a `Relation::enforceMorphMap` / `morphMap`, so class names are stored in the DB and renames break the data. Medium, upgrade-blocker style.

## Version notes
- L10: `->change()` requires doctrine/dbal. `$casts` property only.
- L11+: native column modification. Remember that `->change()` must restate all modifiers (otherwise `nullable`/`default` are dropped). This is a common bug in L11+ migrations.

## Validation rules
1. Read every migration touching the table (alters included). `schema-map.cjs` warnings mean "read that file yourself".
2. A missing FK is not a finding when the project documents "no FKs" or the parent is never deleted (no delete route or action anywhere).
3. Nullability drift needs all three layers cited (migration line, cast or code line, validation line).
4. Enum drift needs every value-set location listed and the concrete value that breaks.
5. Migration-hygiene findings on migrations already run in prod everywhere (old and released) → observation, unless the rollback path is in active use.

## Idiomatic fixes
New migrations only (never edit released ones) · `foreignId()->constrained()->cascadeOnDelete()` · `->unique([...])` composite · backed enums as the single source plus `Rule::enum()` validation · `bigIncrements` · `decimal(12,2)` or integer Rappen · `Relation::enforceMorphMap` · reversible `down()`.
