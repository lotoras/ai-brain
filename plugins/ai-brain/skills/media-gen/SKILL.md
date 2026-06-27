---
name: media-gen
description: Use when the user asks to create / generate / make / draw an image, picture, icon, logo, illustration, or a video — in ANY project. Drives Gemini (default) or ChatGPT in Chrome via the claude-in-chrome MCP, generates the asset, downloads it, and post-processes. For icons it knocks out the background and (only if asked) recolors. Do NOT substitute stock/searched assets for a generation request.
---

# media-gen — generate images / icons / video via browser AI

When the user wants a **new** visual asset *generated* (not found/stock), drive a logged-in
browser AI to make it, download it, and hand back a usable file. Default model: **Gemini**.

## When to use / not use
- **Use** for: "make/generate/create an image of…", "an icon for…", "a logo", "an illustration",
  "a short video / clip of…".
- **Do NOT use** for: analyzing or transcribing an *existing* video/audio/PDF (that's `threebrain`
  → Gemini CLI), editing a local image with code, or authoring vector/SVG by hand.

## Model selection
- **Default: Gemini** (`https://gemini.google.com/app`, Imagen / Veo).
- Use **ChatGPT** (`https://chatgpt.com`, gpt-image-1 / Sora) if the user names it.
- Generate in **both and compare** only if the user explicitly asks.

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
5. **Cross-origin fallback (Gemini):** if `fetch` throws `Failed to fetch`, use the page's own
   download button instead (Gemini shows a "Downloading full size…" toast).
6. **Verify on disk:** the file lands in `C:\Users\lukar\Downloads`. Check mtime/size; watch for a
   `.crdownload` still in progress. Then copy into the active project only if the user wants it there.

## Icon branch — what to do after download
Icons get extra handling. Follow the `recolor-icons` skill's **decision tree**:
1. **Default = leave it dark.** Run `transparent-bg.py` on the download (ChatGPT flattens onto
   near-white, Gemini renders on white — both need knockout) and deliver the **dark, transparent**
   icon. Do **not** auto-apply any brand color.
2. **Color named** → `recolor-solid.py <file> <hex>` (solid is the default recolor mode).
3. **"gradient" said** → `recolor.py <file> [start end]`.
4. **"recolor" with no color** → **ask which color** first.
Always show a **white-composited preview** so the transparent result is visible, then **advise**:
raster is fine for a one-off; for an **icon system/library** (e.g. a Material Symbols line set),
recommend a **trace-to-SVG** pass for crisp vectors, and offer to generate more — **one at a time**.

## Video branch
Gemini **Veo** / ChatGPT **Sora** via their web UIs. Be honest about limits: generation takes
**minutes** (poll patiently), files are large `.mp4`, and availability is **subscription-tier
dependent**. If the UI/tier doesn't expose video gen, stop and tell the user rather than guessing.

## Boundaries
- Browser automation has side effects (opens tabs, writes downloads). Proceed automatically, but
  **stop after 2–3 failed attempts** on the same step and ask the user.
- Never bypass login or CAPTCHAs; never type secrets into prompts; don't accept consent/permission
  dialogs on the user's behalf.

## Siblings & handoff
- `recolor-icons` — background knockout + brand recolor (decision tree lives there).
- `threebrain` — the orchestration/handoff model across Claude / Codex / Gemini, and routing of
  *analysis* (not generation) tasks. See its "Orchestration" section for the general handoff flow.
