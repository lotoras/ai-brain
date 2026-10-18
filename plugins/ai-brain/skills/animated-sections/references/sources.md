# Free motion sources (verified 2026-10-18)

All free, no API key unless noted. React sources are a **catalog to port**, not drop-in code, for static pages.
URLs and pins below are pre-verified; fetch item URLs only when the MCP and CLI paths fail.
On Windows, register the two stdio servers from PowerShell with `-- cmd /c npx -y …` (Git Bash rewrites `/c`).

## shadcn CLI + MCP (the hub)
- **Register:** `claude mcp add --scope user shadcn -- npx -y shadcn@latest mcp` (stdio). Tools: search, list, view, examples across registries.
- **Cost:** free, no key. CLI 4.22.0 resolves namespaced registries from its built-in index (`https://ui.shadcn.com/r/registries.json`); no `components.json` needed to search or view.
- **Good for:** every code-route effect below. **Stack:** React + Tailwind (+ motion) with a bundler for `npx shadcn add`; otherwise port.
- **Fallback (no MCP):** `npx -y shadcn@latest search @magicui -q "hero"`, `npx -y shadcn@latest view @react-bits/SplitText-JS-CSS` (prints item JSON with `files[].content` and `dependencies`), or curl the item URL.
- **Registries and item URL patterns:**
  - `@magicui` `https://magicui.design/r/{name}` — marquee, aurora-text, particles, retro-grid, shimmer, hyper-text, border-beam
  - `@aceternity` `https://ui.aceternity.com/registry/{name}.json` — spotlight, beams, aurora background, lamp, sparkles
  - `@react-bits` `https://reactbits.dev/r/{name}.json` — text effects and backgrounds; prefer `*-JS-CSS` (no Tailwind); many use GSAP or WebGL
  - `@animate-ui` `https://animate-ui.com/r/{name}.json`
  - `@motion-primitives` `https://motion-primitives.com/c/{name}.json`
  - `@eldoraui` `https://eldoraui.site/r/{name}.json`, `@cult-ui` `https://cult-ui.com/r/{name}.json`, `@kokonutui` `https://kokonutui.com/r/{name}.json`, `@smoothui` `https://smoothui.dev/r/{name}.json`
  - Animated icon sets: `@lucide-animated`, `@heroicons-animated`, `@animateicons`

## Magic UI MCP
- **Register:** `claude mcp add --scope user magicui -- npx -y @magicuidesign/mcp@latest` (npm `@magicuidesign/mcp` v2.0.0, stdio).
- **Cost:** free, MIT. **Good for:** marquee, aurora text, particles, grids, beams, shimmer. **Stack:** React + Tailwind + motion.
- **Fallback:** curl `https://magicui.design/r/{name}` or the shadcn CLI with `@magicui`.

## LottieFiles MCP
- **Register:** `claude mcp add --scope user --transport http lottiefiles https://mcp.lottiefiles.com/mcp`, then `/mcp` → lottiefiles → sign in (browser OAuth).
- **Cost:** free account. Tools: `operations_list`, `schema_search`, `schema_details`, `graphql_execute` (GraphQL). Find the public-animation search query via `schema_search` at runtime; don't hardcode it.
- **Good for:** vector illustrations, mascots, animated icons. **Stack:** none; runs from a CDN, no porting.
- **Playback (URL verified 200):**
  ```html
  <script type="module" src="https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-wc@0.10.0/+esm"></script>
  <dotlottie-wc src="https://.../animation.lottie" autoplay loop></dotlottie-wc>
  ```
  If `+esm` ever fails, use `https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-wc@0.10.0/dist/dotlottie-wc.js` (also 200).
- **Fallback (no MCP):** browse lottiefiles.com and use a `.lottie` / JSON file URL; or `@lucide-animated` icons via shadcn.

## GSAP 3.15.0 (scroll engine)
- **Install:** CDN only, pinned:
  `https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js` and `.../dist/ScrollTrigger.min.js` (200 verified).
- **Cost:** free, including ScrollTrigger and SplitText. No MCP.
- **Good for:** pinned/sticky sections, parallax, scrubbed reveals, horizontal scroll, counters, split-text. **Stack:** none. About 45 KB gz for core + ScrollTrigger.
- **Fallback:** IntersectionObserver + CSS transitions for simple reveals.

## CSS scroll-driven animations
- `animation-timeline: scroll()` / `view()`: Chromium 115+, Safari 26; Firefox uncertain.
- **Good for:** simple parallax/progress/reveal with zero JS. **Stack:** none.
- **Rule:** wrap in `@supports (animation-timeline: view())`, with a GSAP or IntersectionObserver fallback.

## Excluded
21st.dev Magic MCP is deliberately excluded: it needs an API key and its free limits are unclear.
