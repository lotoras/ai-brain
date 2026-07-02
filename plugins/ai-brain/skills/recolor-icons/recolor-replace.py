"""Recolor a TWO-TONE / multi-color icon: replace ONE color, keep the others
(and the transparent background).

Usage:
    python recolor-replace.py <file-or-folder> [newColor] [fromColor] [keepColor]

Unlike recolor-solid.py — which paints EVERY opaque pixel one color, correct only
for a MONOCHROME icon — this remaps a single "ink" color to ``newColor`` while
leaving a second color (e.g. the white glyph/grid) and transparency intact. It is
the right tool for multi-color logos such as the Office icons (green body + white
"X" and table lines).

- ``newColor``  : target hex (``#rrggbb`` or ``rrggbb``), default ``#006b6e`` (UPD Petrol).
- ``fromColor`` : the ink to replace; default ``auto`` = median of the chromatic
                  (saturated) opaque pixels.
- ``keepColor`` : the color anti-aliased edges blend into; default ``auto`` =
                  whichever neutral (white/black) is present, else white. Auto-keep
                  assumes a NEUTRAL second tone — for a chromatic keep (e.g. green +
                  yellow) pass ``keepColor`` explicitly.

Each pixel is projected onto the fromColor -> keepColor axis (0 = ink, 1 = keep)
and remapped to newColor -> keepColor, so anti-aliased ink/keep edges stay clean
and the kept color is untouched. Alpha (including ink<->transparent edges) is
copied verbatim. Output is written next to each source as ``<name>-recolored.png``.

A single explicitly-passed file is ALWAYS processed. In folder mode, files already
ending in ``-recolored`` are skipped so re-runs don't re-process this script's
own output.

NOTE: if the source already has a transparent background, do NOT run
transparent-bg.py first — feed the original straight in. See SKILL.md.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image
import numpy as np

DEFAULT_NEW = '#006b6e'   # UPD Petrol — used only when no new color is passed
OWN = '-recolored'
WHITE = np.array([255.0, 255.0, 255.0], dtype=np.float32)
BLACK = np.array([0.0, 0.0, 0.0], dtype=np.float32)


def hex2rgb(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def detect_ink(rgb: np.ndarray, opaque: np.ndarray) -> np.ndarray:
    """Dominant chromatic color = median of the saturated opaque pixels."""
    mn, mx = rgb.min(axis=2), rgb.max(axis=2)
    chroma = opaque & ((mx - mn) >= 40)
    if chroma.any():
        return np.median(rgb[chroma], axis=0)
    nonwhite = opaque & (mn <= 200)        # grayscale icon -> its dark ink
    if nonwhite.any():
        return np.median(rgb[nonwhite], axis=0)
    return np.median(rgb[opaque], axis=0) if opaque.any() else BLACK


def detect_keep(rgb: np.ndarray, opaque: np.ndarray) -> np.ndarray:
    """Neutral anchor the ink blends into at edges: white, unless black dominates.

    Only near-neutral (low-saturation) pixels vote, so a dark *chromatic* ink can't
    be miscounted as a black keep."""
    mn, mx = rgb.min(axis=2), rgb.max(axis=2)
    neutral = opaque & ((mx - mn) < 40)
    near_white = (neutral & (mn > 200)).sum()
    near_black = (neutral & (mx < 55)).sum()
    return BLACK if near_black > near_white else WHITE


def replace(src: Path, dst: Path, new_hex: str, from_arg: str, keep_arg: str) -> None:
    im = np.array(Image.open(src).convert('RGBA')).astype(np.float32)
    rgb, alpha = im[..., :3], im[..., 3]
    if not (alpha > 0).any():
        print(f"  skip {src.name}: empty")
        return
    opaque = alpha > 200                    # sample solid-core pixels for detection
    if not opaque.any():                    # globally translucent icon -> relax
        opaque = alpha > 8

    new = hex2rgb(new_hex)
    ink = hex2rgb(from_arg) if from_arg != 'auto' else detect_ink(rgb, opaque)
    keep = hex2rgb(keep_arg) if keep_arg != 'auto' else detect_keep(rgb, opaque)
    ink, keep = np.asarray(ink, np.float32), np.asarray(keep, np.float32)

    # Project each pixel onto the ink->keep axis (0 = ink, 1 = keep), remap ink->new.
    axis = keep - ink
    denom = max(float(axis @ axis), 1e-6)   # ink == keep -> numerator is 0, t -> 0
    t = np.clip((rgb @ axis - float(ink @ axis)) / denom, 0.0, 1.0)
    out_rgb = new + t[..., None] * (keep - new)

    out = np.empty(im.shape, np.uint8)
    out[..., :3] = np.clip(out_rgb, 0, 255)
    out[..., 3] = alpha
    Image.fromarray(out, 'RGBA').save(dst)
    print(f"  wrote {dst}  ink={tuple(int(x) for x in ink)} keep={tuple(int(x) for x in keep)}")


def main(argv) -> None:
    if not argv:
        raise SystemExit("usage: recolor-replace.py <file-or-folder> [newColor] [fromColor] [keepColor]")
    target = argv[0]
    new_hex = argv[1] if len(argv) > 1 else DEFAULT_NEW
    from_arg = argv[2] if len(argv) > 2 else 'auto'
    keep_arg = argv[3] if len(argv) > 3 else 'auto'
    p = Path(target)
    if p.is_file():
        replace(p, p.with_name(p.stem + OWN + p.suffix), new_hex, from_arg, keep_arg)
        return
    if not p.is_dir():
        raise SystemExit(f"not a file or folder: {p}")
    for f in sorted(p.glob('*.png')):
        if f.stem.endswith(OWN):           # don't re-process our own output
            continue
        replace(f, f.with_name(f.stem + OWN + f.suffix), new_hex, from_arg, keep_arg)


if __name__ == '__main__':
    main(sys.argv[1:])
