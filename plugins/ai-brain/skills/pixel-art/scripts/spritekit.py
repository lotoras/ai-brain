#!/usr/bin/env python3
"""Drawing helpers for generator scripts that emit pixel-art shape specs.

Import this from a small per-task generator instead of typing large shape specs by hand:

    import sys; sys.path.insert(0, r"<skill>/scripts")
    from spritekit import *

    canvas(64, 64)
    s = Sprite()
    s.add(E([19, 8, 44, 27]), ("w", "m", "l", None))      # head: fill, edge, shade, light
    s.add(cap([(22, 32), (15, 39), (12, 28)], 7), ("a", "A", None, "m"))   # arm
    write_spec(s, {"w": "m", "a": "A"}, PALETTE, "pixel-art/panda.shapes.json")

Masks are boolean numpy arrays of the canvas; combine them with `|`, `&`, `~`.
A material is `(fill, edge, shade, light)` in palette characters; `None` skips that tone.
"""
import json

import numpy as np
from PIL import Image, ImageDraw

W = H = 64


def canvas(w, h):
    """Set the canvas size for all masks created afterwards."""
    global W, H
    W, H = w, h


# ---- masks -------------------------------------------------------------------------------
def _mask(fn):
    img = Image.new("L", (W, H), 0)
    fn(ImageDraw.Draw(img))
    return np.array(img, dtype=bool)


def E(xy):
    """Ellipse, xy = [x0, y0, x1, y1] inclusive."""
    return _mask(lambda d: d.ellipse(xy, fill=1))


def R(xy):
    """Rectangle, xy = [x0, y0, x1, y1] inclusive."""
    return _mask(lambda d: d.rectangle(xy, fill=1))


def P(points):
    """Filled polygon."""
    return _mask(lambda d: d.polygon([tuple(p) for p in points], fill=1, outline=1))


def L(points, width=1):
    """Polyline."""
    return _mask(lambda d: d.line([tuple(p) for p in points], fill=1, width=width))


def circ(x, y, d):
    """Circle of diameter d centred on (x, y)."""
    x0, y0 = x - d // 2, y - d // 2
    return E([x0, y0, x0 + d - 1, y0 + d - 1])


def cap(points, w):
    """Round-ended thick polyline: limbs (shoulder, elbow, hand), ears, tails, feathers."""
    m = L(points, w)
    for x, y in points:
        m |= circ(x, y, w)
    return m


def band(y0, y1):
    """Full-width horizontal band, rows y0..y1."""
    return R([0, y0, W - 1, y1])


def flip(m):
    """Mirror across the vertical centre."""
    return m[:, ::-1]


def both(m):
    """The mask plus its mirror image."""
    return m | m[:, ::-1]


def inner(m):
    """The mask without its 1 px border."""
    p = np.pad(m, 1)
    return m & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]


def mv(m, dx, dy):
    """Move a mask by (dx, dy); pixels leaving the canvas are dropped."""
    out = np.zeros_like(m)
    ys, xs = np.where(m)
    ys, xs = ys + dy, xs + dx
    ok = (ys >= 0) & (ys < H) & (xs >= 0) & (xs < W)
    out[ys[ok], xs[ok]] = True
    return out


def lp(a, b, t):
    """Point between a and b at t (0..1), rounded to whole pixels. For animated joints."""
    return (int(round(a[0] + (b[0] - a[0]) * t)), int(round(a[1] + (b[1] - a[1]) * t)))


def patch(mask, fill, ref=None, edge=None):
    """A `rows` shape for the mask; pixels on the border of `ref` get `edge` instead of `fill`."""
    ys, xs = np.where(mask)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    border = (ref & ~inner(ref)) if ref is not None else np.zeros_like(mask)
    data = ["".join(" " if not mask[y, x] else (edge if border[y, x] else fill)
                    for x in range(x0, x1 + 1)) for y in range(y0, y1 + 1)]
    return {"type": "rows", "xy": [int(x0), int(y0)], "rows": data}


# ---- sprite ------------------------------------------------------------------------------
class Sprite:
    """Collects shapes in draw order. Set `off = (dx, dy)` to move a group (head, upper body)."""

    def __init__(self):
        self.shapes, self.post = [], []
        self.off = (0, 0)

    def add(self, mask, mat, d=1):
        """Outlined, cel-shaded blob: edge ring, upper-left light rim, lower-right shadow.

        `d` is the shadow thickness in pixels (2 for big forms like a head or torso).
        """
        fill, edge, shade, light = mat
        m = mv(mask, *self.off)
        if not m.any():
            return
        self.shapes.append(patch(m, fill, ref=m, edge=edge))
        im = inner(m)
        if light:
            self._fill(im & ~mv(im, 1, 1), light)
        if shade:
            self._fill(im & ~mv(im, -d, -d), shade)

    def _fill(self, mask, ch):
        if mask.any():
            self.shapes.append(patch(mask, ch))

    def fill(self, mask, ch):
        """Flat patch without an edge (belly, stripe, label)."""
        self._fill(mv(mask, *self.off), ch)

    def edge(self, mask, fill, ref, edge):
        """Part of a bigger form (`ref`) in another colour, outlined where it meets ref's border:
        a headband on a head, a sleeve on an arm."""
        m = mv(mask, *self.off)
        if m.any():
            self.shapes.append(patch(m, fill, ref=mv(ref, *self.off), edge=edge))

    def px(self, points, ch):
        ox, oy = self.off
        pts = [[x + ox, y + oy] for x, y in points if 0 <= x + ox < W and 0 <= y + oy < H]
        if pts:
            self.shapes.append({"type": "pixel", "points": pts, "fill": ch})

    def rows(self, xy, data, post=False):
        """Literal rows of palette characters (space = leave unchanged). `post=True` draws after
        the automatic outline pass."""
        (self.post if post else self.shapes).append(
            {"type": "rows", "xy": [xy[0] + self.off[0], xy[1] + self.off[1]], "rows": data})

    def mark(self, kind, xy, fill, part):
        """A labelled plain shape for the proportion report (head, torso, arm, leg); draw the
        real form over it afterwards."""
        ox, oy = self.off
        self.shapes.append({"type": kind, "xy": [xy[0] + ox, xy[1] + oy, xy[2] + ox, xy[3] + oy],
                            "fill": fill, "part": part})

    def eyes(self, xl, y, glint="w", pupil="k"):
        """Two mirrored 3x3 eyes with a glint in the upper-left pixel."""
        for x in (xl, W - 1 - xl - 2):
            self.rows([x, y], [glint + pupil * 2, pupil * 3, pupil * 3])


def used_chars(sprite, outline):
    chars = set(outline) | set(outline.values())
    for sh in sprite.shapes + sprite.post:
        if sh["type"] == "rows":
            chars.update(c for row in sh["rows"] for c in row if c != " ")
        else:
            chars.add(sh["fill"])
    return chars


def write_spec(sprite, outline, palette, path, budget=None):
    """Write a build.py shape spec. `palette` is the style's full {char: hex} map; only the
    characters this sprite uses are written, always including every outline-map character
    (build.py rejects an outline entry whose character is missing from the palette)."""
    chars = used_chars(sprite, outline)
    spec = {"canvas": [W, H],
            "palette": {".": None, **{k: v for k, v in palette.items() if k in chars}},
            "outline": outline}
    if budget:
        spec["budget"] = budget
    spec["shapes"], spec["post"] = sprite.shapes, sprite.post
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(spec, fh)
    return spec
