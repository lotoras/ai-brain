"""
stop-animation / scripts / flatten.py

Convex-hull matte of the subject + border-connected flood fill of the backdrop.
Replaces the backdrop with either a flat hex color or full transparency.

Modes
-----
--hex "#RRGGBB"   Flat-fill backdrop to the exact hex.
                  Output: RGB WebP frames + JPEG poster/final  (tschumi default)

--transparent     Set backdrop alpha = 0, keep subject RGB.
                  Output: RGBA WebP frames + PNG poster/final  (alpha-preserving)

How the matte works
-------------------
The backdrop is low-saturation and bright; the subject is colourful/dark. But
the subject's white interior (pages, packaging) is also low-sat+bright, so a
pure colour test would erase it. Fix: take the CONVEX HULL of the subject's
coloured/dark pixels as the whole-subject footprint (that hull encloses the
white interior), then flat-fill only the BORDER-CONNECTED backdrop OUTSIDE that
hull. AI watermarks sit on the backdrop and are filled over automatically.

Requires: Pillow, NumPy, SciPy
Install:  pip install pillow numpy scipy imageio-ffmpeg

Usage:
  python flatten.py --workdir DIR --out DIR --end-frame N
                    (--hex "#F1EADA" | --transparent)
                    [--n-out N] [--sat-t 0.16] [--lum-t 100]
"""

import argparse
import glob
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from scipy.spatial import ConvexHull


# ---------------------------------------------------------------------------
# matte helpers
# ---------------------------------------------------------------------------

def border_connected(cand: np.ndarray) -> np.ndarray:
    """BFS flood fill from the four border edges, staying within `cand` mask."""
    seeds = np.zeros_like(cand)
    seeds[0,  :] = cand[0,  :]
    seeds[-1, :] = cand[-1, :]
    seeds[:,  0] = cand[:,  0]
    seeds[:, -1] = cand[:, -1]
    return ndimage.binary_propagation(seeds, mask=cand)


def backdrop_mask(arr: np.ndarray, sat_t: float, lum_t: float) -> np.ndarray:
    """
    Return a float32 [0, 1] mask at full resolution.
    1.0  = backdrop (safe to replace)
    0.0  = subject  (keep as-is)

    Algorithm:
      1. Downsample to 640×360 for speed.
      2. Mark backdrop-like pixels (low sat & bright).
      3. Find subject core (coloured/dark pixels) via binary_opening.
      4. Build the convex hull of core → full subject footprint (incl. white interior).
      5. Dilate hull slightly to protect subject edges.
      6. Backdrop = border-connected backdrop-like pixels NOT in the hull.
      7. Upsample the mask back to full resolution + Gaussian blur to feather edges.
    """
    h, w = arr.shape[:2]
    # scale the longest side to 640, preserving aspect (handles portrait and landscape)
    scale = 640 / max(h, w)
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    small = np.asarray(Image.fromarray(arr).resize((sw, sh)), dtype=np.float32)
    R, G, B = small[..., 0], small[..., 1], small[..., 2]
    mx  = np.maximum(np.maximum(R, G), B)
    mn  = np.minimum(np.minimum(R, G), B)
    L   = 0.299 * R + 0.587 * G + 0.114 * B
    sat = (mx - mn) / (mx + 1e-6)

    cand = (sat < sat_t) & (L > lum_t)          # backdrop-like (incl. white subject interior)

    # subject core: coloured/dark pixels; binary_opening removes noise
    core = ndimage.binary_opening(~cand, structure=np.ones((3, 3)))

    book = np.zeros_like(cand, dtype=bool)
    ys, xs = np.where(core)
    if len(xs) >= 20:
        pts = np.column_stack([xs, ys])
        try:
            hull = ConvexHull(pts)
            poly = [tuple(p) for p in pts[hull.vertices]]
            mimg = Image.new("L", (cand.shape[1], cand.shape[0]), 0)
            ImageDraw.Draw(mimg).polygon(poly, fill=255)
            book = np.asarray(mimg) > 0
        except Exception:
            # degenerate hull (e.g. collinear points) — fall back to closing
            book = ndimage.binary_closing(core, np.ones((9, 9)), iterations=2)

    book = ndimage.binary_dilation(book, iterations=3)  # protect the subject edge

    bg = border_connected(cand) & ~book

    # upsample to full resolution + feather
    m = Image.fromarray((bg * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
    m = m.filter(ImageFilter.GaussianBlur(2.5))
    return np.asarray(m, dtype=np.float32) / 255.0


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Replace the backdrop with a flat hex colour or full transparency."
    )
    ap.add_argument("--workdir",     required=True,
                    help="Working directory (reads <workdir>/_raw/f_*.png)")
    ap.add_argument("--out",         required=True,
                    help="Output directory for WebP frames + poster/final")
    ap.add_argument("--end-frame",   type=int, required=True,
                    help="Use source frames 0 .. end-frame-1 (exclusive upper bound)")
    ap.add_argument("--n-out",       type=int, default=132,
                    help="Number of output WebP frames to emit (default: 132)")
    ap.add_argument("--hex",         default=None,
                    help='Exact background hex, e.g. "#F1EADA" (flat-fill mode)')
    ap.add_argument("--transparent", action="store_true",
                    help="Knock out backdrop to alpha=0; save RGBA WebP + PNG poster/final")
    ap.add_argument("--sat-t",       type=float, default=0.16,
                    help="Saturation threshold for backdrop detection (default 0.16)")
    ap.add_argument("--lum-t",       type=float, default=100.0,
                    help="Luminance threshold for backdrop detection (default 100)")
    args = ap.parse_args()

    if not args.hex and not args.transparent:
        ap.error("Provide either --hex '#RRGGBB' or --transparent.")
    if args.hex and args.transparent:
        ap.error("Provide only one of --hex or --transparent, not both.")

    raw = os.path.join(args.workdir, "_raw")
    os.makedirs(args.out, exist_ok=True)
    for f in glob.glob(os.path.join(args.out, "*")):
        os.remove(f)

    files = sorted(glob.glob(os.path.join(raw, "f_*.png")))[: args.end_frame]
    if not files:
        raise SystemExit(f"No frames found in {raw} — run extract.py first.")

    idx = np.linspace(0, len(files) - 1, args.n_out).round().astype(int)
    sel = [files[i] for i in idx]
    print(f"Source frames 0..{args.end_frame - 1}  ->  {args.n_out} output frames")

    # resolve hex target
    target: np.ndarray | None = None
    if args.hex:
        h = args.hex.lstrip("#")
        if len(h) != 6:
            ap.error(f"Invalid hex value: {args.hex!r}")
        target = np.array([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)],
                          dtype=np.float32)
        print(f"Mode: hex  target RGB = {target.astype(int).tolist()}")
    else:
        print("Mode: transparent  (RGBA WebP + PNG poster/final)")

    print()
    for n, fp in enumerate(sel):
        arr  = np.asarray(Image.open(fp).convert("RGB"))  # uint8; no redundant float cast
        mask = backdrop_mask(arr, args.sat_t, args.lum_t)  # [0,1] 1=backdrop

        out_path = os.path.join(args.out, f"frame_{n:04d}.webp")

        if args.hex:
            # flat-fill: lerp backdrop pixels toward target, keep subject
            flt     = arr.astype(np.float32)  # float only where the math needs it
            out_rgb = mask[..., None] * target[None, None, :] + (1.0 - mask[..., None]) * flt
            Image.fromarray(np.clip(out_rgb, 0, 255).astype(np.uint8)).save(
                out_path, quality=90, method=6)
        else:
            # transparent: subject pixels keep RGB, backdrop alpha → 0 (no float array needed)
            alpha = np.clip((1.0 - mask) * 255, 0, 255).astype(np.uint8)
            rgba  = np.dstack([arr, alpha])
            Image.fromarray(rgba, "RGBA").save(out_path, quality=90, method=6)

        if n % max(1, args.n_out // 10) == 0:
            print(f"  {n + 1}/{args.n_out} …")

    print()

    # --- poster / final ---
    first_img = Image.open(os.path.join(args.out, "frame_0000.webp"))
    last_img  = Image.open(os.path.join(args.out, f"frame_{args.n_out - 1:04d}.webp"))

    if args.hex:
        first_img.convert("RGB").save(os.path.join(args.out, "poster.jpg"), quality=92)
        last_img.convert("RGB").save( os.path.join(args.out, "final.jpg"),  quality=92)
        print("Saved poster.jpg and final.jpg")
    else:
        first_img.save(os.path.join(args.out, "poster.png"))
        last_img.save( os.path.join(args.out, "final.png"))
        print("Saved poster.png and final.png (RGBA)")

    # --- corner verification ---
    v0 = np.asarray(first_img)
    print()
    if args.hex:
        corner = v0[6, 6, :3].tolist()
        print(f"Corner pixel (6,6):   {corner}")
        print(f"Target:               {target.astype(int).tolist()}")
        print(f"Delta (±1 from WebP rounding is normal): "
              f"{[abs(corner[i] - int(target[i])) for i in range(3)]}")
    else:
        # RGBA WebP: shape (H, W, 4)
        if v0.ndim == 3 and v0.shape[2] == 4:
            corner_alpha = int(v0[6, 6, 3])
        else:
            corner_alpha = "n/a (unexpected mode)"
        print(f"Corner pixel (6,6) alpha: {corner_alpha}  (expect 0 = fully transparent backdrop)")

    # --- summary ---
    sz = sum(os.path.getsize(os.path.join(args.out, f))
             for f in os.listdir(args.out)) / 1e6
    print(f"\nTotal output: {args.n_out} WebP + poster/final -> {sz:.1f} MB  in  {args.out}")


if __name__ == "__main__":
    main()
