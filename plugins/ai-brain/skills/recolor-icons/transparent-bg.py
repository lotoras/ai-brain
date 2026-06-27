"""Knock out a white / near-white background, making it transparent.

Usage:
    python transparent-bg.py <file-or-folder>

Alpha is derived from inverse luminance (white -> transparent, dark -> opaque),
so anti-aliased edges are preserved. The original (dark) line color is kept, so
the result is ready to use AS-IS ("leave it dark") or to feed into recolor.py /
recolor-solid.py. Output: ``<name>-transparent.png``.

A single explicitly-passed file is ALWAYS processed. In folder mode, files
already ending in ``-transparent`` are skipped so re-runs don't re-key this
script's own output.

Why this exists: ChatGPT's "full size" downloads are flattened onto near-white
(alpha 255 everywhere) and Gemini renders icons on white — so recoloring without
this step would gradient/flood the whole square and the icon would vanish.
"""
from __future__ import annotations
import sys
from pathlib import Path
from PIL import Image
import numpy as np

OWN = '-transparent'


def debg(src: Path, dst: Path) -> None:
    im = Image.open(src).convert('RGBA')
    a = np.asarray(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    existing = a[..., 3]
    # Already mostly transparent? keep it. Else key out the bright background.
    if (existing > 16).mean() < 0.5 and existing.min() < 250:
        alpha = existing
    else:
        alpha = np.clip(255.0 - lum, 0, 255)
    out = a.copy()
    out[..., 3] = alpha
    Image.fromarray(out.astype(np.uint8), 'RGBA').save(dst)
    frac = float((alpha > 16).mean())
    print(f"  wrote {dst}  opaque_fraction={frac:.3f}")


def main(argv) -> None:
    if not argv:
        raise SystemExit("usage: transparent-bg.py <file-or-folder>")
    p = Path(argv[0])
    if p.is_file():
        debg(p, p.with_name(p.stem + OWN + p.suffix))
        return
    if not p.is_dir():
        raise SystemExit(f"not a file or folder: {p}")
    for f in sorted(p.glob('*.png')):
        if f.stem.endswith(OWN):           # don't re-key our own output
            continue
        debg(f, f.with_name(f.stem + OWN + f.suffix))


if __name__ == '__main__':
    main(sys.argv[1:])
