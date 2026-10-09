"""
pixel-art / scripts / pixelize.py

Turn an AI-generated "pixel art look" image (soft blocks, stray colours, flat
backdrop) into true pixel art on a real grid.

Pipeline
--------
1. Background knockout  border-sampled colour, border-connected flood fill (tolerance).
2. Auto-crop            to the bounding box of what is left.
3. Cell detection       edge-profile periodicity, fractional cell sizes allowed;
                        falls back to fitting the requested --size.
4. Downscale to 1x      most common colour per cell (never bilinear).
5. Quantise             nearest colour in --palette, or k-means to --colors N.
6. Binarise alpha       0 or 255 only.
7. Pad / centre         onto the --size canvas.
8. Write                1x PNG + integer nearest-neighbour upscale, and with --grid-out an
                        editable grid JSON to clean up by hand (render.py / lint.py).

Requires: Pillow, NumPy
Usage:
  python pixelize.py IN --size 32x32 [--out OUT.png]
                     [--palette "#1a1c2c,#b13e53,..." | --colors N]
                     [--scale 8] [--tolerance 32] [--keep-bg]
                     [--grid-out OUT.grid.json] [--chars "kr..."]
"""

import argparse
import json
import os

import numpy as np
from PIL import Image


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def parse_size(value: str) -> tuple:
    parts = value.lower().split("x")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid size {value!r}, expected W or WxH")
    if len(nums) == 1:
        nums = nums * 2
    if len(nums) != 2 or min(nums) < 1:
        raise argparse.ArgumentTypeError(f"invalid size {value!r}, expected W or WxH")
    return nums[0], nums[1]


def parse_palette(value: str) -> np.ndarray:
    out = []
    for item in value.replace(";", ",").split(","):
        h = item.strip().lstrip("#")
        if not h:
            continue
        if len(h) != 6:
            raise argparse.ArgumentTypeError(f"invalid palette colour {item!r}, expected #rrggbb")
        try:
            out.append([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)])
        except ValueError:
            raise argparse.ArgumentTypeError(f"invalid palette colour {item!r}, expected #rrggbb")
    if not out:
        raise argparse.ArgumentTypeError("empty palette")
    return np.array(out, dtype=np.float32)


def border_connected(cand: np.ndarray) -> np.ndarray:
    """Flood fill from the four border edges, staying within the `cand` mask."""
    fill = np.zeros_like(cand)
    fill[0, :], fill[-1, :] = cand[0, :], cand[-1, :]
    fill[:, 0], fill[:, -1] = cand[:, 0], cand[:, -1]
    count = -1
    while True:
        grown = fill.copy()
        grown[1:, :] |= fill[:-1, :]
        grown[:-1, :] |= fill[1:, :]
        grown[:, 1:] |= fill[:, :-1]
        grown[:, :-1] |= fill[:, 1:]
        grown &= cand
        new_count = int(grown.sum())
        if new_count == count:
            return grown
        fill, count = grown, new_count


def knockout(rgba: np.ndarray, tolerance: int) -> np.ndarray:
    """Return alpha (uint8, 0/255) with the border-connected backdrop removed."""
    rgb = rgba[..., :3].astype(np.int16)
    solid = rgba[..., 3] >= 128
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    border_solid = np.concatenate([solid[0], solid[-1], solid[:, 0], solid[:, -1]])
    if border_solid.mean() < 0.5:
        return np.where(solid, 255, 0).astype(np.uint8)       # already transparent
    bg = np.median(border[border_solid], axis=0)
    cand = (np.abs(rgb - bg).max(axis=2) <= tolerance) | ~solid
    return np.where(solid & ~border_connected(cand), 255, 0).astype(np.uint8)


# ---------------------------------------------------------------------------
# pixel-grid detection
# ---------------------------------------------------------------------------

def edge_profile(img: np.ndarray, axis: int) -> np.ndarray:
    """profile[i] = edge strength on the boundary between index i-1 and i along `axis`."""
    d = np.abs(np.diff(img, axis=axis)).sum(axis=2).sum(axis=1 - axis)
    return np.concatenate([[0.0], d])


def line_score(profile: np.ndarray, cell: float):
    """Best lattice of period `cell` on an edge profile; returns (z, ratio, offset).

    z weighs the lattice mean by the number of grid lines, so the true cell size beats
    its multiples (same mean, fewer lines) and its fractions (more lines, diluted mean).
    """
    offsets = np.arange(0.0, cell, 0.5)
    k = np.arange(int(len(profile) / cell) + 1)
    pos = np.rint(offsets[:, None] + k[None, :] * cell).astype(int)
    valid = pos < len(profile)
    vals = np.where(valid, profile[np.minimum(pos, len(profile) - 1)], 0.0)
    lines = np.maximum(valid.sum(axis=1), 1)
    means = vals.sum(axis=1) / lines
    best = int(np.argmax(means))
    mean, std = profile.mean(), profile.std() + 1e-6
    z = (means[best] - mean) / std * np.sqrt(lines[best])
    return float(z), float(means[best] / (mean + 1e-6)), float(offsets[best])


def detect_cell(rgb: np.ndarray, min_cell: float = 2.0):
    """Return (cell, offset_x, offset_y, confidence) or None when no grid is found.

    Takes the RGB as downloaded (backdrop still in place): the knockout edge is ragged
    on soft images and would pull the lattice off the real cell boundaries.
    `min_cell` is the smallest cell that still fits the content on the target canvas -
    it keeps the search off finer lattices such as the 8 px JPEG block grid.
    """
    h, w = rgb.shape[:2]
    img = rgb.astype(np.float32)
    px, py = edge_profile(img, 1), edge_profile(img, 0)
    if px.max() <= 0 or py.max() <= 0:
        return None
    min_cell = max(2.0, min_cell)
    max_cell = min(w, h) / 4.0
    if max_cell < min_cell:
        return None

    def score(cell):
        return line_score(px, cell)[0] + line_score(py, cell)[0]

    def refine(cell):
        local = np.linspace(cell * 0.96, cell * 1.04, 81)
        local = local[local >= min_cell]
        return float(local[int(np.argmax([score(c) for c in local]))])

    span = max(w, h)
    cells = span / np.arange(span / max_cell, span / 2.0 + 0.25, 0.25)
    cells = cells[cells >= min_cell]
    if not len(cells):
        return None
    best = refine(float(cells[int(np.argmax([score(c) for c in cells]))]))
    for div in (4, 3, 2):                                    # a multiple of the true cell?
        if best / div >= min_cell:
            sub = refine(best / div)
            if score(sub) >= 0.7 * score(best):
                best = sub
                break

    _, rx, ox = line_score(px, best)
    _, ry, oy = line_score(py, best)
    return best, ox, oy, min(rx, ry)


def cell_edges(length: int, cell: float, offset: float) -> list:
    """Integer (start, stop) spans of the grid cells along one axis."""
    k0 = int(np.floor(-offset / cell))
    k1 = int(np.ceil((length - offset) / cell))
    spans = []
    for k in range(k0, k1):
        a = max(0.0, offset + k * cell)
        b = min(float(length), offset + (k + 1) * cell)
        if b - a >= 0.5 * cell:
            spans.append((a, b))
    return spans


def vote(block: np.ndarray):
    """Most common colour of an RGBA block, or None when the block is mostly transparent."""
    px = block.reshape(-1, 4)
    solid = px[:, 3] >= 128
    if solid.sum() * 2 < len(px):
        return None
    rgb = px[solid][:, :3]
    q = (rgb >> 3).astype(np.int32)
    keys = (q[:, 0] << 10) | (q[:, 1] << 5) | q[:, 2]
    vals, counts = np.unique(keys, return_counts=True)
    members = rgb[keys == vals[int(np.argmax(counts))]]
    return np.median(members, axis=0).astype(np.uint8)


def downscale(rgba: np.ndarray, xs: list, ys: list) -> np.ndarray:
    out = np.zeros((len(ys), len(xs), 4), dtype=np.uint8)
    for j, (y0, y1) in enumerate(ys):
        ya, yb = inner(y0, y1)
        for i, (x0, x1) in enumerate(xs):
            xa, xb = inner(x0, x1)
            colour = vote(rgba[ya:yb, xa:xb])
            if colour is not None:
                out[j, i, :3] = colour
                out[j, i, 3] = 255
    return out


def inner(a: float, b: float) -> tuple:
    """Central half of a cell span - skips the soft edges between cells."""
    q = (b - a) / 4.0
    lo = int(np.floor(a + q))
    hi = max(lo + 1, int(np.ceil(b - q)))
    return lo, hi


# ---------------------------------------------------------------------------
# quantise
# ---------------------------------------------------------------------------

def nearest(colours: np.ndarray, palette: np.ndarray) -> np.ndarray:
    d = ((colours[:, None, :].astype(np.float32) - palette[None, :, :]) ** 2).sum(axis=2)
    return palette[np.argmin(d, axis=1)]


def kmeans_palette(colours: np.ndarray, n: int) -> np.ndarray:
    uniq, counts = np.unique(colours, axis=0, return_counts=True)
    if len(uniq) <= n:
        return uniq.astype(np.float32)
    pts, wts = uniq.astype(np.float32), counts.astype(np.float32)
    centres = [pts[int(np.argmax(wts))]]
    for _ in range(n - 1):                                   # farthest-point init
        d = np.min([((pts - c) ** 2).sum(axis=1) for c in centres], axis=0)
        centres.append(pts[int(np.argmax(d * wts))])
    centres = np.array(centres)
    for _ in range(20):
        label = np.argmin(((pts[:, None] - centres[None]) ** 2).sum(axis=2), axis=1)
        for i in range(n):
            sel = label == i
            if sel.any():
                centres[i] = (pts[sel] * wts[sel, None]).sum(axis=0) / wts[sel].sum()
    return np.rint(centres)


# ---------------------------------------------------------------------------
# grid export
# ---------------------------------------------------------------------------

AUTO_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


def write_grid(canvas: np.ndarray, path: str, palette, chars):
    """Write the 1x result as a palette-indexed grid JSON ("." = transparent)."""
    names = {}
    if palette is not None and chars:
        if len(chars) != len(palette) or "." in chars or len(set(chars)) != len(chars):
            raise SystemExit(f"--chars needs {len(palette)} distinct characters (no '.'), "
                             f"one per --palette colour; got {len(chars)}.")
        names = {tuple(int(v) for v in rgb): ch for rgb, ch in zip(palette, chars)}
    spare = [ch for ch in AUTO_CHARS if ch not in names.values()]
    rows = []
    for line in canvas:
        row = ""
        for r, g, b, a in line.tolist():
            if a == 0:
                row += "."
                continue
            if (r, g, b) not in names:
                if not spare:
                    raise SystemExit("Too many colours for a grid - pass --palette or --colors.")
                names[(r, g, b)] = spare.pop(0)
            row += names[(r, g, b)]
        rows.append(row)
    used = set("".join(rows))
    data = {"palette": {".": None,
                        **{ch: "#%02x%02x%02x" % rgb for rgb, ch in names.items() if ch in used}},
            "rows": rows}
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)
        fh.write("\n")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Snap an AI 'pixel art' image to a true pixel grid.")
    ap.add_argument("input", help="Source image (raw download)")
    ap.add_argument("--size", required=True, type=parse_size,
                    help="Target canvas in sprite pixels, WxH or a single number (e.g. 32x32)")
    ap.add_argument("--out", default=None,
                    help="Output 1x PNG (default: <input stem>-pixel.png)")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--palette", type=parse_palette, default=None,
                       help='Comma-separated hex list to snap to, e.g. "#1a1c2c,#b13e53"')
    group.add_argument("--colors", type=int, default=None,
                       help="Reduce to N colours (k-means) when no palette is given")
    ap.add_argument("--scale", type=int, default=8,
                    help="Integer upscale factor for the @Nx copy (default 8)")
    ap.add_argument("--tolerance", type=int, default=32,
                    help="Per-channel tolerance for the background flood fill (default 32)")
    ap.add_argument("--keep-bg", action="store_true",
                    help="Skip the background knockout and auto-crop (scenes, tiles)")
    ap.add_argument("--grid-out", default=None,
                    help="Also write an editable grid JSON for render.py / lint.py")
    ap.add_argument("--chars", default=None,
                    help="Grid characters for --palette, one per colour in the same order "
                         "(default: a-z, A-Z, 0-9 by first use)")
    args = ap.parse_args()

    if args.scale < 1:
        ap.error("--scale must be >= 1")
    if args.colors is not None and args.colors < 1:
        ap.error("--colors must be >= 1")

    tw, th = args.size
    rgba = np.array(Image.open(args.input).convert("RGBA"))

    # 1-2. knockout + crop
    if args.keep_bg:
        rgba[..., 3] = np.where(rgba[..., 3] >= 128, 255, 0)
    else:
        rgba[..., 3] = knockout(rgba, args.tolerance)
    ys, xs = np.where(rgba[..., 3] > 0)
    if not len(xs):
        raise SystemExit("Nothing left after the background knockout - lower --tolerance "
                         "or use --keep-bg.")
    rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    source_rgb = rgba[..., :3].copy()
    rgba[rgba[..., 3] == 0] = 0
    h, w = rgba.shape[:2]

    # 3. cell size
    fit = max(w / tw, h / th, 1.0)
    how = "requested size"
    cell, ox, oy = fit, 0.0, 0.0
    if w <= tw and h <= th:
        how = "already 1x"
    else:
        found = detect_cell(source_rgb, fit * 0.97)
        if found and found[3] >= 1.4:
            nx, ny = len(cell_edges(w, found[0], found[1])), len(cell_edges(h, found[0], found[2]))
            if nx <= tw and ny <= th:
                cell, ox, oy = found[0], found[1], found[2]
                how = "detected"
            else:
                print(f"Note: detected grid {nx}x{ny} (cell {found[0]:.2f} px) exceeds "
                      f"{tw}x{th} - fitting to the requested size instead.")

    # 4. downscale by mode
    col_spans, row_spans = cell_edges(w, cell, ox), cell_edges(h, cell, oy)
    small = downscale(rgba, col_spans[:tw], row_spans[:th])

    # 5-6. quantise, binary alpha
    solid = small[..., 3] > 0
    if solid.any():
        palette = args.palette
        if palette is None and args.colors:
            palette = kmeans_palette(small[solid][:, :3], args.colors)
        if palette is not None:
            small[solid, :3] = nearest(small[solid][:, :3], palette).astype(np.uint8)
    small[~solid] = 0

    # 7. pad / centre
    sh, sw = small.shape[:2]
    canvas = np.zeros((th, tw, 4), dtype=np.uint8)
    x0, y0 = (tw - sw) // 2, (th - sh) // 2
    canvas[y0:y0 + sh, x0:x0 + sw] = small

    # 8. write
    out = args.out or f"{os.path.splitext(args.input)[0]}-pixel.png"
    stem = os.path.splitext(out)[0]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    big_path = f"{stem}@{args.scale}x.png"
    img = Image.fromarray(canvas, "RGBA")
    img.save(out)
    img.resize((tw * args.scale, th * args.scale), Image.NEAREST).save(big_path)

    opaque = canvas[canvas[..., 3] > 0][:, :3]
    n_colours = len(np.unique(opaque, axis=0)) if len(opaque) else 0
    print(f"Cell: {cell:.2f} px ({how})  content: {sw}x{sh}")
    print(f"Size: {tw}x{th}  colours: {n_colours}  "
          f"alpha values: {sorted(np.unique(canvas[..., 3]).tolist())}")
    print(f"1x: {out}")
    print(f"{args.scale}x: {big_path}")

    if args.grid_out:
        write_grid(canvas, args.grid_out, args.palette, args.chars)
        print(f"grid: {args.grid_out}")


if __name__ == "__main__":
    main()
