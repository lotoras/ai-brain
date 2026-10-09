# Anti-defaults

The patterns that make a generated site look generated, each paired with what to do instead.
A bare ban leaves a gap that the next default fills, so never state a ban without its
replacement.

The numeric caps and the direction traits below are proposed defaults synthesised from
research, not published figures. Treat them as knobs: tune them after the first real run.

## The three priority overrides

These three always go into the output, in this order.

1. **Too many sections and items.** Instead: apply the numeric caps below as hard limits. When
   unsure whether a section or item earns its place, remove one.
2. **A title on everything.** Instead: a heading only where it helps someone navigate. At most
   one eyebrow label per page, and only if it carries real information (a date, a category, a
   location). Never stack eyebrow + heading + subheading; pick the one line that says it.
3. **A dot or icon with text beside it, and three-column icon feature grids.** Instead: show one
   or two features large with real content (screenshot, photo, diagram), or use an asymmetric
   text-beside-media split, or set a plain typographic list, table or definition list with no
   markers.

## Secondary tells

| Instead of | Do |
|---|---|
| Identical rounded cards with soft shadows | One card style, used only for genuinely separable objects; group everything else with whitespace and a 1px rule |
| Purple or indigo gradients, glows, glassmorphism | Flat solid fills from the palette; depth from a border or the single shadow |
| Centred hero with two buttons | Left-aligned hero with one primary action; a second action becomes a text link |
| Stat rows of big number + small label | The number inside a sentence that says what it means, or no number |
| Badge pills | Plain text in the muted colour, or nothing |
| Emoji as icons | Words |
| 01/02/03 markers on things that are not a sequence | Numbers only on real ordered steps |
| One accented word in a headline | The whole headline in one colour and one weight; emphasis comes from the wording |
| ALL-CAPS labels | Sentence case at body size, set apart by weight or the muted colour |
| Arrows on buttons | A verb label and nothing else |
| Fade-and-slide-up on every section | One orchestrated load sequence; sections below it are static |

## Numeric caps

Defaults, scaled by the Content volume answer (sparse / medium / dense).

| Cap | Sparse | Medium | Dense |
|---|---|---|---|
| Sections on the home page | 4 | 5 | 6 |
| Items per group (unless the content is inherently a list) | 3 | 3 | 3 |
| Share of sections that carry a heading | 60% | 60% | 60% |
| Words per text block | 60 | 60 | 60 |

Fixed at every volume:

- 1 accent colour, 2 typefaces, 2 radii, 1 shadow, 1 card style, 0 gradients.
- 45–75 characters per line.
- 0 decorative icons; functional UI icons only (menu, close, search, external link).
- One orchestrated load animation; otherwise motion only in response to user action.

## Foundation defaults

Use these wherever the interview and the style direction leave a value open.

- Type scale ratio 1.2–1.25; 1.333 for Editorial.
- Body 16–18px at line-height 1.5–1.6.
- Spacing on a 4px or 8px base; every gap is a multiple of it.
- Section padding 96–160px on desktop, 56–80px on mobile.
- One radius chosen once in the 0–8px range; a second only for a clearly different object size.
- Borders before shadows: reach for a 1px rule first, the single shadow only for overlays.
- Left-aligned by default; centre only short, standalone lines.

## Style directions

One line each: type, colour, layout, shape. The interview offers the first four as options;
Brutalist and Luxury arrive through "Other".

- **Editorial** — a text serif for headings and long-form body or a quiet sans beside it, scale
  ratio 1.333; paper-toned neutrals with one ink-like accent; a narrow reading column with wide
  margins and asymmetric media; 0–2px radius, hairline rules.
- **Swiss-minimal** — one grotesque sans in two weights; white or near-white with black text
  and one saturated accent used sparingly; a strict column grid, flush-left, generous whitespace;
  0px radius, no shadow.
- **Warm-organic** — a humanist sans or soft serif; muted earth or plant tones at low saturation
  with warm neutrals; relaxed grid, large photography, uneven splits; 6–8px radius, no hard
  borders.
- **Technical-mono** — a monospace for headings, labels and data with a plain sans for body;
  a cool neutral ramp with one signal colour; dense rows, tables and visible grid lines;
  0–2px radius, 1px borders everywhere, no shadow.
- **Brutalist** — a heavy grotesque or a system font at extreme sizes; black, white and one raw
  primary colour at full saturation; exposed structure, thick rules, deliberate collisions;
  0px radius, 2–4px borders.
- **Luxury** — a high-contrast display serif at large sizes with a light sans for body; a deep
  neutral or a pale stone with one restrained metallic or jewel accent; few elements, very large
  margins, full-bleed imagery; 0px radius, no borders, no shadow.
