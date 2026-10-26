# D4: Duplication

## When to use
Every subsystem. Run it per subsystem for semantic clones and once app-wide over the tool output for literal clones across subsystems.

## Core discipline
Duplication matters when **a rule lives in several places and will change**. A finding needs: ≥2 concrete locations, the shared rule or behavior in one sentence, a named extraction target that fits this codebase's conventions, and a **divergence verdict**:
- `identical`: the copies are the same today. The cost is future drift, and the impact is usually medium at most.
- `minor`: cosmetic differences only (names, messages).
- `diverged`: the copies differ in **behavior** (one validates `max:255`, the other doesn't; one rounds and the other truncates; one filters soft-deleted rows). This is a live inconsistency and often a bug. State which copy is right if source makes it clear, and rank it higher.

Boilerplate the framework expects (resource controllers with the same CRUD shape, FormRequest `authorize(){return true;}`, migrations) is not duplication.

## Inputs
- Literal clones: `jscpd` JSON if installed, else `node <skill>/tools/dupe-scan.cjs <target> --min-tokens 70`. Each group is a candidate, so read the copies.
- Semantic clones: found by reading. The tool won't find these.

## Pattern catalog

### Query logic repeated
- The same `where(...)->where(...)` chain (e.g. "active employees of tenant X in period Y") in several controllers or services. Extraction target: a **local scope** (`scopeActiveInPeriod`) or a query object or Action.
- The same `whereHas` authorization or tenancy filter repeated → a global scope or a scope plus a policy.

### Validation repeated
- The same rules array in `store` and `update`, or in several controllers, or inline `$request->validate([...])` that duplicates a FormRequest → a **FormRequest** (shared base request or `rules()` composition). Inline validation in a controller is the anchor `\$request->validate\(|Validator::make\(` in `app/Http/Controllers`.
- Frontend and backend rules that disagree (a client `maxlength=100`, a server `max:255`) only count when the mismatch produces a user-visible failure. That is a D7 correctness finding, linked here.

### Business rules repeated
- Money, payroll, or tax calculations, status transitions, and date/period calculations (working days, holiday handling) implemented in more than one service, job, or controller → one **Action** / domain service / value object. **diverged** here is almost always P1/P2.
- The same mapping tables (status → label/color) in PHP and in several Vue components → a PHP **enum** with `label()` shared via Inertia props or a generated TS file, or one composable.

### Components built twice
- Two or more Vue components with the same purpose (modals, date pickers, search selects, tables with sorting) with diverging props or behavior → one base component with props and slots. Anchors: a similar filename (`*Modal.vue`, `*Select.vue`, `*Picker.vue`), and the same `emit` names.
- The same `axios` call plus loading/error state in many pages → a **composable** (`useFetchX`) or a service module.
- Blade (cms): the same markup across block templates → a Blade component or partial. **cms constraint:** in a customer branch, the extraction target lives in the customer layer, or the finding says "extract on master".

### Copy-pasted controllers / jobs
- Near-identical controller methods differing in model or type only → a shared Action, a trait, or a generic handler (only when ≥3 copies; for 2, prefer leaving them alone unless they have diverged).

## Version notes
- Enums with methods: PHP 8.1+ (all targets). Laravel `casts()` method: L11+. On L10, use the `$casts` property.
- Composables apply everywhere in Vue 3. In a Vue 2 target, the extraction target is mixins (and the report notes the migration first).

## Validation rules
1. At least two locations must be opened and must show the same rule. "Similar shape, different rule" → rejected.
2. Literal clones under ~10 lines, or in tests, migrations, seeders, or language files → rejected unless they have diverged behaviorally.
3. Check whether an extraction already exists (a scope, trait, composable, or base component) that some copies use and others don't. That is the strongest form: name the existing target.
4. The divergence verdict must come from an actual diff of the copies, quoted in `evidence`.
5. Impact: `diverged` business/money rule → high or critical. `diverged` validation → medium or high. `identical` → low or medium (likelihood is how often the rule changes). Effort counts every call site plus the tests.
6. 2 identical copies of trivial glue → observation, not a finding.

## Idiomatic fixes
Local and global scopes · FormRequests (with `prepareForValidation`) · Actions (`app/Actions/<Domain>/<Verb><Noun>.php`, invokable or `handle()`) · backed enums with `label()`/`color()` · API Resources · Blade components · Vue base components with slots · composables (`resources/js/Composables/useX.ts`) · a TS module for shared constants generated from the enums.
