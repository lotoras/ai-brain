# Validation, output, and reporting

### Phase 3: A fresh verifier per candidate

Give every unique candidate fingerprint (and every carried prior record) to a **fresh** agent that did not hunt it: `Explore` for source-only checks, or `general-purpose` if a bounded local check is warranted (deep profile only, under the SKILL.md execution rules). It receives the candidate, the linked ledger checks, the relevant architecture facts, **the companion's `Validation rules` section verbatim**, the three schema branches verbatim, and the prior records with the same fingerprint. It never receives another verifier's conclusion.

#### Verifier prompt (include verbatim)

```text
You did not write this candidate. Try to REFUTE it from repository source. Read-only: do not
edit, create, or delete files in the target.

1. Open every cited file:line. Fix wrong line numbers; reject if the code is not there.
2. Hunt for the counter-evidence the companion's Validation rules list (eager loads, $with,
   later index migrations, trait/parent methods, macros, caching, Inertia defer, project
   conventions). One real counter-control → rejected.
3. Check the version notes: is the "idiomatic fix" valid for this Laravel/Inertia/Vue version?
4. Re-derive the consequence yourself. If you cannot state concretely what goes wrong, reject
   or downgrade. Pure style → rejected with reason "style; observation only".
5. Check likelihood against real callers (hot path vs admin one-off) and impact against the
   impact anchors. Priority must follow the matrix. Effort: S/M/L honestly, including tests.
6. D4: confirm >=2 locations really share the rule, the extraction target fits the codebase,
   and the divergence verdict is right (diff the copies).
7. If a decisive fact is not source-visible, use needs_validation with exact blockers.
8. Keep the fingerprint unless you found a genuinely different root cause.

Return exactly one JSON object, no prose:
{"decision": "confirmed|needs_validation|rejected", "record": { … }}
The record matches that verdict's schema branch, omits `id`, and replaces the hunter's wording.
```

**Batching (cost control).** A verifier may take a batch of up to 5 candidates from the **same dimension**, deciding and returning each one separately: `{"decisions":[{"decision":…,"record":{…}}, …]}`, written to `<scratch>/decision.json`. Independence still holds: no verifier receives a candidate it hunted, and it never sees another verifier's decision. On PlanMe, 40 candidates fit in 8 verifiers instead of 40.

**Negative control (recommended when verifiers reject nothing).** Zero rejections can mean good hunters or rubber-stamp verifiers. Give one fresh verifier 2–3 *planted* false positives in a confident tone, built from FPs the hunters already dismissed (an alias plucked as a column, a Collection `where()`, an N+1 on an eager-loaded list). Use the same prompt and an agent dir **not** prefixed `v-` (for example `agents/negative-control/`), so `assemble-findings.cjs` never picks it up. Report the result in coverage notes. On PlanMe run-1: 3/3 rejected with correct counter-evidence.

A `quick` verifier also performs the Phase 5 record checks in the same pass. The parent discards a malformed result without repairing it and re-runs it with a fresh verifier if the budget allows. Otherwise the candidate stays unvalidated in the ledger and the run is `incomplete` (`validation_budget_exhausted`). Unvalidated candidates never enter `findings.json`.

### Phase 4: `findings.json`

The parent writes a JSON array sorted by `fingerprint` and assigns `id`s: carried priors keep their `id`, and new records take the next `LVA-NNN` after the highest ever used for this repo. `rejected` records get ids too, so a future "fix LVA-x" can't collide.

Branches (the authority is `report-schema.json`; read it before writing):

- `confirmed` contains `id, fingerprint, verdict, dimension, category, tags, title, description, root_cause, consequence, locations, evidence, impact, likelihood, priority, effort, confidence, remediation`. It adds `scale` (D2/D3), `extraction_target` and `divergence` (D4), and an optional `local_check` (deep profile).
- `needs_validation` contains `id, fingerprint, verdict, dimension, category, tags, title, description, claimed_root_cause, locations, evidence, blockers, validation_plan{local?, owner?}`. It has no impact, priority, or effort.
- `rejected` contains `id, fingerprint, verdict, dimension, category, tags, title, description, claimed_root_cause, locations, evidence, reason`.

Parent helpers (deterministic, so the parent copies no JSON by hand):

```sh
node <skill>/tools/consolidate.cjs <output> [--alias OLD_FP=NEW_FP]    # hunters' result.json → candidates.json (+ duplicate hints)
node <skill>/tools/assemble-findings.cjs <output> [--prior <prev>/findings.json]   # verifiers' decision.json → findings.json + ledger
node <skill>/tools/apply-phase5.cjs <output>                           # p5-* decision.json → findings.json (material replacements held in phase5-material.json)
node <skill>/tools/render-report.cjs <output>                          # findings + ledger + report-notes.json → the 3 reports
```

Then validate:

```sh
node <skill>/validate-findings.cjs <output>/findings.json
node <skill>/validate-coverage-ledger.cjs <output>/coverage-ledger.json --findings <output>/findings.json
```

The `--findings` flag cross-checks that every ledger fingerprint has exactly one record and that every record is linked from some unit. Fix all errors before you continue. Passing proves format and consistency only.

### Phase 5: Final record verification (standard/deep)

Run one fresh `Explore` agent per `confirmed` and `needs_validation` record, in parallel, against the **final record**. For confirmed records it checks the locations, the consequence, the counter-evidence, the version-validity of the fix, the matrix priority, and the effort. For needs_validation it checks that the blocker is real, the plan is exact and non-destructive, and the issue is not answerable from source after all. It returns `{"decision":"verified","fingerprint":"…"}` or `{"decision":"replace","reason":"…","record":{…}}`.

A replacement that changes the verdict, the root cause, the impact, or the priority goes to **another** fresh verifier before it is applied. `apply-phase5.cjs` enforces this: it applies wording or line fixes directly, writes material changes to `phase5-material.json`, and applies those only via `--accept-material <file>` after the re-verification. Phase 5 agents live in `agents/p5-*/` (records in `records.json`, output in `decision.json`). Wording or line fixes apply directly. Re-run both validators after every change.

### Phase 6: Reports (derived from the final JSON)

#### `REPORT.md`
1. **Run header**: repo@branch, source ref plus the dirty flag, profile, scope/diff base, stack summary, tools used versus missing, prior-run use, the budget versus agents spent, and a "partial pass" statement if the run is quick, scoped, diff, or incomplete.
2. **Summary**: 3–5 sentences on health per dimension, with no fluff. Say so plainly if a dimension is clean.
3. **Findings table**, sorted by priority, then impact, then effort: `ID | P | Dim | Title | Impact | Effort | Tags`.
4. **Each confirmed finding**: locations, consequence, scale/divergence where relevant, the counter-evidence checked, the fix (idiomatic, version-correct, and cms-layer-aware), and the regression check. A `security-adjacent` finding ends with "→ run security-audit for depth."
5. **Needs validation**: a table of ID, title, blocker, and next step. No priority.
6. **Risk register (D11)**: critical paths without tests (policies, money, auth, payroll), the larastan level, and type-check availability. These are presented as risk, not defects.
7. **Observations**: style and pre-existing notes from the ledger bookkeeping and pint counts. Keep it short. These are **not findings**.
8. **Owner-run checks**: `composer audit`, `npm audit`, `composer outdated --direct`, and similar commands, plus any `needs_validation` owner plans.
9. **Coverage**: unit counts by status and dimension, deferred/out-of-scope with reasons, and the final critic result. No claim of exhaustive coverage.

#### `QUICK-WINS.md`
Confirmed P1/P2 findings with effort S first, then P1/P2 with effort M. For each: ID, one-line consequence, the exact change (file plus a short snippet), and the test to add. Close with "To fix: `fix LVA-…`" (see FIXING.md).

#### `NEEDS-VALIDATION.md`
Each `needs_validation` record gets its locations, evidence, exact blockers, local plan, and owner plan. These are leads, not defects.

Keep the report proportional to the evidence. A clean dimension is a valid result. Do not invent LOW findings to fill it.
