# Pixel-art craft rules

Read this before drawing a character, creature or any asset above 16 px. It holds the rules the
drawing procedure in `SKILL.md` refers to.

## 1. Pick the canvas for the asset

The style file's canvas is a default, not a limit. Suggest a size per asset and say why.

| Asset | Suggested canvas | Why |
|---|---|---|
| Item, icon, pickup | 16–24 px | one readable shape, 2–3 tones |
| Chunky mascot, chibi character | 32 px | 2–3 heads tall, face is the focus |
| Character with real anatomy (muscles, pose, props) | 48–64 px | 3.5–5 heads, room for limbs and hands |
| Scene, large prop, portrait | 64 px and up | consider the reference path |

Go one size up when the subject needs hands holding something, a raised or crossed pose, or
visible muscle definition — those need pixels a 32 px canvas does not have.

## 2. Proportion budget (characters)

Write the budget **before the first shape**, in pixels, and keep it in the spec's `budget` key.

Head-count by canvas (total height ÷ head height):

| Canvas | Heads | Look |
|---|---|---|
| 16 px | 2–3 | chibi |
| 32 px | 2–3 chunky, 3–4 for a human | simplified |
| 48 px | 3.5–4.5 | stylised but anatomical |
| 64 px and up | 4–6 | close to realistic (6 heads is the practical maximum for sprites) |

Body rules, all relative to the head height `H`:

- **Torso** (shoulder line to crotch): 1.0–1.5 H. Never shorter than 0.7 H.
- **Legs** (crotch to sole): about the torso length; longer for a taller, more realistic figure.
- **Arm** (shoulder to fingertip): 0.9–1.5 × torso. Hanging, the hand ends at mid-thigh.
  **A raised arm has the same length as a hanging one** — it ends about one arm length above the
  shoulder, so a prop held overhead sits just above the head, not a full body-length up.
- **Elbow** at the arm's midpoint; **fist** about as wide as the forearm plus 1 px.
- **Neck** 1/2–2/3 of the head width; eyes halfway down the head.
- **Limb thickness** 2 px minimum above 16 px; 1 px arms only on a 16 px canvas.
- **Muscular build**: shoulders 1.8–2.2 head widths, waist about 1 head width (V-taper), upper
  arm thicker than forearm, neck thick. Show muscle with width and silhouette, never with longer
  limbs or a bigger head.
- **Feet** on the bottom row of the canvas; the figure fills 85–100 % of the canvas height
  including any prop.

Order of fitting when a prop is held overhead: reserve the prop's rows first, then the figure
gets what is left — shrink the whole figure or pick a bigger canvas, never squash the torso.

## 3. Build order

1. **Silhouette** — block every body part as a measured shape in one colour family. Render and
   look at the silhouette panel: if the pose and subject do not read as a black shape, fix the
   shapes before adding anything.
2. **Colour blocks** — one flat mid-tone per material.
3. **Shading** — one light direction for the whole sprite; shadow shapes on the far side and
   underside, highlights on the near top edge. One step of the ramp each way.
4. **Outline** — last. Coloured outline = the darkest tone of the fill it borders.
5. **Details** — face, fingers, creases, as small `rows` / `pixel` patches.
6. **Check at 1x** — the smallest panel of the preview is what the player sees.

## 4. Cleanliness rules (each is checkable)

- **No orphans.** A single pixel of a colour with no same-colour neighbour is noise, except
  eyes, pupils and sparkles.
- **No jaggies.** Along a curve or diagonal, run lengths change evenly: `1-1-2-2-3`, not
  `1-3-1-2`. A straight diagonal repeats one run length (`2-2-2-2`).
- **No doubles.** An outline is 1 px thick everywhere; L-shaped corners that make a 2x2 block of
  outline are cut to a diagonal.
- **Closed outline.** No fill pixel touches transparency (when the style has outlines).
- **No pillow shading.** Shading does not follow the outline inward from all sides; it follows
  the light.
- **No banding.** Do not stack runs of neighbouring tones that start and end on the same column —
  stagger the ends by a pixel. Flat bands (belts, stripes) are the exception.
- **Distinct ramp steps.** Neighbouring tones of one ramp must be clearly different at 1x; shift
  hue along the ramp (highlights warmer, shadows cooler) instead of only changing brightness.
- **One outline style.** Every edge outlined or none; outline colour is a darkened fill colour
  unless the style says black.
- **No anti-aliasing at 16 px and under**; above that, only single mid-tone pixels on long curves
  and only when the style allows it.
- **Symmetric subjects** are built as a mirrored half, then the lighting is re-applied so
  highlights stay on the light side.
- **Interior lines are rare.** Separate overlapping limbs with a shadow tone before reaching for
  an outline-coloured line.

## 5. Character sets and humanoid animals

Rules from drawing a set of five gym animals that had to match a human reference character.

- **Anatomy over blobs.** A ball head on a ball body is a mascot; draw it only when asked for
  one. "More realistic" means anatomy — neck, torso with shoulders and waist, arms and legs in
  two segments, shoes or feet — not more colours or more shading.
- **Working proportions at 64 px:** about 3 heads tall, head ~20 px, neck visible, limbs as
  round-ended capsules 6–7 px wide (`spritekit.cap`), eyes 3x3 with a glint.
- **Species is in the head:** ear shape, muzzle or beak, cheek and face patches. The body stays
  close to the shared humanoid skeleton so the set is consistent.
- **Fitness level is width.** Shoulder width and limb thickness carry "beginner" vs "strong";
  a change of 1–2 px reads clearly, so adjust in small steps.
- **Drop what does not read.** A tail or wing that looks odd after two tries is removed or
  rebuilt from simple parts — feathers as a fan of overlapping capsules, not single pixels.
- **Props near the face** must leave the eyes and the mouth or beak visible; move the head or
  the prop, never hide the face.
- **A set shares** canvas size, ground line, head size and skeleton anchors (shoulder, hip,
  feet). Render the whole set as one strip and compare before delivering.
- **Outline-map clash.** A character that is a fill in one place and another fill's outline in
  another (a grey that is both a material and white's outline) must stay out of the `outline`
  map; give those shapes explicit edges instead (`Sprite.add`, `Sprite.edge`).
- **Generated sprites produce lint warnings** for `orphans` and `doubles` from light rims and
  1 px details. Errors are fixed; these warnings are reported, not chased.
- **Feedback is one targeted change.** Change the named part of the named sprite, rebuild only
  that one, and keep everything that was already approved.

## 6. Reading the lint report

`lint.py` prints one line per finding. `ERROR` must be fixed. `WARN` is fixed unless it is a
deliberate choice (name it when delivering). `NOTE` is informational.

| Check | Fix |
|---|---|
| `colours` | merge tones back into the style palette |
| `outline` | add the missing outline pixel or let the auto-outline run again |
| `orphans` | delete it, or grow it to 2 px; list intentional chars in `--ignore-orphans` |
| `doubles` | thin the outline to 1 px, cut the corner |
| `symmetry` | the silhouette halves differ — fix the shape, or drop `symmetric` for an asymmetric pose |
| `proportions` | change the shapes to meet the budget; do not raise the budget to pass |
| `banding` | stagger run ends by 1 px |
