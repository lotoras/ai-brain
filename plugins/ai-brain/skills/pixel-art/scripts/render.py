"""
pixel-art / scripts / render.py

Render a palette-indexed grid (JSON) to a true pixel-art PNG.

Grid JSON
---------
{
  "palette": {".": null, "k": "#1a1c2c", "r": "#b13e53"},   # null = transparent
  "rows":    ["..kk..", ".krrk.", "..kk.."]                  # one char per pixel
}

Outputs
-------
<out>                    1x PNG (RGBA)
<out stem>@<N>x.png      nearest-neighbour upscale
<out stem>-preview.png   contact sheet on a mid-grey backdrop: sprite, one-colour silhouette,
                         the sprite at 1x / 2x / 4x, and the --compare reference if given
<out stem>-grid.png      with --grid-lines: the sprite with pixel grid lines, bold every 8

Extra keys in the grid JSON (parts, outline, ... written by build.py) are ignored.

Requires: Pillow, NumPy
Usage:    python render.py --grid sprite.grid.json --out sprite.png [--scale 8]
                           [--compare ref.png] [--max-colors N] [--grid-lines]
"""

import argparse
import json
import os

import numpy as np
from PIL import Image

BACKDROP = (128, 128, 128)
SILHOUETTE = (24, 24, 28)
GRID_MINOR = (112, 112, 112, 255)
GRID_MAJOR = (64, 64, 64, 255)
PANEL = 384          # longest side of one preview panel, in screen pixels


def parse_hex(value: str) -> tuple:
    h = value.lstrip("#")
    if len(h) != 6:
        raise ValueError(value)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255


def load_grid(path: str) -> np.ndarray:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)

    palette, rows = data.get("palette"), data.get("rows")
    if not isinstance(palette, dict) or not palette:
        raise SystemExit('Grid error: "palette" must be a non-empty object.')
    if not isinstance(rows, list) or not rows:
        raise SystemExit('Grid error: "rows" must be a non-empty list of strings.')

    colours = {}
    for key, value in palette.items():
        if len(key) != 1:
            raise SystemExit(f"Grid error: palette key {key!r} must be exactly one character.")
        if value is None:
            colours[key] = (0, 0, 0, 0)
            continue
        try:
            colours[key] = parse_hex(value)
        except (ValueError, AttributeError):
            raise SystemExit(f"Grid error: palette[{key!r}] = {value!r} is not #rrggbb or null.")

    width = len(rows[0])
    for y, row in enumerate(rows):
        if len(row) != width:
            raise SystemExit(
                f"Grid error: row {y} has {len(row)} characters, expected {width} (row 0)."
            )
        for x, ch in enumerate(row):
            if ch not in colours:
                raise SystemExit(
                    f"Grid error: unknown character {ch!r} at row {y}, column {x} "
                    f"(palette has: {' '.join(sorted(colours))})."
                )

    return np.array([[colours[ch] for ch in row] for row in rows], dtype=np.uint8)


def main():
    ap = argparse.ArgumentParser(description="Render a palette-indexed grid JSON to PNG.")
    ap.add_argument("--grid",  required=True, help="Grid JSON file")
    ap.add_argument("--out",   required=True, help="Output 1x PNG path")
    ap.add_argument("--scale", type=int, default=8,
                    help="Integer upscale factor for the @Nx and preview copies (default 8)")
    ap.add_argument("--compare", default=None,
                    help="1x PNG of a style reference, shown beside the sprite in the preview")
    ap.add_argument("--max-colors", type=int, default=None,
                    help="Fail when the sprite uses more colours than this")
    ap.add_argument("--grid-lines", action="store_true",
                    help="Also write <out stem>-grid.png with pixel grid lines (bold every 8)")
    args = ap.parse_args()

    if args.scale < 1:
        ap.error("--scale must be >= 1")

    arr = load_grid(args.grid)
    h, w = arr.shape[:2]
    img = Image.fromarray(arr, "RGBA")

    stem = os.path.splitext(args.out)[0]
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    big_path = f"{stem}@{args.scale}x.png"
    preview_path = f"{stem}-preview.png"

    img.save(args.out)
    big = img.resize((w * args.scale, h * args.scale), Image.NEAREST)
    big.save(big_path)

    # contact sheet: sprite | silhouette | 1x, 2x, 4x column | optional reference
    zoom = max(1, min(args.scale, PANEL // max(w, h)))
    pad = 2 * zoom
    shadow = arr.copy()
    shadow[..., :3] = SILHOUETTE
    panels = [img.resize((w * zoom, h * zoom), Image.NEAREST),
              Image.fromarray(shadow, "RGBA").resize((w * zoom, h * zoom), Image.NEAREST)]
    small = [img.resize((w * k, h * k), Image.NEAREST) for k in (1, 2, 4) if k < zoom]
    if args.compare:
        ref = Image.open(args.compare).convert("RGBA")
        panels.append(ref.resize((ref.width * zoom, ref.height * zoom), Image.NEAREST))
    col_w = max([s.width for s in small], default=0)
    sheet_w = sum(p.width + pad for p in panels) + pad + (col_w + pad if small else 0)
    sheet_h = max([p.height for p in panels] + [sum(s.height + pad for s in small) - pad]) + 2 * pad
    preview = Image.new("RGBA", (sheet_w, sheet_h), BACKDROP + (255,))
    x = pad
    for i, panel in enumerate(panels):
        preview.alpha_composite(panel, (x, pad))
        x += panel.width + pad
        if i == 1 and small:
            y = pad
            for s in small:
                preview.alpha_composite(s, (x, y))
                y += s.height + pad
            x += col_w + pad
    preview.convert("RGB").save(preview_path)

    if args.grid_lines:
        cell = max(zoom, 8)
        lined = img.resize((w * cell, h * cell), Image.NEAREST)
        base = Image.new("RGBA", lined.size, BACKDROP + (255,))
        base.alpha_composite(lined)
        px = base.load()
        for gx in range(0, w * cell, cell):
            shade = GRID_MAJOR if (gx // cell) % 8 == 0 else GRID_MINOR
            for gy in range(h * cell):
                px[gx, gy] = shade
        for gy in range(0, h * cell, cell):
            shade = GRID_MAJOR if (gy // cell) % 8 == 0 else GRID_MINOR
            for gx in range(w * cell):
                px[gx, gy] = shade
        base.convert("RGB").save(f"{stem}-grid.png")

    opaque = arr[arr[..., 3] > 0][:, :3]
    n_colours = len(np.unique(opaque, axis=0)) if len(opaque) else 0
    if args.max_colors is not None and n_colours > args.max_colors:
        raise SystemExit(f"Grid error: {n_colours} colours used, limit is {args.max_colors}.")
    print(f"Size: {w}x{h}  colours: {n_colours}  transparent: {bool((arr[..., 3] == 0).any())}")
    print(f"1x:      {args.out}")
    print(f"{args.scale}x:      {big_path}")
    print(f"preview: {preview_path}")


if __name__ == "__main__":
    main()
