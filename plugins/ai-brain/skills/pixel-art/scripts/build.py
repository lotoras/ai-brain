"""
pixel-art / scripts / build.py

Rasterise a shape spec (rectangles, ellipses, polygons, lines, pixel patches) into a
palette-indexed grid JSON that render.py and lint.py read. Blocking a sprite out of
measured shapes keeps proportions honest; typing rows by hand does not.

Spec JSON
---------
{
  "canvas":    [48, 48],
  "palette":   {".": null, "p": "#f2b98a", "N": "#8f4f3c"},
  "outline":   {"p": "N"},            # fill char -> outline char (optional)
  "symmetric": true,                  # optional, checked by lint.py
  "budget":    {"heads": [3, 4]},     # optional, checked by lint.py
  "shapes": [                         # drawn in order, later shapes paint over earlier ones
    {"type": "ellipse", "xy": [18, 4, 29, 16], "fill": "p", "part": "head"},
    {"type": "rect",    "xy": [8, 18, 13, 33], "fill": "p", "part": "arm",
     "mirror": true, "outline": true},
    {"type": "polygon", "points": [[14, 18], [33, 18], [29, 32], [18, 32]], "fill": "f"},
    {"type": "line",    "points": [[20, 24], [27, 24]], "fill": "d", "width": 1},
    {"type": "pixel",   "points": [[21, 9], [26, 9]], "fill": "k"},
    {"type": "rows",    "xy": [20, 8], "rows": ["wk  kw", " nn  "]}   # space = keep
  ],
  "post": [ ... ]                     # same shape list, applied after the silhouette outline
}

All coordinates are inclusive pixel coordinates, origin top-left.
"mirror": true also draws the shape reflected across the vertical centre line.
"outline": true draws the shape's own 1 px border in the outline colour of its fill.
When "outline" (the map) is present, every fill pixel on the silhouette edge is
replaced by its outline colour after "shapes" and before "post".

Output grid JSON: palette, rows, plus parts (bounding boxes per "part" label),
outline, symmetric and budget passed through for lint.py.

Requires: Pillow, NumPy
Usage:    python build.py --spec sprite.shapes.json --out sprite.grid.json
"""

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw


def fail(message: str):
    raise SystemExit(f"Spec error: {message}")


def interior(mask: np.ndarray) -> np.ndarray:
    """Pixels of `mask` whose four neighbours are all in `mask` (canvas edge counts as outside)."""
    padded = np.pad(mask, 1)
    return (mask & padded[:-2, 1:-1] & padded[2:, 1:-1]
            & padded[1:-1, :-2] & padded[1:-1, 2:])


def shape_mask(shape: dict, index: int, w: int, h: int) -> np.ndarray:
    kind = shape.get("type")
    img = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(img)
    try:
        if kind == "rect":
            x0, y0, x1, y1 = shape["xy"]
            draw.rectangle([x0, y0, x1, y1], fill=1)
        elif kind == "ellipse":
            x0, y0, x1, y1 = shape["xy"]
            draw.ellipse([x0, y0, x1, y1], fill=1)
        elif kind == "polygon":
            draw.polygon([tuple(p) for p in shape["points"]], fill=1, outline=1)
        elif kind == "line":
            draw.line([tuple(p) for p in shape["points"]], fill=1,
                      width=int(shape.get("width", 1)))
        elif kind == "pixel":
            for x, y in shape["points"]:
                if 0 <= x < w and 0 <= y < h:
                    img.putpixel((x, y), 1)
        else:
            fail(f"shape {index}: unknown type {kind!r} "
                 "(rect, ellipse, polygon, line, pixel, rows).")
    except (KeyError, ValueError, TypeError) as exc:
        fail(f"shape {index} ({kind}): bad or missing coordinates ({exc}).")
    return np.array(img, dtype=bool)


def apply_shapes(grid: np.ndarray, shapes: list, chars: dict, outline: dict,
                 parts: dict, label: str):
    h, w = grid.shape
    for i, shape in enumerate(shapes):
        where = f"{label}[{i}]"
        mirror = bool(shape.get("mirror"))

        if shape.get("type") == "rows":
            try:
                x0, y0 = shape["xy"]
                rows = shape["rows"]
            except (KeyError, ValueError, TypeError):
                fail(f'{where}: "rows" needs "xy": [x, y] and "rows": [...].')
            for dy, row in enumerate(rows):
                for dx, ch in enumerate(row):
                    if ch == " ":
                        continue
                    if ch not in chars:
                        fail(f"{where}: unknown character {ch!r} in rows.")
                    x, y = x0 + dx, y0 + dy
                    if 0 <= x < w and 0 <= y < h:
                        grid[y, x] = chars[ch]
                        if mirror:
                            grid[y, w - 1 - x] = chars[ch]
            continue

        fill = shape.get("fill")
        if fill not in chars:
            fail(f"{where}: fill {fill!r} is not a palette character.")
        mask = shape_mask(shape, where, w, h)
        full = mask | mask[:, ::-1] if mirror else mask
        grid[full] = chars[fill]

        if shape.get("outline"):
            edge_char = outline.get(fill)
            if edge_char is None:
                fail(f'{where}: "outline": true but the outline map has no entry for {fill!r}.')
            grid[full & ~interior(full)] = chars[edge_char]

        part = shape.get("part")
        if part and mask.any():
            ys, xs = np.where(mask)
            box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
            m0, m1 = w - 1 - box[2], w - 1 - box[0]
            if mirror and max(box[0], m0) <= min(box[2], m1) + 1:    # halves meet at the centre
                box[0], box[2] = min(box[0], m0), max(box[2], m1)
            old = parts.get(part)
            parts[part] = box if old is None else [min(old[0], box[0]), min(old[1], box[1]),
                                                   max(old[2], box[2]), max(old[3], box[3])]


def main():
    ap = argparse.ArgumentParser(description="Rasterise a shape spec to a pixel-art grid JSON.")
    ap.add_argument("--spec", required=True, help="Shape spec JSON")
    ap.add_argument("--out", required=True, help="Output grid JSON")
    args = ap.parse_args()

    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)

    try:
        w, h = (int(v) for v in spec["canvas"])
    except (KeyError, ValueError, TypeError):
        fail('"canvas" must be [width, height].')
    palette = spec.get("palette")
    if not isinstance(palette, dict) or not palette:
        fail('"palette" must be a non-empty object.')
    blank = next((k for k, v in palette.items() if v is None), None)
    if blank is None:
        fail('"palette" needs one transparent entry (value null), e.g. ".": null.')
    keys = list(palette)
    chars = {key: i for i, key in enumerate(keys)}
    outline = spec.get("outline") or {}
    for fill, edge in outline.items():
        if fill not in chars or edge not in chars:
            fail(f'"outline" entry {fill!r}: {edge!r} uses a character missing from the palette.')

    grid = np.full((h, w), chars[blank], dtype=np.int32)
    parts = {}
    apply_shapes(grid, spec.get("shapes") or [], chars, outline, parts, "shapes")

    if outline:
        solid = grid != chars[blank]
        edge = solid & ~interior(solid)
        for fill, edge_char in outline.items():
            grid[edge & (grid == chars[fill])] = chars[edge_char]

    apply_shapes(grid, spec.get("post") or [], chars, outline, parts, "post")

    data = {"palette": palette,
            "rows": ["".join(keys[v] for v in row) for row in grid]}
    for key in ("outline", "symmetric", "budget"):
        if key in spec:
            data[key] = spec[key]
    if parts:
        data["parts"] = parts

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(data, indent=1) + "\n")

    print(f"Grid: {w}x{h}  ->  {args.out}")
    for name, (x0, y0, x1, y1) in parts.items():
        print(f"  part {name:<10} x {x0}-{x1}  y {y0}-{y1}  ({x1 - x0 + 1}x{y1 - y0 + 1})")


if __name__ == "__main__":
    main()
