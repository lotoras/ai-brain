# Fit map — style direction → motion

The six directions come from `site-style/references/anti-defaults.md`. Read the direction from DESIGN.md.
Registry examples are starting points; search for the nearest equivalent.

| Direction | Fitting effects (example items) | Avoid |
|---|---|---|
| **Editorial** | Split-text or line reveal on headings (`@react-bits/SplitText-JS-CSS`), image parallax, slow crossfades | Particles, neon, beams |
| **Swiss-minimal** | Text reveal, marquee of type (`@magicui/marquee`), grid-line draw-in, number counters | Aurora, glow, blobs |
| **Warm-organic** | Soft gradient blobs, grain, gentle float, Lottie illustrations | Beams, glitch, hard cuts |
| **Technical-mono** | Border beams (`@magicui/border-beam`), dot or retro grid (`@magicui/retro-grid`), typed or scramble text (`@magicui/hyper-text`), terminal cursor | Soft blobs, serif flourish |
| **Brutalist** | Hard marquee, abrupt cuts, oversized type scroll, cursor-follow | Glassmorphism, soft glow |
| **Luxury** | Slow fades, light sweep or shimmer on type (`@magicui/shimmer`-style), subtle parallax, Ken Burns on imagery | Bouncy springs, particles, many moving parts |

## Motion level (DESIGN.md "Motion: none | subtle | expressive")

- **none** — static only. Offer nothing ambient; at most a state change on user action.
- **subtle** — one effect, no loop faster than 6 s. Slow fades, a single marquee, gentle parallax.
- **expressive** — one ambient effect plus scroll choreography (pinned sections, scrubbed reveals).

Always one ambient loop per viewport. If the direction and the Motion level disagree, the lower level wins; say so in the question.
