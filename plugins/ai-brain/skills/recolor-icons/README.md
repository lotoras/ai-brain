# recolor-icons

Knock out backgrounds and recolor PNG icons. **Solid is the default; gradient is opt-in.**

| Script | Output | Purpose |
|---|---|---|
| `transparent-bg.py <path>` | `*-transparent.png` | White/near-white bg → transparent (keeps dark lines). Only for FLATTENED raster; skip if the source already has alpha. |
| `recolor-solid.py <path> [#hex]` | `*-solid.png` | Flat recolor, **monochrome** icons (paints every opaque pixel). Color defaults to Petrol `#006b6e`. |
| `recolor-replace.py <path> [#new #from #keep]` | `*-recolored.png` | **Two-tone** recolor: replace one color, keep the others + transparency. `from`/`keep` auto-detect. New color defaults to Petrol `#006b6e`. |
| `recolor.py <path> [#start #end]` | `*-gradient.png` | Diagonal gradient. Defaults `#006b6e` → `#a8d680`. |

Requires Python 3 with Pillow + NumPy. A single explicitly-passed file is always processed;
folder mode skips each script's own output suffix.

**Decision rule (see `SKILL.md`):** no color requested → leave dark (transparent only);
a color → **solid** if the icon is monochrome, **replace** if it's multi-color (keep the white/other
detail); "gradient" → gradient; "recolor" with no color → ask which color. Skip `transparent-bg.py`
when the source already has a transparent background.

Brand: Petrol `#006b6e`, mid-green `#a8d680`.
