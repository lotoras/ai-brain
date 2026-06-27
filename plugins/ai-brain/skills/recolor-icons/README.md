# recolor-icons

Knock out backgrounds and recolor PNG icons. **Solid is the default; gradient is opt-in.**

| Script | Output | Purpose |
|---|---|---|
| `transparent-bg.py <path>` | `*-transparent.png` | White/near-white bg → transparent (keeps dark lines). Run this first on generated icons. |
| `recolor-solid.py <path> [#hex]` | `*-solid.png` | Flat recolor. Color defaults to Petrol `#006b6e`. |
| `recolor.py <path> [#start #end]` | `*-gradient.png` | Diagonal gradient. Defaults `#006b6e` → `#a8d680`. |

Requires Python 3 with Pillow + NumPy. A single explicitly-passed file is always processed;
folder mode skips each script's own output suffix.

**Decision rule (see `SKILL.md`):** no color requested → leave dark (transparent only);
a color → solid; "gradient" → gradient; "recolor" with no color → ask which color.

Brand: Petrol `#006b6e`, mid-green `#a8d680`.
