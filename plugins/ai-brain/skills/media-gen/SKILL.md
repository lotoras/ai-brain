---
name: media-gen
description: Use when the user asks to create / generate / make / draw an image, picture, icon, logo, illustration, or a video — in ANY project. Images and icons are generated in ChatGPT in Chrome via the claude-in-chrome MCP, downloaded and post-processed (OpenRouter reroute via `openrouter.py` when the user says the result isn't good enough or "use OpenRouter"). Video defaults to the OpenRouter API (`openrouter.py`, no browser), with browser Veo as fallback. For icons it knocks out the background and (only if asked) recolors. Do NOT substitute stock/searched assets for a generation request.
---

# media-gen — generate images / icons / video via browser AI

When the user wants a **new** visual asset *generated* (not found/stock), drive a logged-in
browser AI to make it, download it, and hand back a usable file. Model: **ChatGPT**.

## When to use / not use
- **Use** for: "make/generate/create an image of…", "an icon for…", "a logo", "an illustration",
  "a short video / clip of…".
- **Do NOT use** for: analyzing or transcribing an *existing* video/audio/PDF (that's `threebrain`
  → ChatGPT in-browser), editing a local image with code, or authoring vector/SVG by hand.

## Model selection
- **ChatGPT** (`https://chatgpt.com`) is the only browser model for images and icons.
- **Video is the single exception:** it defaults to the OpenRouter API; browser Veo at
  `https://gemini.google.com/app` is the fallback (see "Video branch").

## ⚠️ Sequential handoff — one asset at a time
The browser MCP drives **one live tab**. Keep handoffs small so it isn't overwhelmed:
- **Generate icon-by-icon / image-by-image: one prompt → wait → download → next.** Never ask the
  model for a grid/contact-sheet of many icons in one shot, and never fan out parallel tabs or
  parallel `browser_batch` actions. Serialize everything.
- For a batch of N icons, loop N times; after each, confirm the file landed before starting the
  next. If one fails, finish the rest and report which failed — don't retry in a tight loop.
- This both protects the MCP and gives consistent, individually-clean icons.

## Browser workflow (claude-in-chrome MCP)
1. **Load tools** with `ToolSearch` (`select:mcp__claude-in-chrome__tabs_context_mcp,...navigate,...computer,...javascript_tool,...browser_batch`).
2. **Pick the browser:** call `tabs_context_mcp` first. If it reports multiple connected browsers,
   prefer the one named **`luka_computer`** (use `list_connected_browsers` → `select_browser`); if
   ambiguous, call `switch_browser` and let the user click **Connect**.
3. **New tab** (`tabs_create_mcp`) → `navigate` to the model URL → screenshot → confirm logged in.
4. **Prompt:** click the composer, type the prompt, send. **Verify it actually sent** — the send
   button shifts after typing; if the text is still in the box, click the arrow again.
   - Icon prompt recipe: *"flat, single-color line icon of <X>, minimal, clean vector style,
     centered, transparent or white background, 1:1 square, Material Symbols Outlined style."*
5. **Wait** for render (image ≈ 30–60 s; poll with screenshots, `wait` max 10 s each). Video = minutes.

## Download (robust method)
Use in-page JavaScript with **top-level `await`** — do NOT wrap in an `async` IIFE (it returns
`{}`). Steps:
1. Find the largest `<img>` (the generated asset), `fetch(img.src)` → `arrayBuffer`.
2. Base64-encode in chunks of `0x8000` (a one-shot `String.fromCharCode(...bigArray)` overflows the stack).
3. Rebuild a `Blob`, make an object URL, click a programmatic `<a download="name.png">`.
4. **Never return the raw image URL** through the tool — its cookie/query-string gets blocked.
5. **Cross-origin fallback:** if `fetch` throws `Failed to fetch`, use the page's own
   download button instead.
6. **Verify on disk:** the file lands in `C:\Users\lukar\Downloads`. Check mtime/size; watch for a
   `.crdownload` still in progress. Then copy into the active project only if the user wants it there.

## Icon branch — what to do after download
Icons get extra handling. Follow the `recolor-icons` skill's **decision tree**:
1. **Default = leave it dark.** Run `transparent-bg.py` on the download (ChatGPT flattens onto
   near-white and needs knockout) and deliver the **dark, transparent**
   icon. Do **not** auto-apply any brand color.
2. **Color named** → `recolor-solid.py <file> <hex>` (solid is the default recolor mode).
3. **"gradient" said** → `recolor.py <file> [start end]`.
4. **"recolor" with no color** → **ask which color** first.
Always show a **white-composited preview** so the transparent result is visible, then **advise**:
raster is fine for a one-off; for an **icon system/library** (e.g. a Material Symbols line set),
recommend a **trace-to-SVG** pass for crisp vectors, and offer to generate more — **one at a time**.

## Video branch
**Default: OpenRouter** (see "OpenRouter route") — no browser, first/last frames attached by API.
**Fallback: Veo** at `https://gemini.google.com/app` — use when the user asks for the browser, or
OpenRouter is unavailable (Sora is shut down and ChatGPT has no video generation). Be honest about
limits: generation takes **minutes** (poll patiently), files are large `.mp4`, and availability is
**subscription-tier dependent**. If the UI/tier doesn't expose video gen, stop and tell the user
rather than guessing.

## OpenRouter route
**When:** the user says a browser result isn't good enough and wants a reroute, says "use
OpenRouter", or wants video without a browser. Otherwise images stay on ChatGPT.

Helper: `${CLAUDE_PLUGIN_ROOT}\skills\media-gen\scripts\openrouter.py` (stdlib Python). Key:
env `OPENROUTER_API_KEY`, else `ai-brain/.env` (path from `~/.claude/settings.json`); never print it.
```powershell
python "${CLAUDE_PLUGIN_ROOT}\skills\media-gen\scripts\openrouter.py" models --kind image|video
python "${CLAUDE_PLUGIN_ROOT}\skills\media-gen\scripts\openrouter.py" image --prompt-file p.txt --out out.png [--ref approved.png ...] [--aspect 16:9] [--yes]
python "${CLAUDE_PLUGIN_ROOT}\skills\media-gen\scripts\openrouter.py" video --prompt-file p.txt --first a.png [--last b.png] --out out.mp4 [--audio] [--yes] [--max-cost USD]
python "${CLAUDE_PLUGIN_ROOT}\skills\media-gen\scripts\openrouter.py" video --resume JOB_ID --out out.mp4
python "${CLAUDE_PLUGIN_ROOT}\skills\media-gen\scripts\openrouter.py" budget
```
- **Defaults:** images `google/gemini-2.5-flash-image` (pass approved earlier images as `--ref`
  for consistency); video `google/veo-3.1`. Run `models --kind video` first to confirm `--last` support.
- **Cost:** see "Cost gate (mandatory)" below. On a failed/slow job, `--resume JOB_ID`; never
  re-submit (double billing).
- **One asset at a time** still applies.

### Cost gate (mandatory)
`image` and `video` submits print a COST ESTIMATE and do nothing else unless `--yes` is passed.
1. Always run the command **without `--yes` first** (dry run, exit 3, free).
2. Show the user the estimate plus today's spend and remaining credits.
3. Re-run with `--yes` **only after they explicitly approve**.
4. Use `--max-cost USD` only when the user approved an amount above the per-call cap.
5. Never loop regenerations without re-asking.

With `--yes` the script refuses (exit 4) if the estimate exceeds the per-call cap, the daily limit,
the credits left or the key limit, or if the estimate or today's usage is unknown and `--max-cost`
is absent. Caps live in `ai-brain/.env` (env vars win): `OPENROUTER_MAX_COST_PER_CALL` (default 3),
`OPENROUTER_DAILY_LIMIT` (default 10). `budget` prints usage, credits and caps (free). Video audio
is off by default (`--audio` roughly doubles the cost). Cheap option: `google/veo-3.1-fast`
(~$0.10/s without audio).

## Boundaries
- Browser automation has side effects (opens tabs, writes downloads). Proceed automatically, but
  **stop after 2–3 failed attempts** on the same step and ask the user.
- Never bypass login or CAPTCHAs; never type secrets into prompts; don't accept consent/permission
  dialogs on the user's behalf.

## Siblings & handoff
- `recolor-icons` — background knockout + brand recolor (decision tree lives there).
- `threebrain` — the orchestration/handoff model across Claude / Codex / ChatGPT-in-browser, and routing of
  *analysis* (not generation) tasks. See its "Orchestration" section for the general handoff flow.
- `pixel-art` — pixel art / sprite / tileset requests go there, not here.
