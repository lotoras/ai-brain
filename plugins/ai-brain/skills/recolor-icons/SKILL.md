---
name: recolor-icons
description: Recolor PNG icons and knock out white/near-white backgrounds. Solid (flat) color is the DEFAULT; gradient is opt-in. Use when the user wants an icon recolored to the UPD brand or any color, made transparent, or prepped from a generated/raster icon. Petrol #006b6e, mid-green #a8d680.
---

# Recolor icons (transparent-bg + solid + gradient)

Three small Pillow/NumPy scripts in this skill folder. Requires `python` with
Pillow + NumPy (confirmed on this machine: Pillow 10.4, NumPy 1.26).

Scripts (run with the plugin path; `${CLAUDE_PLUGIN_ROOT}` resolves to the
installed plugin, on this machine `C:\laragon\www\ai-brain\plugins\ai-brain`):

```powershell
# 1. Make white / near-white background transparent (keeps the dark line color)
python "C:\laragon\www\ai-brain\plugins\ai-brain\skills\recolor-icons\transparent-bg.py" <file-or-folder>
#    -> <name>-transparent.png

# 2. SOLID recolor (DEFAULT mode). Optional color; defaults to Petrol #006b6e
python "...\recolor-icons\recolor-solid.py" <file-or-folder> [#hexcolor]
#    -> <name>-solid.png

# 3. GRADIENT recolor (opt-in). Optional endpoints; default #006b6e -> #a8d680
python "...\recolor-icons\recolor.py" <file-or-folder> [#startHex #endHex]
#    -> <name>-gradient.png

# 4. TWO-TONE recolor — replace ONE color, KEEP the others + transparency.
#    For multi-color logos (e.g. Office icons: green body + white glyph). Both
#    fromColor and keepColor auto-detect; pass hex to override either.
python "...\recolor-icons\recolor-replace.py" <file-or-folder> [#newColor] [#fromColor] [#keepColor]
#    -> <name>-recolored.png
```

## Decision tree — when to recolor, ask, or leave dark

Apply this whenever an icon could be recolored (including the `media-gen` icon flow):

1. **No recolor requested** → **leave it dark.** Deliver the icon dark-on-transparent:
   run `transparent-bg.py` only. Do **not** auto-apply any brand color.
2. **Recolor requested WITH a specific color** (e.g. "recolor petrol", "make it teal",
   "brand color", "#ff8800") → recolor in that color. Map names/brand terms to hex first
   (brand/UPD/petrol = `#006b6e`; mid-green = `#a8d680`; common CSS color names → their hex).
   Then pick the mode by how many colors the icon has:
   - **Monochrome** (single ink color, the rest transparent) → **solid** via
     `recolor-solid.py <file> <hex>`.
   - **Multi-color** (a colored shape PLUS white/other detail you must keep, e.g. the
     Office logos) → **two-tone** via `recolor-replace.py <file> <hex>`. Do NOT use
     `recolor-solid.py` here — it paints every opaque pixel and flattens the white detail.
3. **Recolor requested WITH "gradient"** (e.g. "recolor with gradient", "brand gradient",
   "gradient from X to Y") → `recolor.py` (default Petrol→green, or the named endpoints).
4. **"recolor" with NO color and NO "gradient"** (just "recolor it") → **ASK which color**
   the user wants (offer: a flat color, or the UPD brand gradient). Do not guess.

Solid is the default recolor mode; gradient only happens when the user says "gradient".

## How the recolor works
Each opaque pixel keeps its alpha (anti-aliasing preserved). Solid replaces RGB with one
color; gradient projects each pixel onto the icon's bounding-box diagonal (bottom-left
start → top-right end); two-tone (`recolor-replace.py`) projects each pixel onto the
fromColor→keepColor axis and remaps fromColor→newColor, so the kept color and clean edges
survive. `transparent-bg.py` derives alpha from inverse luminance, so it needs a light
background to key against.

## Gotchas
- **Check transparency BEFORE knocking out the background.** If the source already has a real
  alpha channel, **skip `transparent-bg.py`** — re-keying an already-transparent icon off
  luminance damages its edges (and on a mid-tone icon makes the whole thing semi-transparent).
  Quick check: `python -c "from PIL import Image; import numpy as np; a=np.array(Image.open(r'PATH').convert('RGBA'))[:,:,3]; print('already_transparent', (a<255).mean()>0.02)"`.
- **Knock out the background only for FLATTENED raster.** ChatGPT's "full size" PNG is flattened
  onto **near-white** and Gemini renders on **white** (no alpha). For those, run
  `transparent-bg.py` first, then recolor the resulting `-transparent.png`; otherwise the
  recolor floods the whole square and the icon disappears.
- **Monochrome vs multi-color.** `recolor-solid.py` paints **every** opaque pixel one color —
  correct only for a single-color icon. For a multi-color icon (colored shape + white/other
  detail) use `recolor-replace.py`, which remaps one color and preserves the rest.
- **Recolor the `-transparent` file explicitly**, not a mixed folder. A single passed file is
  always processed; folder mode skips only the script's own output suffix, so running a recolor
  over a folder that still contains raw white-bg originals would flood those. Pass the specific
  `-transparent.png` (the `media-gen` icon-by-icon flow does this).
- Suffixes are stackable and re-run-safe: `-transparent`, `-solid`, `-gradient`, `-recolored`.

## Brand palette
- Petrol `#006b6e` (RAL 5021), mid-green `#a8d680` (saturated variant of Weissgrün `#cce9a4`).
- To preview a transparent result, composite it over white before showing the user.

## Out of scope
Per-pixel hue-preserving photo recolor; vector/SVG edits (edit `fill`/`stroke` directly).
