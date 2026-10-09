---
name: stop-animation
description: Use when the user wants a scroll-driven / looping / hover-triggered stop animation of an object transforming, embeddable in an HTML page. Generates 3 AI keyframe stills (ChatGPT, per-keyframe OpenRouter reroute) → a video via the OpenRouter API (browser Veo fallback) → extracts frames → recolors or knocks out the backdrop → emits a canvas-driven HTML snippet. Do NOT use for existing videos or simple image carousels.
---

# stop-animation — AI-generated object-transformation canvas animation

Turn a described (or partially supplied) object transformation into an embeddable HTML canvas
animation driven by scroll, autoplay loop, or hover/click. Replicates the proven tschumi pipeline:
**3 state stills → Veo transition video → frame extraction → backdrop treatment → HTML snippet**.

All image and video generation is **delegated to the existing `media-gen` skill** (stills via
ChatGPT in the browser, with a per-keyframe reroute to OpenRouter; video via the OpenRouter API
by default, browser Veo at gemini.google.com as fallback). This skill orchestrates; `media-gen` generates.

## When to use / not use
- **Use** for: "animate my product opening", "book flip animation", "object transformation loop",
  "scroll-driven reveal of X changing into Y", "stop-motion style embed for my site".
- **Do NOT use** for: analyzing existing videos, simple cross-fade carousels (no video pipeline
  needed), or raw image generation without the animation pipeline.

## Dependencies

One-time install before running any scripts:
```
pip install pillow numpy scipy imageio-ffmpeg
```
Needed by `scripts/extract.py` (Pillow, NumPy, imageio-ffmpeg) and `scripts/flatten.py` (Pillow,
NumPy, SciPy for the convex-hull matte).

## Ask first — one AskUserQuestion round

Before authoring any prompts, ask the user **two questions in a single message**:

1. **Background treatment** — which do you want?
   - **Transparent** (RGBA WebP — works on any page background; good for overlays)
   - **Specific hex** — paste your page's background color, or share the swatch/screenshot and
     I will sample it with the PIL corner-median technique (never eyeball a hex):
     ```python
     from PIL import Image; import numpy as np
     a = np.asarray(Image.open("swatch.png").convert("RGB"))
     print(np.median(a.reshape(-1, 3), axis=0))   # e.g. [241 234 218] = #F1EADA
     ```

2. **Playback mode** — how should the animation play?
   - **scroll-scrub** — user scrolls through the transformation (tall sticky section)
   - **autoplay loop** — ping-pong loop as soon as images load
   - **hover / click** — animates forward on hover, reverses on leave; click toggles

Record the answers and use them in every downstream step.

---

## Phase 1 — Author prompts

Distilled from the tschumi cover-animation-prompts architecture. Produce **four prompts** and
show them to the user before generating anything.

### Three state prompts (start / mid-transition / end)

Each state prompt = **state-specific scene paragraph** + an **identical LOCKED STYLE block** +
an explicit **NEGATIVE PROMPT** line.

**LOCKED STYLE block** (copy verbatim into all three prompts — this is what keeps frames
animatable):
```
LOCKED STYLE (identical across the animation series):
- Aspect ratio: [choose: 16:9 landscape for wide subjects, 4:5 portrait for tall/upright]
- Camera: 50 mm equivalent lens, slight three-quarter perspective from above, subject centered.
- Lighting: soft, even, daylight-balanced studio light from the upper-left. Subtle soft contact
  shadow under the subject. No harsh highlights, no rim light, no spotlight.
- Background: plain off-white seamless paper sweep, empty negative space around the subject.
- Finish: photorealistic rendering, matte surface, accurate color reproduction.
```

**NEGATIVE PROMPT line** (append to each prompt):
```
NEGATIVE PROMPT: no warped text, no extra props, no hands, no watermark, no CGI look,
no cartoon style, no painterly style, no glare.
```

**State-specific scene paragraphs:**
- **State 1 (closed / start):** describe the subject in its initial, resting state — fully
  closed, intact, folded, or assembled. Every detail that appears on the surface.
- **State 2 (mid-transition):** describe the subject halfway through the transformation —
  cover ~45° open, product half-unwrapped, object mid-fold. Add subtle motion blur only on the
  moving parts; the body stays sharp.
- **State 3 (open / end):** describe the subject in its final, settled state — fully open,
  unpackaged, unfolded, or transformed. This image will be used as the Veo END reference.

If the user supplied start or end images, **describe them** into the state prompts instead of
inventing; still use "plain off-white seamless background" — the final background is applied
later by `flatten.py`.

### Video prompt (timed motion)

```
A continuous, photorealistic ~4-second cinematic shot on a plain off-white seamless paper
background. LOCKED-OFF tripod camera — no movement, no zoom, no pan.

Frame the subject so the WHOLE subject is always fully inside the frame — including any
parts that lift or rise — but keep it LARGE and prominent (modest even margin) so surface
detail stays sharp.

START STATE (state 1 image, supplied as start image): [brief description]
END STATE (state 3 image, supplied as end image):     [brief description]

MOTION (0.3 s hold closed → 3.0 s transformation with smooth ease-in-out →
0.7 s hold open). [Describe the specific motion: hinge, fan, unfold, inflate, etc.]

LIGHTING: soft daylight from upper-left, constant throughout. Subtle contact shadow shifts
naturally with the geometry. No flicker, no exposure shift.

NEGATIVE: no camera movement, no zoom, no shake, no hands, no background change, no
relighting, no warped text, no watermark, no glitch artifacts.

Style: photorealistic product cinematography, matching start and end images exactly.
```

**Key lesson:** "Moderate zoom = the sweet spot." Repeat the no-zoom / whole-subject-in-frame
directive multiple times — Veo weights repetition. Too zoomed-in → subject exits the top of
the frame mid-motion → unfixable crop. Too zoomed-out → surface text is rendered too small →
garbled. Aim for "faithful & legible," not pixel-identical (Veo always redraws text slightly).

---

## Phase 2 — Generate 3 stills

Use the **`media-gen` skill**, one asset at a time:

1. Generate state 1 (closed/start). Regenerate 1–2× if text is warped or style drifts.
2. Generate state 2 (mid-transition). Optional if the model infers it well.
3. Generate state 3 (open/end). **This is the most important still** — it becomes the Veo
   end-image and the reduced-motion fallback.

Downloads follow the `media-gen` skill (§Download robust method). Copy into the run folder:
`./stop-animation/<slug>/states/`.

**Per-keyframe reroute:** if the user rejects a ChatGPT still, reroute **that keyframe only** to
OpenRouter (see `media-gen` §OpenRouter route) with the same prompt, passing the already-approved
states as `--ref` to keep the LOCKED STYLE consistent. Follow the `media-gen` cost gate: run
WITHOUT `--yes` first (dry run), show the user the estimate, and re-run with `--yes` only after they
approve:
```powershell
python "${CLAUDE_PLUGIN_ROOT}\skills\media-gen\scripts\openrouter.py" image `
  --prompt-file "./stop-animation/<slug>/_raw/state2-prompt.txt" `
  --ref "./stop-animation/<slug>/states/state1.png" `
  --out "./stop-animation/<slug>/states/state2.png" `
  --yes   # only after the user approved the dry-run estimate
```

**CHECKPOINT 1 — user approves all 3 stills before proceeding.**
Regenerate on: warped typography, style drift between states, heavy CGI look, wrong composition.

---

## Phase 3 — Generate video

Default: **OpenRouter API** (no browser, no manual attachments).

**Before generating, give the user a whole-run estimate:** rerouted stills cost about $0.04 each;
the video is per the dry run (veo-3.1 4s 1080p without audio ≈ $0.80; veo-3.1-fast ≈ $0.40).

1. Write the video prompt to `./stop-animation/<slug>/_raw/video-prompt.txt`.
2. Run `openrouter.py models --kind video` once to confirm the model supports `last_frame` and
   to see pricing.
3. Dry run: run the command below WITHOUT `--yes` (prints the COST ESTIMATE, exit 3), show the user
   the estimate, today's spend and credits left, and get their explicit go-ahead.
4. Submit with `--yes` — the script polls and downloads:
```powershell
python "${CLAUDE_PLUGIN_ROOT}\skills\media-gen\scripts\openrouter.py" video `
  --first "./stop-animation/<slug>/states/state1.png" `
  --last  "./stop-animation/<slug>/states/state3.png" `
  --prompt-file "./stop-animation/<slug>/_raw/video-prompt.txt" `
  --out "./stop-animation/<slug>/_raw/input.mp4" `
  --yes   # omit on the dry run; audio is off by default
```
On failure or timeout, use `video --resume JOB_ID --out ...` — never re-submit.

### Fallback — browser Veo

Use `media-gen`'s Veo branch (Gemini → `+` → Create video, Landscape 16:9 or the chosen
aspect):

1. **Attach start and end images MANUALLY** — native OS file dialogs freeze browser automation.
   Tell the user to drag state 1 (start) and state 3 (end) onto the Gemini composer. State 2
   is optional as a mid-keyframe reference.
2. Paste the video prompt.
3. Wait and download following `media-gen`'s §Video branch (Veo wait/poll and download mechanics).

**CHECKPOINT 2 — show the raw video and get user approval BEFORE any processing.**
A top-crop (subject exits the top edge during the motion) is unfixable. Regenerate if the
motion is unconvincing or the crop is bad.

Copy the approved video to `./stop-animation/<slug>/_raw/input.mp4`.

---

## Phase 4 — Extract frames

```powershell
python "${CLAUDE_PLUGIN_ROOT}\skills\stop-animation\scripts\extract.py" `
  --video "./stop-animation/<slug>/_raw/input.mp4" `
  --workdir "./stop-animation/<slug>"
```

Use the `END_FRAME` value the script prints — the settle suggestion owns the constants.

**Crop check:** if the script warns "subject touches top edge" → regenerate the video with a
moderately wider framing. The pixels simply aren't in the file — post-processing cannot fix it.

---

## Phase 5 — Background treatment

Run `flatten.py` with the answer from the Ask-first round:

```powershell
python "${CLAUDE_PLUGIN_ROOT}\skills\stop-animation\scripts\flatten.py" `
  --workdir "./stop-animation/<slug>" `
  --out     "./stop-animation/<slug>/frames" `
  --end-frame <END_FRAME> `
  (--hex "#RRGGBB" | --transparent)
```

Verify: hex → corner ±1 from target; transparent → corner alpha 0. (The script prints both.)
Output formats: hex → RGB WebP + JPEG poster/final; transparent → RGBA WebP + PNG poster/final.

---

## Phase 6 — Emit HTML snippet

1. Copy `templates\snippet.html` from this skill folder into `./stop-animation/<slug>/snippet.html`.
2. Fill all `{{PLACEHOLDER}}` values:
   - `{{N_FRAMES}}` → the `--n-out` value (e.g. `132`)
   - `{{FRAME_PATH}}` → relative path prefix for frames (e.g. `frames/`)
   - `{{BG}}` → the hex string (e.g. `#F1EADA`) or `transparent`
   - `{{ASPECT}}` → numeric ratio as a JS/CSS expression (e.g. `16/9` or `4/5`)
   - `{{POSTER_PATH}}` → `frames/poster.jpg` (hex mode) or `frames/poster.png` (transparent)
   - `{{FINAL_PATH}}` → `frames/final.jpg` (hex mode) or `frames/final.png` (transparent)
3. Set the `MODE` constant in the `<script>` to `"scroll"`, `"loop"`, or `"hover"`.
4. Strip the two unused `if (MODE === ...)` driver blocks from the script section.

**Preview:** browser automation cannot open `file://`, so serve it:
```powershell
python -m http.server 8787 --bind 127.0.0.1
# open http://127.0.0.1:8787/stop-animation/<slug>/snippet.html
```
The user can also double-click the HTML directly (relative `frames/` paths work over
`file://`).

**Reduced-motion:** the snippet auto-detects `prefers-reduced-motion: reduce` and shows only
the final static frame at 100vh height — no JavaScript animation fires.

---

## Gotchas (from the tschumi handoff)

- **Crop is unfixable in post.** Missing pixels aren't in the file. Prevent with moderate zoom.
- **Veo always redraws text.** It can never be pixel-exact. Aim for "faithful & legible."
- **OpenRouter video is async and billed per second.** The script polls; on a slow or failed
  job use `--resume JOB_ID`, never re-submit (double billing).
- **File dialogs freeze browser automation.** Never click a raw file-upload button; have the
  user attach references manually by dragging onto the composer.
- **`fetch(blob)` is blocked on Gemini.** Always use the on-page download button.
- **Approve the raw video before processing.** A bad generation shouldn't cost a full
  recolor/build cycle.
- **Detect the subject by saturation/darkness**, not by difference from a corner pixel — the
  soft studio shadow will fool a difference test.
- **WebP corner rounding:** ±1 per channel is normal. The page background is set to the exact
  hex anyway, so any sub-pixel seam is invisible.
- **~130 frames ≈ 6 MB** of WebP at quality=90 — normal and worth it for a seamless surface.

## Run-folder layout

```
./stop-animation/<slug>/
  _raw/          video + raw PNG frames (delete after build)
  states/        3 approved stills (state1.png, state2.png, state3.png)
  frames/        WebP sequence + poster + final fallback
  snippet.html   filled template, ready to embed
```

## Siblings

- `media-gen` — all image and video generation (ChatGPT stills / OpenRouter reroute and video via
  `scripts/openrouter.py` / browser Veo fallback).
- `recolor-icons` — background knockout for single icons (simpler, no video pipeline).
