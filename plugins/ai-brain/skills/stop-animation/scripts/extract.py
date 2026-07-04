"""
stop-animation / scripts / extract.py

Dump every frame from a video file, then print:
  - Per-frame motion magnitude (to pick the settle/end point)
  - Corner backdrop color sample
  - Crop check (does the subject touch the top edge? => unfixable if so)
  - Settle suggestion (END_FRAME value for flatten.py)

Requires: imageio-ffmpeg, Pillow, NumPy
Install:  pip install imageio-ffmpeg pillow numpy

Usage:
  python extract.py --video PATH --workdir DIR [--stride 12]

Output frames land in <workdir>/_raw/f_0001.png ...
"""

import argparse
import glob
import os
import subprocess

import imageio_ffmpeg
import numpy as np
from PIL import Image


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def corners(arr, m=12):
    """Average RGB of the four 12×12 corner patches."""
    return np.concatenate([
        arr[:m,  :m ].reshape(-1, 3),
        arr[:m,  -m:].reshape(-1, 3),
        arr[-m:, :m ].reshape(-1, 3),
        arr[-m:, -m:].reshape(-1, 3),
    ]).mean(0)


def first_subject_row(arr):
    """
    Return the first row that contains subject pixels.
    Subject = colourful (sat > 0.20) OR dark (L < 105).
    Uses saturation/darkness — NOT difference from a corner pixel —
    because the soft studio shadow breaks difference tests.
    """
    R, G, B = arr[..., 0].astype(np.float32), arr[..., 1].astype(np.float32), arr[..., 2].astype(np.float32)
    mx  = np.maximum.reduce([R, G, B])
    mn  = np.minimum.reduce([R, G, B])
    L   = 0.299 * R + 0.587 * G + 0.114 * B
    sat = (mx - mn) / (mx + 1e-6)
    subject = (sat > 0.20) | (L < 105)
    rows = subject.sum(axis=1) > 12
    return int(rows.argmax()) if rows.any() else arr.shape[0]


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Extract frames from a video and print motion / settle / crop analysis."
    )
    ap.add_argument("--video",   required=True,
                    help="Path to the input video file (.mp4 etc.)")
    ap.add_argument("--workdir", required=True,
                    help="Working directory; frames are written to <workdir>/_raw/")
    ap.add_argument("--stride",  type=int, default=12,
                    help="Print every Nth frame in the motion table (default: 12)")
    args = ap.parse_args()

    raw = os.path.join(args.workdir, "_raw")
    os.makedirs(raw, exist_ok=True)

    # clear any previous extraction
    for f in glob.glob(os.path.join(raw, "*.png")):
        os.remove(f)

    # --- extract ---
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    print(f"Extracting: {args.video}")
    print(f"Output dir: {raw}")
    subprocess.run(
        [ff, "-y", "-i", args.video, "-vsync", "0",
         os.path.join(raw, "f_%04d.png")],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    files = sorted(glob.glob(os.path.join(raw, "f_*.png")))
    if not files:
        raise SystemExit("No frames extracted — check the video path.")
    print(f"Extracted {len(files)} frames.\n")

    # --- motion + crop table ---
    print(f"{'idx':>4}  {'corner_bg R,G,B':>22}  {'motion':>8}  {'top_row':>8}")
    print("-" * 52)

    motions  = []
    top_rows = []
    prev     = None   # float32 [::8,::8] subsample of previous frame
    c0       = None   # cached corners for frame 0

    for i, fp in enumerate(files):
        a = np.asarray(Image.open(fp).convert("RGB"))  # uint8

        sub    = a[::8, ::8].astype(np.float32)
        motion = 0.0 if prev is None else float(np.abs(sub - prev).mean())
        motions.append(motion)

        top = first_subject_row(a)
        top_rows.append(top)

        if i % args.stride == 0 or i == len(files) - 1:
            c = corners(a)
            print(f"{i:4d}  {c[0]:7.1f},{c[1]:6.1f},{c[2]:6.1f}  {motion:8.2f}  {top:8d}")
            if i == 0:
                c0 = c  # cache frame-0 corners; no re-open needed at the end

        prev = sub

    # --- settle suggestion ---
    print()
    active_frames = [i for i, m in enumerate(motions) if m > 1.5]
    if active_frames:
        last_active = active_frames[-1]
        # short hold: ~12 frames past the last high-motion frame
        settle = min(last_active + 12, len(files) - 1)
        print(f"Motion active: frames {active_frames[0]}–{last_active}")
        print(f"Settle suggestion (END_FRAME): {settle}  "
              f"(last active + 12-frame hold)")
    else:
        print("No high-motion frames found (threshold: motion > 1.5).")

    # --- crop check ---
    min_top = min(top_rows)
    print(f"\nCrop check: closest subject row to top edge = {min_top} px")
    if min_top <= 6:
        print("  WARNING: subject touches the top edge — video is CROPPED.")
        print("  This is unfixable in post. Regenerate with a moderately wider framing.")
    else:
        print(f"  OK: subject clears the top edge by {min_top} px.")

    # --- summary (uses cached frame-0 corners, no re-open) ---
    print(f"\nFrame 0 corner backdrop: RGB = [{c0[0]:.1f}, {c0[1]:.1f}, {c0[2]:.1f}]")
    print(f"Frame dims: {a.shape[1]}×{a.shape[0]} px")  # all frames share the same dims
    print(f"\nTotal frames in _raw: {len(files)}")
    print("Next step: run flatten.py with --end-frame <settle suggestion above>")


if __name__ == "__main__":
    main()
