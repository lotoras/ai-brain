# D5 (Vue): Framework conformance

## When to use
Every subsystem with `.vue` files or Vue entry code. For `vue@2` targets, use only the **Legacy Vue 2** section.

## Core discipline
Same bar as the Laravel half: the finding needs a **concrete consequence**, such as a runtime warning or bug, state that desyncs, a type hole that hides bugs, an untestable component, or an upgrade blocker. Mixed styles that work are an observation, unless they block typing or composition.

## Pattern catalog

### Props and emits
- **Prop mutation**: `props.x = …`, `props.list.push(…)`, `v-model="props.x"`, or `v-model` on a prop inside the child. The consequence is a Vue warning (for primitives), silent parent-state mutation (for objects), and desync. Fix: `emit('update:x')` / `defineModel()` (3.4+) / a local copy.
- **Undeclared emits**: `emit('save')` / `$emit('save')` without a `defineEmits`/`emits:` entry. The consequence is that the listener falls through as a native attribute, it fires twice on the root element for native event names (`click`, `change`), and the API is undocumented.
- **Untyped props in TS projects**: `defineProps(['a','b'])` or `props: { a: Object }` in a project that uses `lang="ts"` elsewhere. The consequence is that type checking does not cover the props. Fix: `defineProps<{…}>()` with `withDefaults` or 3.5 destructure defaults.
- Object/array prop defaults that are not factories (Options API `default: []`) share state across instances. That is a bug.

### API style
- `<script setup>` is the target style. Options API components are **not** findings by themselves. A finding exists when a file mixes `setup()` and Options state that touch the same data (`data()` + `setup()` returning refs with the same concerns) or when `this` is used inside `<script setup>`. The consequence is confusing reactivity and typing.
- Logic copied between components (fetch + loading + error, form state, pagination) → a composable (link D4).
- `getCurrentInstance()` / `instance.proxy` hacks to reach globals → provide/inject or a composable.

### State
- Module-level mutable singletons (`export const state = reactive({...})` imported everywhere, `window.appState`) used as a global store in apps that already have Pinia, or that are large enough to need devtools, SSR safety, or reset. The consequence: no devtools, no reset between tests, cross-request leakage in SSR. With Inertia, server state should come from props, not duplicated stores.
- A Pinia store whose state duplicates Inertia page props (it gets stale after navigation).
- Direct `store.$state = …` mutation outside actions, in projects that use actions elsewhere.

### Template correctness
- `v-if` + `v-for` on the same element (link D3). In Vue 3 `v-if` cannot see the `v-for` variable, so this is often a **bug**.
- `v-html` with user or model data (tag `security-adjacent`, link D12).
- Reaching into children with `$refs` for state instead of props and events. It is a finding when it causes ordering bugs.
- `key` on `<template v-for>` placed on the children instead of the template (a Vue 3 change).

### Vue 2 leftovers in Vue 3 code
- `$listeners` (removed: merged into `$attrs`), `.sync` modifier (removed: `v-model:prop`), filters `{{ x | currency }}` (removed), `$on/$off/$once` (removed: event bus breaks, use mitt or provide/inject), `Vue.set/Vue.delete`, `this.$children`, `functional: true` templates, `beforeDestroy/destroyed` (renamed to `beforeUnmount/unmounted`, still aliased in compat builds only), `model:` option.
- These are confirmed **bugs** in a Vue 3 build without `@vue/compat`. Check for `@vue/compat` in package.json and the alias in the bundler config first.

### Inertia-specific
- `<a href>` for internal navigation instead of `<Link>` gives a full page reload and loses state.
- `axios` posts for form submissions that should be `useForm` (Inertia), losing validation error binding. It is a finding only when errors are handled manually and inconsistently.
- `router.visit` with `preserveState` misuse that causes stale props. Report it only with evidence.

## Legacy Vue 2
For `vue@^2` targets, emit **one** finding, `D5:vue2-eol:<repo>`. Its title is "Vue 2 is EOL (Dec 2023); migration to Vue 3 needed". Include the inventory: the number of `.vue` files, the counts of Vue 2-only APIs (`$listeners`, `.sync`, filters, `$on`, `Vue.set`, mixins, `functional`), the vue-router/vuex versions, the build tool (Mix/webpack/vue-cli), and the blockers (UI libraries without Vue 3 versions: check package.json). Impact is high (security patches have ended, and the ecosystem is moving on). Likelihood is high. Effort is L. Do not hunt deep Vue rules in Vue 2 code.

## Version notes
- Vue 3.3+: `defineOptions`, generic components, `defineSlots`. 3.4: `defineModel` stable, `v-bind` same-name shorthand. 3.5: reactive props destructure, `useTemplateRef`, `useId`.
- Check `vue` in the lockfile before you recommend these.

## Validation rules
1. A prop-mutation finding needs the assignment or mutation site in the child **and** confirmation that the value is a prop (not a local copy).
2. An undeclared emit needs a search of the whole SFC, including the Options API `emits:` and the `defineEmits` type literal.
3. A Vue 2 leftover needs confirmation that `@vue/compat` is not configured.
4. An untyped-props finding requires the project to use TS elsewhere (≥30% `lang="ts"` or a `tsconfig` with `vue-tsc` present). Otherwise it is an observation.
5. A style-only mix (Options API in an otherwise `<script setup>` codebase, without shared-concern mixing) → observation.

## Idiomatic fixes
`defineProps<T>()` + `withDefaults` · `defineEmits<{…}>()` · `defineModel()` · composables · Pinia setup stores · `v-model:prop` · mitt or provide/inject in place of `$on` · `<Link>` and `useForm` (Inertia) · a computed filter in place of `v-if`+`v-for`.
