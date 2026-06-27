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
```

## Decision tree — when to recolor, ask, or leave dark

Apply this whenever an icon could be recolored (including the `media-gen` icon flow):

1. **No recolor requested** → **leave it dark.** Deliver the icon dark-on-transparent:
   run `transparent-bg.py` only. Do **not** auto-apply any brand color.
2. **Recolor requested WITH a specific color** (e.g. "recolor petrol", "make it teal",
   "brand color", "#ff8800") → **solid** recolor in that color via `recolor-solid.py <file> <hex>`.
   Map names/brand terms to hex first (brand/UPD/petrol = `#006b6e`; mid-green = `#a8d680`;
   common CSS color names → their hex).
3. **Recolor requested WITH "gradient"** (e.g. "recolor with gradient", "brand gradient",
   "gradient from X to Y") → `recolor.py` (default Petrol→green, or the named endpoints).
4. **"recolor" with NO color and NO "gradient"** (just "recolor it") → **ASK which color**
   the user wants (offer: a flat color, or the UPD brand gradient). Do not guess.

Solid is the default recolor mode; gradient only happens when the user says "gradient".

## How the recolor works
Each opaque pixel keeps its alpha (anti-aliasing preserved). Solid replaces RGB with one
color; gradient projects each pixel onto the icon's bounding-box diagonal (bottom-left
start → top-right end). `transparent-bg.py` derives alpha from inverse luminance, so it
needs a light background to key against.

## Gotchas
- **Knock out the background first.** Generated raster icons aren't transparent — ChatGPT's
  "full size" PNG is flattened onto **near-white**, Gemini renders on **white**. Recoloring
  those directly floods the whole square and the icon disappears. Always `transparent-bg.py`
  first, then recolor the resulting `-transparent.png`.
- **Recolor the `-transparent` file explicitly**, not a mixed folder. A single passed file is
  always processed; folder mode skips only the script's own output suffix, so running a recolor
  over a folder that still contains raw white-bg originals would flood those. Pass the specific
  `-transparent.png` (the `media-gen` icon-by-icon flow does this).
- Suffixes are stackable and re-run-safe: `-transparent`, `-solid`, `-gradient`.

## Brand palette
- Petrol `#006b6e` (RAL 5021), mid-green `#a8d680` (saturated variant of Weissgrün `#cce9a4`).
- To preview a transparent result, composite it over white before showing the user.

## Out of scope
Per-pixel hue-preserving photo recolor; vector/SVG edits (edit `fill`/`stroke` directly).
