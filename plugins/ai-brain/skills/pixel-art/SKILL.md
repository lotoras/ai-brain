---
name: pixel-art
description: Generate true pixel art in a reusable, consistent style — sprites, characters, items, tiles, tilesets, pixel icons, small scenes, and looping sprite animations (sprite sheet + frame data). Resolves or creates a style file first (interview → example images → saved style .md), then draws every asset on a real pixel grid with a locked palette. Use when the user asks for "pixel art", a "sprite", "sprite sheet", "sprite animation" / "walk cycle" / "idle loop" / "animate this sprite", "tileset", "8-bit" / "16-bit" / "retro game" graphics, a "pixel icon", "NES / Game Boy / SNES / PICO-8 style", or says "in my pixel style" / passes a pixel-art style file. Do NOT use for photorealistic or vector images (media-gen) or for recolouring existing icons (recolor-icons).
argument-hint: [subject] [style name | path to style .md | style description]
---

# pixel-art — consistent pixel art from a saved style

Produce real pixel art: an exact grid, a locked palette, binary alpha. Every asset is generated
against a **style** — either an existing style file, a described style, or a new one built through
an interview plus example images and saved for reuse.

Two engines:
- **Opus direct (default)** — you block the sprite out of measured shapes (`build.py`), render it
  (`render.py`), check it (`lint.py` + the preview) and fix it. Exact by construction, and
  proportions are planned, not improvised.
- **GPT** — the `media-gen` skill generates the image in ChatGPT, then `pixelize.py` snaps it to
  a true grid and palette. Use only when the user names GPT/ChatGPT or the style file says
  `Engine: gpt`. Suggest it (do not switch silently) for scenes larger than about 64 px.

Opus direct can also start from a **reference** (optional, per asset): a generated image is
pixelized to an editable grid and cleaned up by hand — see "Reference path" in Step 4.

## When to use / not use
- **Use** for: "make a pixel art knight", "16x16 sprite of a potion", "tileset for a forest
  level", "8-bit icon set", "draw this in my pixel style", "create a pixel-art style for my game",
  "animate the knight", "make a walk cycle", "looping sprite animation".
- **Do NOT use** for: photorealistic, painted or vector images and video (→ `media-gen`),
  recolouring or background-knockout of existing icons (→ `recolor-icons`), or animating an object
  transformation on a canvas (→ `stop-animation`). Looping sprite animations belong here.

## Dependencies

One-time install before running the scripts:
```
pip install pillow numpy
```

## Folder layout (in the user's current project)

```
./pixel-art/
  styles/<name>.md          saved style file
  styles/<name>/refs/       approved example images for that style
  <slug>.shapes.json        Opus-direct source: shape spec (edit this, not the grid)
  <slug>.grid.json          grid built from the spec (or typed by hand for tiny assets)
  <slug>.png                1x asset
  <slug>@<N>x.png           nearest-neighbour upscale
  <slug>-preview.png        contact sheet: sprite, silhouette, 1x/2x/4x, style reference
  <slug>-anim.png           animation sprite sheet, frames side by side at 1x
  <slug>-anim@<N>x.png      nearest-neighbour upscale of the sheet
  <slug>-anim.json          frame size, frame count, default frame duration
  <slug>-anim.gif           fixed-speed preview loop
  <slug>-anim-frames.png    contact sheet of all frames for review
  _raw/                     raw ChatGPT downloads (GPT engine and reference path)
```

---

## Step 0 — Resolve the style (always first)

Read the argument and the user's message, then take the first branch that matches:

1. **A path to a `.md` file, or the name of a file in `./pixel-art/styles/`** → `Read` it and
   skip to Step 4.
2. **Text that describes a style** (e.g. "Game Boy green, 16x16, 1 px black outline") → use it as
   an ad-hoc style, fill unstated fields with the era preset's defaults, skip to Step 4. After
   delivering, offer once to save it as a style file (Step 3).
3. **Neither** → `Glob` `./pixel-art/styles/*.md`, then ask ONE `AskUserQuestion`:
   - **Use an existing style** — one option per style file found (omit when none exist)
   - **Describe one / give a file** — user types the description or a path via Other
   - **Create a new style** — go to Step 1

Never generate an asset before a style is resolved.

## Step 1 — Interview (new style only)

First extract everything the user already stated (era, size, palette, perspective, outline,
shading, background, mood). Never ask about something already given. Ask only the gaps, at most
**4 questions per `AskUserQuestion` call, two calls at most**:

**Call 1 — frame**
- **Era preset** — NES · Game Boy · SNES · PICO-8 · Modern indie
- **Default canvas size** — 16 · 32 · 64 · 128 px (a default only; each asset gets its own
  suggested size in Step 4)
- **Palette** — preset's own palette (default) · a named palette · a colour count · hex list
  (typed via Other)
- **Perspective** — Side view · Top-down · 3/4 view · Isometric

**Call 2 — rendering**
- **Outline** — None · 1 px black · Coloured (darker shade of the fill)
- **Shading** — Flat · Cel (2–3 tones) · Dithered; plus light direction (default: upper-left)
- **Background** — Transparent · Flat colour
- **Mood** — free choice of 3–4 fitting options for the subject matter

Era presets fill whatever is still open:

| Preset | Canvas | Colours | Outline | Shading |
|---|---|---|---|---|
| NES | 16 | 4 per sprite (3 + transparent) | 1 px black | flat |
| Game Boy | 16 | 4 greens `#0f380f #306230 #8bac0f #9bbc0f` | darkest green | flat |
| SNES | 32 | 16 | coloured | cel |
| PICO-8 | 16 | fixed 16-colour PICO-8 palette | 1 px black | flat |
| Modern indie | 32–64 | 16–32 | coloured or none | cel, optional dither |

## Step 2 — Examples

1. Pick ONE test subject: the user's subject if they named one, else a neutral default that fits
   the canvas (a potion bottle for 16 px, a small character for 32 px and up).
2. Produce **2–3 Opus-direct variants** that differ on exactly one axis (e.g. outline rule, or
   shading depth, or palette warmth) — follow "Opus direct" in Step 4 for each.
3. Produce **1–2 GPT variants** — follow "GPT" in Step 4, one asset at a time.
4. Show all variants upscaled side by side, each labelled with its engine and the axis value
   (`A — Opus, 1 px black outline`, `D — GPT`). `Read` each `@Nx` PNG so the user sees them.
5. Ask which one to keep and what to change. Apply the change, re-render only that variant,
   repeat until the user approves. The engine of the approved variant becomes the style's engine.

## Step 3 — Write the style file

1. Ask for a style name if none was given (short, kebab-case).
2. `Read` `templates\style.md` from this skill folder, fill every `{{PLACEHOLDER}}`, and write it
   to `./pixel-art/styles/<name>.md`. No placeholder may remain.
   - Palette rows: one `| char | #hex | role |` line per colour; the same characters are reused
     in every grid of this style.
   - Do / don't: concrete, checkable rules taken from the approved example (e.g. "outline is
     always the darkest palette colour", "no single orphan pixels", "highlights upper-left only").
   - Fixed GPT prompt prefix: built per "GPT prompting rules" below, with this style's colour
     count and view.
3. Copy the approved example(s) (1x PNG, and the grid JSON when Opus-drawn) to
   `./pixel-art/styles/<name>/refs/`; list those paths under References.
4. Print the style file path and tell the user to pass that path, or the style name, next time.

## Step 4 — Generate

Engine: the style file's engine; default Opus direct; GPT when the user names it. Generate
**one asset at a time**, also in batches.

### Size and proportions (every asset, before drawing)

`Read` `references\craft.md` from this skill folder, then:

1. **Suggest a canvas for this asset** from its size table and say it in one line with the
   reason ("48x48 — a posed character holding a prop needs room for hands"). The style's canvas
   is a default, never a limit; do not force a complex subject onto a small canvas. Proceed with
   the suggestion unless the user named a size.
2. **Characters and creatures: write the proportion budget** in pixels — head, neck, torso,
   legs, arm length, shoulder width, prop — using craft.md §2 and the style's Proportions
   section. The rows must add up to the canvas height. State the budget to the user in one
   short line; it goes into the spec's `budget` key.

### Opus direct

Work in the build order of craft.md §3. The source of truth is the shape spec; the grid is
generated from it. Typing a full grid by hand is allowed only for assets of 16 px and under.

1. **Block the silhouette.** Write `./pixel-art/<slug>.shapes.json`:
   ```json
   {
     "canvas": [48, 48],
     "palette": {".": null, "p": "#f2b98a", "n": "#d08a5f", "N": "#8f4f3c"},
     "outline": {"p": "N", "n": "N"},
     "symmetric": true,
     "budget": {"heads": [3.5, 4.5]},
     "shapes": [
       {"type": "ellipse", "xy": [18, 4, 29, 15], "fill": "p", "part": "head"},
       {"type": "rect", "xy": [12, 17, 17, 33], "fill": "p", "part": "arm", "mirror": true}
     ],
     "post": []
   }
   ```
   - Shape types: `rect`, `ellipse` (both `xy: [x0, y0, x1, y1]`, inclusive), `polygon`, `line`
     (`points`, optional `width`), `pixel` (`points`), and `rows` (`xy` + literal rows of palette
     characters, space = leave unchanged) for faces and other small details.
   - `"mirror": true` repeats a shape across the vertical centre — build symmetric subjects as
     one half. `"outline": true` gives a shape its own border (a limb in front of the torso).
   - `"part"` labels (`head`, `torso`, `arm`, `leg`, `shoulders`) feed the proportion report.
     Label one arm and one leg over their full length.
   - `outline` maps every fill character to its outline character; the silhouette edge is then
     outlined automatically. `post` shapes are applied after that outline (highlights, details
     that must survive it).
   - Only the style's palette characters.
2. **Build, render, lint** in one go:
   ```powershell
   $s = "${CLAUDE_PLUGIN_ROOT}\skills\pixel-art\scripts"
   python "$s\build.py"  --spec "./pixel-art/<slug>.shapes.json" --out "./pixel-art/<slug>.grid.json"
   python "$s\render.py" --grid "./pixel-art/<slug>.grid.json" --out "./pixel-art/<slug>.png" `
     --scale <export scale> --max-colors <style limit> --compare "<style reference 1x png>"
   python "$s\lint.py"   --grid "./pixel-art/<slug>.grid.json" --max-colors <style limit> `
     --ignore-orphans "<eye / sparkle chars>"
   ```
   `build.py` prints each part's size; `lint.py` prints the head-count, the arm / leg / torso
   ratios and every defect with coordinates. Add `--grid-lines` to `render.py` for a
   `<slug>-grid.png` with pixel coordinates when you need to place details.
3. **Check the silhouette first.** `Read` `./pixel-art/<slug>-preview.png` — the second panel is
   the one-colour silhouette. If the subject, pose and build do not read there, or the
   proportion report misses the budget, fix the shapes now. Do not shade a bad silhouette.
4. **Add colour blocks, shading, details** as further shapes, re-running step 2 after each
   stage. Then check the preview against the style:
   - reads at 1x (smallest panel) and sits well next to the style reference (last panel)
   - palette only, within the colour limit
   - outline rule followed everywhere (no gaps, no doubled lines)
   - one light direction, no pillow shading, no banding
   - no orphan pixels
   - every do / don't line of the style file
5. **Fix and re-run until lint has no errors and no unexplained warnings** — at most 4 passes
   after the silhouette is approved. Then deliver and name what is still off, including any
   lint warning you chose to keep.

### Generator path (sets, and sprites of 48 px and up)

Typing dozens of shapes by hand is slow and drifts between the sprites of a set. For a set of
related sprites, a character of 48 px or more, or anything that will be animated, write a small
Python generator in the scratchpad that imports `scripts\spritekit.py` and emits the shape
spec:

- masks (`E`, `R`, `P`, `L`, `circ`, `cap`, `band`, `flip`, `both`, `inner`, `mv`) combined
  with `|`, `&`, `~`; limbs are `cap([shoulder, elbow, hand], width)`
- `Sprite.add(mask, (fill, edge, shade, light))` draws an outlined, cel-shaded form;
  `fill` / `edge` / `px` / `rows` add details; `mark` labels parts for the proportion report
- `write_spec(sprite, outline_map, style_palette, path)` writes the spec for `build.py`
- one function per sprite, shared anchors (torso, neck, legs, shoes) defined once for a set

The generator is a throwaway; the spec, grid and PNGs it writes are the deliverables. The
build, render, lint and preview loop above applies unchanged. Read craft.md §5 for sets and
humanoid animals.

### Reference path (optional, per asset)

Use it when the user asks for a reference, or when a character still fails the proportion or
visual check after two passes — say so and offer it instead of grinding on.

1. Generate a reference through the **`media-gen` skill**: subject sentence first, then the
   style's fixed GPT prompt prefix; full body, the pose named explicitly.
2. Snap it to an editable grid in the style's palette:
   ```powershell
   python "${CLAUDE_PLUGIN_ROOT}\skills\pixel-art\scripts\pixelize.py" `
     "./pixel-art/_raw/<slug>.png" --size <W>x<H> `
     --palette "<style hex list>" --chars "<style palette chars>" `
     --out "./pixel-art/<slug>.png" --grid-out "./pixel-art/<slug>.grid.json"
   ```
3. The reference gives proportions and pose, not clean pixels. Either measure its parts and
   rebuild them as shapes (preferred — the result stays editable), or clean the emitted grid by
   hand. Both end with the render + lint loop above.

### GPT

1. Build the prompt: **subject sentence first**, then the style's fixed prompt prefix.
2. Generate through the **`media-gen` skill** (ChatGPT), one asset at a time. When the style has
   reference images, have the user attach one from `./pixel-art/styles/<name>/refs/`.
3. Save the download to `./pixel-art/_raw/<slug>.png`, then snap it to the grid:
   ```powershell
   python "${CLAUDE_PLUGIN_ROOT}\skills\pixel-art\scripts\pixelize.py" `
     "./pixel-art/_raw/<slug>.png" `
     --size <W>x<H> `
     --palette "<hex,hex,...>" `
     --out "./pixel-art/<slug>.png" `
     --scale <export scale>
   ```
   - Always pass `--palette` (style palette) or, for an ad-hoc style without one, `--colors N` —
     without either the output keeps hundreds of near-duplicate colours.
   - Add `--grid-out <slug>.grid.json --chars "<style palette chars>"` to get an editable grid
     of the result, then run `lint.py` on it.
   - The script prints the cell size, the final size and the colour count. `requested size`
     instead of `detected` means no pixel grid was found — inspect the result closely.
   - Background not fully removed → raise `--tolerance` (default 32); subject eaten → lower it.
   - Full scenes and tiles that must keep their background → add `--keep-bg`.
4. `Read` `./pixel-art/<slug>@<N>x.png` and run the same visual check as Opus direct. Off-style
   result → regenerate with ONE change to the prompt, not several.

### GPT prompting rules

- **Subject first**, in one plain sentence; the style block follows it.
- **Name the view explicitly**: "side view", "top-down view", "3/4 view", "isometric view".
- Fixed style block:
  `pixel art game sprite, large visible square pixels, no anti-aliasing, no gradients, flat
  colors, crisp 1-pixel outline, N colors max, flat solid plain background`
  (replace `N` with the style's colour limit; adapt the outline clause to the style's rule).
- **Never ask for a transparent background.** Ask for a flat solid background in a colour the
  subject does not contain, and let `pixelize.py` knock it out locally.
- **With a reference image uploaded, describe the subject, not the style** — the image carries
  the style; restating it makes the model drift.
- **Change one thing at a time** when iterating.

## Step 4b — Animate (on request)

For "animate it", a walk / idle / action loop, or a sprite sheet. `Read`
`references\animation.md` from this skill folder first.

1. **Start from an approved still** drawn through the generator path. Name the motion, the
   loop type (up-down, up-down with hold, true cycle) and the frame count in one line —
   default 8 frames at 120 ms.
2. **Check the motion envelope:** both ends of the motion must fit the canvas and keep the
   face readable. If not, say so and shorten the travel or suggest a bigger canvas.
3. **Give the sprite's generator function a frame index** and make only joints, group offsets
   and per-frame layer order depend on it. Frame 0 reproduces the still.
4. **Build, render and lint every frame** into the scratchpad (not into `./pixel-art/`), then
   assemble:
   ```powershell
   python "${CLAUDE_PLUGIN_ROOT}\skills\pixel-art\scripts\animate.py" `
     --frames <f0.png> <f1.png> ... --out "./pixel-art/<slug>-anim" `
     --frame-ms 120 --scale <export scale> --name "<display name>" `
     --still "./pixel-art/<slug>.png" --html "./pixel-art/animations.html"
   ```
   It writes the sheet, the upscaled sheet, the GIF, the JSON and the contact sheet, reports
   whether frame 0 equals the still, and refreshes the preview page (speed slider, pause) for
   every `*-anim.json` in that folder.
5. **Review** `./pixel-art/<slug>-anim-frames.png` per animation.md §8 and fix poses — at most
   3 passes per sprite.
6. **Playback speed is the player's job.** Never bake a speed into the frames; the sheet plus
   JSON is the deliverable, the GIF is a preview.

## Step 5 — Deliver

- Report `./pixel-art/<slug>.png` (1x) and `./pixel-art/<slug>@<N>x.png` (nearest-neighbour),
  plus the style used.
- Batches: finish, check and report each asset before starting the next.
- Ad-hoc style (Step 0, branch 2): offer once to save it via Step 3.
- Animations: report the sheet, JSON, GIF and preview page, the lint total over all frames,
  whether frame 0 matches the still, and that playback itself was not watched (unless the
  preview page was opened in a browser).

## Gotchas

- **Never resize pixel art with anything but nearest-neighbour**, and only by integer factors.
- **Image models paint the pixel look, not a grid** — soft blocks and hundreds of stray colours.
  A raw ChatGPT download is never a deliverable; it always goes through `pixelize.py`.
- **File dialogs freeze browser automation** — reference images are attached by the user.
- **Large canvases are slow to draw by hand**: above about 64 px suggest the GPT engine.
- **Proportions fail when they are improvised.** Never start a character without the written
  budget; a prop held overhead is budgeted first and the figure fits in what is left.
- **A small canvas is not a virtue.** If the subject needs hands, a pose or muscle definition,
  suggest the next size up instead of squeezing it in.
- **Edit the shape spec, not the built grid** — `build.py` overwrites the grid on every run.
  Put hand-placed pixels in `rows` / `pixel` shapes (in `post` when they sit on the outline).
- **Lint is not taste.** A clean lint report means no mechanical defects; the preview decides
  whether it looks good.
- **Animate by posing, not redrawing.** Frames come from one generator function with a frame
  index; redrawn frames drift in shape and colour.
- **Layer order changes with the pose.** A prop hidden behind the arm, or a bar across the
  eyes, is a draw-order bug in that frame — see animation.md §5.
- **Check the far end of a motion before approving a still** — a pose that fills the canvas
  leaves no room to move.
- **Style drift** comes from re-describing the style per asset. Read the style file every time
  and reuse its palette characters and prompt prefix verbatim.

## Siblings

- `media-gen` — image generation in ChatGPT (used by the GPT engine here).
- `recolor-icons` — recolour / knock out the background of existing icons.
- `stop-animation` — object-transformation canvas animations (not sprite loops; those are
  Step 4b here).
