#!/usr/bin/env python3
"""Assemble rendered 1x frames into a looping sprite animation.

    python animate.py --frames f0.png f1.png ... --out pixel-art/<slug>-anim
                      [--frame-ms 120] [--scale 8] [--still pixel-art/<slug>.png]
                      [--html pixel-art/animations.html] [--title "My sprites"]

Writes next to --out:
    <out>.png          sprite sheet, frames side by side at 1x
    <out>@<N>x.png     the same sheet, nearest-neighbour upscale
    <out>.gif          preview loop at <N>x (fixed speed; the sheet is the deliverable)
    <out>.json         frameWidth, frameHeight, frames, defaultFrameMs, loop
    <out>-frames.png   contact sheet on grey for reviewing the poses

--still   reports whether frame 0 equals that image pixel for pixel.
--html    (re)writes a preview page for every *-anim.json in its folder, with a speed slider.
          Can be used alone, without --frames, to refresh the page.
"""
import argparse
import glob
import json
import os
import sys

from PIL import Image

KEY = (255, 0, 255)

HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  body { margin: 0; padding: 24px 16px; background: #3a3c46; color: #d7dbe8; font: 14px/1.4 system-ui, sans-serif; }
  .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 24px; }
  .row { display: flex; gap: 24px; flex-wrap: wrap; }
  figure { margin: 0; text-align: center; }
  .sprite { background-repeat: no-repeat; image-rendering: pixelated; }
  button { font: inherit; padding: 4px 12px; }
</style>
</head>
<body>
<div class="controls">
  <label for="speed">Speed</label>
  <input id="speed" type="range" min="0.25" max="3" step="0.05" value="1">
  <output id="speedOut">1.00x</output>
  <button id="toggle" type="button">Pause</button>
</div>
<div class="row" id="row"></div>
<script>
  const anims = __DATA__;
  const SCALE = 4;
  const row = document.getElementById('row');
  for (const a of anims) {
    const fig = document.createElement('figure');
    a.el = document.createElement('div');
    a.el.className = 'sprite';
    a.el.style.width = a.frameWidth * SCALE + 'px';
    a.el.style.height = a.frameHeight * SCALE + 'px';
    a.el.style.backgroundImage = `url(${a.image})`;
    a.el.style.backgroundSize = `${a.frames * 100}% 100%`;
    const cap = document.createElement('figcaption');
    cap.textContent = a.name;
    fig.append(a.el, cap);
    row.append(fig);
  }
  const speed = document.getElementById('speed');
  const speedOut = document.getElementById('speedOut');
  const toggle = document.getElementById('toggle');
  let playing = true, clock = 0, last = performance.now();
  speed.addEventListener('input', () => { speedOut.textContent = Number(speed.value).toFixed(2) + 'x'; });
  toggle.addEventListener('click', () => { playing = !playing; toggle.textContent = playing ? 'Pause' : 'Play'; });
  function tick(now) {
    // The clock advances by real time x speed, so changing the speed never jumps frames.
    if (playing) clock += (now - last) * Number(speed.value);
    last = now;
    for (const a of anims) {
      const frame = Math.floor(clock / a.defaultFrameMs) % a.frames;
      a.el.style.backgroundPosition = a.frames > 1 ? `${(frame / (a.frames - 1)) * 100}% 0` : '0 0';
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
</script>
</body>
</html>
"""


def save_gif(frames, path, scale, frame_ms):
    """One shared palette for all frames (no colour flicker), transparent background."""
    w, h = frames[0].size
    tall = Image.new("RGB", (w * scale, h * scale * len(frames)), KEY)
    for i, f in enumerate(frames):
        big = f.resize((w * scale, h * scale), Image.NEAREST)
        tall.paste(big, (0, i * h * scale), big)
    pal = tall.convert("P", palette=Image.ADAPTIVE, colors=255)
    flat = pal.getpalette()
    idx = next((j for j in range(len(flat) // 3) if tuple(flat[j * 3:j * 3 + 3]) == KEY), None)
    cells = [pal.crop((0, i * h * scale, w * scale, (i + 1) * h * scale))
             for i in range(len(frames))]
    extra = {} if idx is None else {"transparency": idx}
    cells[0].save(path, save_all=True, append_images=cells[1:], duration=frame_ms, loop=0,
                  disposal=2, **extra)


def contact_sheet(frames, path):
    w, h = frames[0].size
    cols = min(4, len(frames))
    rows = -(-len(frames) // cols)
    sc = max(1, min(8, 1536 // (cols * w)))
    sheet = Image.new("RGBA", (cols * w * sc, rows * h * sc), (58, 60, 70, 255))
    for i, f in enumerate(frames):
        big = f.resize((w * sc, h * sc), Image.NEAREST)
        sheet.alpha_composite(big, ((i % cols) * w * sc, (i // cols) * h * sc))
    sheet.save(path)


def write_html(path, title):
    folder = os.path.dirname(os.path.abspath(path))
    data = []
    for jp in sorted(glob.glob(os.path.join(folder, "*-anim.json"))):
        with open(jp, encoding="utf-8") as fh:
            meta = json.load(fh)
        meta.setdefault("name", os.path.basename(jp)[:-len("-anim.json")])
        data.append(meta)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(HTML.replace("__TITLE__", title).replace("__DATA__", json.dumps(data, indent=1)))
    print(f"Preview: {path} ({len(data)} animation(s))")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", nargs="+", help="1x frame PNGs in playback order")
    ap.add_argument("--out", help="output base path without extension, e.g. pixel-art/hero-anim")
    ap.add_argument("--frame-ms", type=int, default=120, help="default frame duration")
    ap.add_argument("--scale", type=int, default=8, help="upscale of the @Nx sheet and the GIF")
    ap.add_argument("--name", help="display name stored in the JSON")
    ap.add_argument("--still", help="still image that frame 0 should equal")
    ap.add_argument("--html", help="preview page to (re)write")
    ap.add_argument("--title", default="Sprite animation preview")
    args = ap.parse_args()

    if args.frames:
        if not args.out:
            sys.exit("--out is required with --frames")
        frames = [Image.open(p).convert("RGBA") for p in args.frames]
        sizes = {f.size for f in frames}
        if len(sizes) != 1:
            sys.exit(f"Frames differ in size: {sorted(sizes)}")
        w, h = frames[0].size
        sheet = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            sheet.paste(f, (i * w, 0))
        sheet.save(args.out + ".png")
        sheet.resize((sheet.width * args.scale, sheet.height * args.scale),
                     Image.NEAREST).save(f"{args.out}@{args.scale}x.png")
        save_gif(frames, args.out + ".gif", args.scale, args.frame_ms)
        meta = {"image": os.path.basename(args.out) + ".png", "frameWidth": w, "frameHeight": h,
                "frames": len(frames), "defaultFrameMs": args.frame_ms, "loop": True}
        if args.name:
            meta["name"] = args.name
        with open(args.out + ".json", "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=1)
        contact_sheet(frames, args.out + "-frames.png")
        print(f"Animation: {len(frames)} frames of {w}x{h}, {args.frame_ms} ms each -> "
              f"{args.out}.png / @{args.scale}x.png / .gif / .json / -frames.png")
        repeats = [i for i in range(1, len(frames))
                   if frames[i].tobytes() == frames[i - 1].tobytes()]
        if repeats:
            print(f"NOTE: frames {repeats} repeat their predecessor (a hold); the GIF merges "
                  f"them into one longer frame, the sheet keeps them.")
        if args.still:
            still = Image.open(args.still).convert("RGBA")
            same = still.size == frames[0].size and still.tobytes() == frames[0].tobytes()
            print(f"Frame 0 == still: {same}")
    elif not args.html:
        sys.exit("Nothing to do: pass --frames and --out, and/or --html")

    if args.html:
        write_html(args.html, args.title)


if __name__ == "__main__":
    main()
