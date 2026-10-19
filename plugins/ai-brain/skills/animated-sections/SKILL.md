---
name: animated-sections
description: Use when the user wants an animated banner, hero or section — motion background, marquee, text effect, scroll animation, "make this section move". Routes to code (free component registries, ported), video (stop-animation / media-gen) or Lottie, and suggests 3 fitting candidates first. Not for static images or charts.
argument-hint: [what should move — e.g. animate the hero of my studio site]
---

# animated-sections — pick, port and verify animated banners and sections

Suggest three fitting motion candidates that match the site's style direction, then build the chosen one
in the project's own stack and tokens. This skill orchestrates; video generation is delegated.

Colocated files, relative to this skill's base directory:

- `references/sources.md` — each free source: register/install command, cost, stack requirement, fallback access.
- `references/fit-map.md` — style direction → fitting and avoided effects, plus the Motion-level rules.

## Step 0 — Read the design context

Look for `DESIGN.md` in this order: `./DESIGN.md`, `project/DESIGN.md`, `design-systems/<name>/DESIGN.md`.
Take the style direction, palette, fonts and **Motion** level (`none | subtle | expressive`). If no DESIGN.md
exists, infer direction and palette from the page itself and say so in one line. Motion `none` means
static only: offer nothing ambient.

## Step 1 — Classify the request

| Request shape | Route |
|---|---|
| Ambient or UI motion: aurora, gradient, beams, particles, marquee, text reveal or split-text, spotlight, grid, card hover/tilt | CODE: registries via the shadcn MCP or Magic UI MCP, ported |
| Scroll-driven UI: pinned or sticky sections, parallax, scrubbed reveals, horizontal scroll, counters | CODE: GSAP ScrollTrigger (CDN), or CSS `animation-timeline` with a fallback |
| A photoreal or physical OBJECT transforming (opening, unfolding, morphing, material or liquid, product reveal) on scroll, loop or hover | VIDEO: hand off to `ai-brain:stop-animation` (3 stills → OpenRouter video → frames → canvas). Stop here. |
| A cinematic hero background loop (scene, footage-like, atmosphere) | VIDEO: `ai-brain:media-gen` video route (OpenRouter, cost gate). Embed `<video autoplay muted loop playsinline poster>` with a reduced-motion poster. |
| A vector illustration, mascot or animated icon | LOTTIE: LottieFiles MCP plus `<dotlottie-wc>`, or `@lucide-animated` etc. |

Rule of thumb: if it depicts a real thing changing, use video. If it's typographic, geometric, abstract or UI, use code.

**Video routes: invoke the named skill and STOP.** `stop-animation` and `media-gen` own their own
approval and cost gates; never generate paid video from here.

## Step 2 — Suggest exactly 3 candidates

1. Filter by `references/fit-map.md` for the style direction, and by the Motion level.
2. Find candidates with the MCP tools: shadcn MCP (search / view across registries), Magic UI MCP,
   LottieFiles MCP (`schema_search` first to find the public-animation query; never hardcode it).
3. MCP not connected? Fall back to the CLI (no key, no `components.json` needed):
   `npx -y shadcn@latest search @<ns> -q "<term>"` and `npx -y shadcn@latest view @<ns>/<item>`,
   or curl the registry item URL (patterns in `references/sources.md`).
4. Ask **one AskUserQuestion round**: 3 options, each = effect name + source item (e.g. `@magicui/marquee`)
   + why it fits the direction + weight/perf note (deps, JS size, WebGL or not).

MCP tools missing: the ai-brain setup script registers them; to do it by hand, use the commands in `references/sources.md`.

## Step 3 — Fetch and adapt

- **Bundler + shadcn project** (has `components.json`, React, Tailwind): `npx shadcn add @ns/item`, then retoken.
- **Static / no-build page** (plain HTML, `.dc.html`): port to vanilla CSS/JS. Never in-page React, never the
  Tailwind Play CDN. Strip React/motion/Tailwind idioms; keep the keyframes, math and structure.
- Libraries only from a CDN with pinned versions: GSAP `3.15.0` (`gsap.min.js`, `ScrollTrigger.min.js` from
  `cdn.jsdelivr.net/npm/gsap@3.15.0/dist/`), `dotlottie-wc@0.10.0` for Lottie. Exact snippets in `references/sources.md`.
- Replace the demo palette and fonts with DESIGN.md tokens (CSS variables). Never keep a component's demo colors.
- Prefer registry variants without Tailwind (e.g. `@react-bits/*-JS-CSS`) as porting sources.

## Step 4 — Guardrails (checklist, every code route)

- [ ] At most one ambient (looping) motion per viewport; scroll-driven motion counts as user-driven.
- [ ] Animate `transform`, `opacity` and `filter` only, and reserve the section height (no layout shift).
- [ ] `prefers-reduced-motion: reduce` gives a static end state (no JS animation).
- [ ] Loops pause offscreen (IntersectionObserver) and when `document.hidden`.
- [ ] Added JS about 60 KB gz or less unless the user approves (GSAP core + ScrollTrigger is about 45 KB gz).
- [ ] Colors and fonts come only from DESIGN.md tokens.
- [ ] CSS `animation-timeline` only for simple effects, behind `@supports`, with a GSAP/IntersectionObserver fallback.

## Step 5 — Verify

With claude-in-chrome (serial browser work):

1. Screenshots at 1440 and 390 widths.
2. Console clean, no failed CDN requests.
3. Emulate `prefers-reduced-motion: reduce`: the static end state shows, nothing animates.
4. Scroll the section out of view: loops pause (no running animation offscreen).

Report the source item used, what was ported, JS weight added, and anything not verified.

## Project overlays

If the project ships its own `animated-sections` skill or CLAUDE.md rules for page format, asset paths
or preview URLs, follow those for the build; this skill still supplies routing, sources and fit-map.

## Siblings

- `ai-brain:stop-animation` — object transformations as scroll/loop/hover frame sequences.
- `ai-brain:media-gen` — images, icons (Codex reroute), and video (OpenRouter) assets.
- `ai-brain:site-style` — DESIGN.md: palette, fonts, direction, Motion level.
- `frontend-design:frontend-design` — new UI and aesthetic direction.
