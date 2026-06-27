"""Recolor PNG icons with a diagonal GRADIENT (opt-in, only when the user asks
for a gradient).

Usage:
    python recolor.py <file-or-folder> [startHex endHex]

Endpoints default to ``#006b6e`` (bottom-left) -> ``#a8d680`` (top-right, UPD
mid-green). Each opaque pixel is mapped along the bottom-left -> top-right
diagonal of the icon's bounding box, so monochrome icons and existing gradients
both produce a consistent look. Alpha / anti-aliasing preserved. Output is
written next to each source as ``<name>-gradient.png``.

A single explicitly-passed file is ALWAYS processed (even a ``-transparent`` one —
that is the normal input). In folder mode, files already ending in ``-gradient``
are skipped so re-runs don't re-process this script's own output.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image
import numpy as np

PETROL = '#006b6e'   # bottom-left
WG_MID = '#a8d680'   # top-right
OWN = '-gradient'


def hex2rgb(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def recolor(src: Path, dst: Path, color_a: str = PETROL, color_b: str = WG_MID) -> None:
    im = np.array(Image.open(src).convert('RGBA'))
    H, W, _ = im.shape
    alpha = im[..., 3]

    mask = alpha > 8
    if not mask.any():
        print(f"  skip {src.name}: empty")
        return

    ys, xs = np.where(mask)
    x_min, x_max = xs.min(), xs.max()
    y_min, y_max = ys.min(), ys.max()

    # Diagonal axis bottom-left -> top-right: project (x, -y) onto (1, 1)/sqrt(2)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    proj = (xx - x_min) - (yy - y_max)
    p_min = (x_min - x_min) - (y_max - y_max)         # always 0
    p_max = (x_max - x_min) - (y_min - y_max)
    t = np.clip((proj - p_min) / max(p_max - p_min, 1.0), 0.0, 1.0)

    ca, cb = hex2rgb(color_a), hex2rgb(color_b)
    new_rgb = (1 - t)[..., None] * ca + t[..., None] * cb

    out = np.empty_like(im)
    out[..., :3] = np.clip(new_rgb, 0, 255).astype(np.uint8)
    out[..., 3] = alpha
    Image.fromarray(out, 'RGBA').save(dst)
    print(f"  wrote {dst}")


def main(argv) -> None:
    if not argv:
        raise SystemExit("usage: recolor.py <file-or-folder> [startHex endHex]")
    target = argv[0]
    color_a = argv[1] if len(argv) > 1 else PETROL
    color_b = argv[2] if len(argv) > 2 else WG_MID
    p = Path(target)
    if p.is_file():
        recolor(p, p.with_name(p.stem + OWN + p.suffix), color_a, color_b)
        return
    if not p.is_dir():
        raise SystemExit(f"not a file or folder: {p}")
    for f in sorted(p.glob('*.png')):
        if f.stem.endswith(OWN):           # don't re-process our own output
            continue
        recolor(f, f.with_name(f.stem + OWN + f.suffix), color_a, color_b)


if __name__ == '__main__':
    main(sys.argv[1:])
