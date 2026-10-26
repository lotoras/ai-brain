# D11: Type safety and test gaps · D12: Accessibility and i18n (light)

## When to use
D11: once per app, plus per critical subsystem (money, payroll, auth, policies, numbering). D12: per subsystem with UI.

## Core discipline
**D11 gaps are risks, not defects.** A missing test is not a bug. It goes into the REPORT "Risk register" through ledger `observations` and `checks`. Only a **concrete type defect** becomes a finding: a larastan or vue-tsc error that the hunter confirms is a real bug, such as calling a method on a possibly-null value on a reachable path, a wrong argument type that coerces silently, or a prop type mismatch that renders wrong. **D12 is light:** report clear, user-facing failures. A full WCAG audit is out of scope.

## D11 catalog

### Static analysis posture (risk register)
- larastan installed? Which level (`phpstan.neon` `level:`)? What do `paths`/`excludePaths`/`ignoreErrors` hide (e.g. a blanket ignore of `Call to an undefined method Builder`, which hides exactly the D6 class of bugs)? Is a baseline file present, and how large is it?
- TS: `lang="ts"` share, `tsconfig` strictness (`strict`, `noImplicitAny`), whether `vue-tsc` is installed, and whether a type-check script is in package.json.
- Recommendations go in the register as a ladder ("raise larastan to level 5 for app/Services/Payroll first").

### Type defects (findings)
- larastan or vue-tsc errors from the tool pass that a hunter traced to a reachable wrong behavior, for example `Cannot call method format() on Carbon|null` where the column is nullable (link D8), or a wrong enum or string comparison that is always false.
- PHP: missing return types on public service and Action methods are **not** findings. A `mixed` return that callers treat as a model and that is sometimes an array **is**, with the call path.

### Test gaps (risk register)
- Map the critical paths (policies, money calculations, payroll finalize, invoice numbering, auth flows, imports) to existing tests (`tests/Feature/**`, `tests/Unit/**`, grep the class or route names).
- Record the critical paths with **no** test. Order them by D7 risk. A gap on a path that **also** has a D7 finding is called out next to that finding.
- Test hygiene that hides defects: tests that hit the dev DB (no `RefreshDatabase`/`DatabaseTransactions`, and `phpunit.xml` does not set a test DB). This one is a finding (D11, impact medium): running tests can destroy dev data, and it blocks safe verification.

## D12 catalog

### Accessibility (light)
- Form inputs without an associated label (`<input>` without `id`+`<label for>`, wrapping `<label>`, or `aria-label`). Icon-only buttons without accessible names. `<div @click>`/`<span @click>` as buttons without `role`, `tabindex`, and key handlers (keyboard users can't trigger them). `<img>` without `alt` (cms public pages: SEO plus a11y). Modals without focus trap or Esc handling, when the project has a modal component (fix it once there, link D4).
- Prioritise public-facing pages (cms customer sites) and frequently used forms.

### i18n (light)
- The project uses translations (`lang/` with ≥2 locales, `__()`/`$t()` widespread), but some UI strings are hardcoded in Vue templates or Blade (count per subsystem). The consequence is a mixed-language UI for non-default locales.
- Missing keys per locale (from D6 integrity). Locale-unaware formatting: `toFixed(2)` for CHF in the UI instead of `Intl.NumberFormat('de-CH', …)`, and dates formatted with hardcoded patterns where the app supports several locales.
- Single-locale apps → skip i18n (mark the unit `not_applicable` with the reason).

## Validation rules
1. A D11 finding must be a demonstrated wrong behavior on a reachable path. Posture and gap items never become findings (except the dev-DB test hygiene item).
2. A D12 label finding: check for wrapping labels, `aria-labelledby`, and component libraries that render labels internally (inspect the component source).
3. Hardcoded string counts must exclude developer-only screens and debug output. Report one finding per subsystem with a count and examples, never one per string.
4. Clickable-div findings need the absence of a keyboard handler **and** of `role="button"`.

## Idiomatic fixes
Raise larastan by level per path · a `phpstan-baseline.neon` to stop regressions · `vue-tsc --noEmit` in CI · `RefreshDatabase` + a sqlite test DB in phpunit.xml · `<label for>` / `aria-label` · `<button type="button">` in place of clickable divs · translation keys via `__()`/`$t()` · `Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' })`.
