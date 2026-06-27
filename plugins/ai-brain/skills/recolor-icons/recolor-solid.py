"""Recolor PNG icons to a single FLAT color (the default recolor mode).

Usage:
    python recolor-solid.py <file-or-folder> [color]

``color`` is an optional hex (``#rrggbb`` or ``rrggbb``); if omitted it defaults
to ``#006b6e`` (UPD Petrol). Every opaque pixel's RGB is replaced with the color;
alpha (including anti-aliasing) is preserved verbatim. Output is written next to
each source as ``<name>-solid.png``.

A single explicitly-passed file is ALWAYS processed (even a ``-transparent`` one —
that is the normal input). In folder mode, files already ending in ``-solid`` are
skipped so re-runs don't re-flatten this script's own output.

NOTE: only recolor when the user asked for a color. With no color requested,
leave the icon dark (use transparent-bg.py only). See SKILL.md decision tree.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image
import numpy as np

DEFAULT = '#006b6e'   # UPD Petrol — used only when no color is passed
OWN = '-solid'


def hex2rgb(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.uint8)


def recolor(src: Path, dst: Path, color: str) -> None:
    im = np.array(Image.open(src).convert('RGBA'))
    alpha = im[..., 3]
    if not (alpha > 0).any():
        print(f"  skip {src.name}: empty")
        return
    rgb = hex2rgb(color)
    out = np.empty_like(im)
    out[..., 0] = rgb[0]
    out[..., 1] = rgb[1]
    out[..., 2] = rgb[2]
    out[..., 3] = alpha
    Image.fromarray(out, 'RGBA').save(dst)
    print(f"  wrote {dst}")


def main(argv) -> None:
    if not argv:
        raise SystemExit("usage: recolor-solid.py <file-or-folder> [color]")
    target = argv[0]
    color = argv[1] if len(argv) > 1 else DEFAULT
    p = Path(target)
    if p.is_file():
        recolor(p, p.with_name(p.stem + OWN + p.suffix), color)
        return
    if not p.is_dir():
        raise SystemExit(f"not a file or folder: {p}")
    for f in sorted(p.glob('*.png')):
        if f.stem.endswith(OWN):           # don't re-process our own output
            continue
        recolor(f, f.with_name(f.stem + OWN + f.suffix), color)


if __name__ == '__main__':
    main(sys.argv[1:])
