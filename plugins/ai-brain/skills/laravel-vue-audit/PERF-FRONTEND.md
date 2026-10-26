# D3: Frontend performance

## When to use
Subsystems with Vue pages or components (Inertia pages, SPA views, Blade-mounted islands) and the frontend entry/bundler config.

## Core discipline
A frontend perf finding names **what the user pays**: bytes shipped on first load, work per keystroke or render, or memory and listeners that accumulate across navigations. Support it with a trace (entry → import chain, or component → reactive source → re-render) and a scale (bundle share if `public/build/manifest.json`/`mix-manifest.json` shows it, list sizes, navigation frequency). Micro-optimisations on 10-item lists are not findings.

## Pattern catalog

### Eager page bundles
- Inertia: `resolve: name => { const pages = import.meta.glob('./Pages/**/*.vue', { eager: true }) … }` puts every page into the entry chunk. Fix: a non-eager glob (`import.meta.glob('./Pages/**/*.vue')` + `resolvePageComponent` from laravel-vite-plugin).
- SPA: routes with `component: SomePage` (static import) instead of `() => import('./SomePage.vue')`.
- Mix (cms): `require('./components/X.vue').default` registered globally for every island. Fix: `defineAsyncComponent(() => import(/* webpackChunkName */ …))` for islands that are rarely present.
- Evidence: check `public/build/manifest.json` (Vite) for the entry chunk size if it is built, or count the pages.

### Heavy dependencies
- `moment` (+ locales) → `dayjs`/`date-fns`/`Intl`. `import _ from 'lodash'` or `import { x } from 'lodash'` (CJS, not tree-shaken) → `lodash-es` per-function or native. Full icon packs imported as an object. `chart.js/auto` where a few controllers would do. A PDF/Excel library imported at top level on a page that uses it in one click handler → dynamic `import()` inside the handler.
- Validation: confirm the import is in a shipped path (not a dev tool or test), and that the dependency is not already split into a lazy chunk.

### Reactivity cost
- `ref`/`reactive` around large, read-only data (big arrays of rows, chart datasets, GeoJSON, API payloads replaced as a whole) → `shallowRef` / `markRaw`. Deep proxies cost memory and make watchers slow.
- `watch(source, cb, { deep: true })` on large objects, or `watch` on whole `props` → watch the specific getter. Vue 3.5: `deep: <number>` limits the depth.
- Expensive computations in templates or methods called from templates (`{{ format(items.filter(...)) }}`) that run on every render → `computed`.
- `computed` that returns new objects every time and feeds a child prop → the child re-renders constantly.

### List rendering
- `v-if` together with `v-for` on the same element (in Vue 3 `v-if` runs first, so this is often a bug; also wasteful) → a `computed` filtered list or a `<template v-for>` wrapper.
- A missing `:key` or `:key="index"` on lists that reorder, insert, or delete gives state bleed and full re-patches. A stable id key is required where items carry local state (inputs, toggles).
- Large lists (≥ several hundred rows) rendered fully without pagination or virtualization.

### Leaks
- `addEventListener` (window/document), `setInterval`, `setTimeout` loops, `ResizeObserver`/`IntersectionObserver`, Echo/Pusher channel subscriptions, third-party instances (chart, map, editor) created in `onMounted` with no teardown in `onUnmounted`/`onBeforeUnmount`. With Inertia/SPA navigation these accumulate on every visit.
- Counter-evidence: `useEventListener`/`useIntervalFn` (VueUse) auto-clean. Persistent layouts may intentionally keep listeners.

### Network patterns
- Request waterfalls on mount (sequential `await axios` that could be `Promise.all`), refetching on every keystroke without debounce, polling without backoff or stop on unmount.
- Inertia: `router.reload()` without `only:`, which re-fetches all props, including heavy ones.

## Version notes
- Vue 3.5: `useTemplateRef`, reactive props destructure (`const { foo } = defineProps()` stays reactive), `deep: number`, and `onWatcherCleanup`. Do not suggest these on <3.5.
- Mix vs Vite: `import.meta.glob` is Vite-only. Mix code splits via dynamic `import()` with `webpackChunkName`.
- Inertia 2 has `<Deferred>`, `<WhenVisible>`, prefetching (`<Link prefetch>`), and polling (`usePoll`). Check `@inertiajs/vue3` in the lockfile.

## Validation rules
1. An eager-bundle finding needs proof that it ships on first load (eager glob or static import in the entry graph). Lazy chunks are not findings.
2. A reactivity finding needs size evidence (the data source returns hundreds or more items, or is a known large structure). Small refs are not findings.
3. A leak needs the creation site **and** the absence of teardown in that component and its composables. Check for VueUse helpers and `effectScope`.
4. `v-if`+`v-for`: confirm they are on the same element. The `<template>` wrapper pattern is fine.
5. A `:key="index"` finding needs the list to mutate order or contents **and** the items to have state or be components. Static display-only lists → observation.

## Idiomatic fixes
A lazy `import.meta.glob` + `resolvePageComponent` · `() => import()` routes · `defineAsyncComponent` · `shallowRef`/`markRaw` · narrow `watch` getters · `computed` filtered lists · stable `:key` · `onBeforeUnmount` cleanup or VueUse `useEventListener` · `Promise.all` · Inertia `only:` + `Inertia::defer` (pairs with PERF-BACKEND).
