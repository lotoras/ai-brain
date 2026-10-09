# Sprite animation rules

Read this before animating a sprite. It holds the rules "Step 4b — Animate" in `SKILL.md`
refers to. They come from animating a set of 64 px characters (drinking, curling, jogging,
overhead press, pull-up).

## 1. Pose, do not redraw

- Animate a sprite that already exists and is approved. Its generator function gets a frame
  index `i`; only joints and group offsets depend on it. Everything else is drawn by the same
  code, so design, palette, canvas and ground line cannot drift between frames.
- **Frame 0 equals the still image**, pixel for pixel (`animate.py --still` checks it). If the
  motion needs a different base pose (walking still → running loop), say so when delivering.
- A sprite that only exists as a hand-typed spec is first moved into a generator on
  `spritekit.py`; check that the generator reproduces the still before animating.
- Limbs are `cap([shoulder, elbow, hand], width)`; animate by interpolating the elbow and hand
  with `lp(a, b, t)`. Whole groups (head, upper body) move through `Sprite.off`.

## 2. Loops

Default: **8 frames, 120 ms per frame**. Fewer than 6 looks like a slide show, more than 8 is
rarely worth the review effort at sprite size.

| Motion | Pose value per frame `i` of `n` | Use for |
|---|---|---|
| Up-down | `u = (1 - cos(2πi/n)) / 2` — 0 → 1 → 0, eased at both ends | curl, press, pull-up, drink |
| Up-down with a hold | `u = min(1, gain · above)` with gain ≈ 1.4 | a pause at the top (drinking) |
| True cycle | `s = sin(2πi/n)`; left side uses `max(0, s)`, right side `max(0, -s)` | walk, run, jog |

Because the pose value returns to its start, the last frame flows into the first. Never end a
loop on a copy of frame 0 — that frame would show twice.

## 3. Budget the motion envelope first

Before animating — ideally before the still is approved — check that **both ends of the
motion fit the canvas**. A pull-up needs the hang below the bar and the chin above it; a press
needs the bar overhead and at the shoulders; a jump needs head room.

If the far end does not fit: shorten the travel, tuck the limbs that would leave the canvas,
or pick a bigger canvas for still and animation together. Do not let parts slide off the
canvas edge.

## 4. Anchors and secondary motion

- Decide what is **fixed**: feet on the ground line, hands on a fixed bar, a machine. Those
  are drawn without offset; the body moves relative to them.
- Body bob is 1 px, 2 px at most. Knees bend by moving the knee joint outward, not by
  shortening the leg shapes.
- Loose things (bag, headphones, ears, tail) follow one frame late or move 1 px the other way
  — that is what makes a loop look alive.
- One-off effects (sweat drops, sparkles) are shown only near the effort end of the motion.

## 5. Layer order is per frame

Draw order that is right for the still is often wrong for another pose:

- The hand goes **over** the prop it holds. An arm drawn after the prop hides it as soon as
  the arm moves across.
- A bar passes behind the head while it is at head height and in front of the chest below
  the chin. Pick the layer per frame from the prop's position.
- A prop must not cross the eyes and mouth on a key pose (top and bottom of the motion).
  In-between frames may cross briefly; name it when delivering.

## 6. Things that break when parts move

- **Rotated thin props** lose their fill to the outline. Keep a rotated prop at least 5 px
  wide and draw it from its axis (centre, angle), not from a fixed rectangle.
- **Details cut by fixed rows** — a wristband as `arm & band(35, 37)` — land on the wrong
  segment when the limb rotates. Tie them to the hand position and clip them to the forearm.
- **A detail hidden in some frames** can remove its colour from that frame's palette;
  `spritekit.write_spec` keeps every outline-map character in the palette for this reason.
- **Shorts and sleeves** are intersections with the limb mask; build them from the moved
  masks, not from the still's coordinates.

## 7. Speed is never baked in

- The deliverable is the **sprite sheet plus its JSON** (`frameWidth`, `frameHeight`,
  `frames`, `defaultFrameMs`, `loop`). The player picks the frame as
  `floor(clock / defaultFrameMs) % frames`, with `clock += elapsed × speed` — changing the
  speed then never makes the animation jump.
- The GIF is a fixed-speed preview only. Pillow merges identical neighbouring frames in a GIF
  into one longer frame; the sheet keeps them.
- Offer the HTML preview (`animate.py --html`) so the user can judge speed themselves.

## 8. Review

- `Read` the contact sheet `<slug>-anim-frames.png` — all frames side by side. Check per
  frame: limbs attached, prop visible, nothing clipped, face readable; and across frames:
  steps between neighbours are even, frame n-1 to frame 0 is no bigger than any other step.
- Lint **every** frame; report the total.
- You cannot watch playback. Say that the timing feel is unverified unless the preview page
  was actually opened in a browser.
- Apply feedback to the pose parameters of one sprite and regenerate only that one.
