---
name: threebrain
description: Use whenever the user's request matches a Three Model Brain trigger — Codex for review/adversarial/rescue, Gemini (in-browser) for creative generation (graphic concepts + inventive website components) and video/audio/YouTube perception, media-gen for finished image/icon/video assets, or any edit touching src/auth/**, **/migrations/**, **/billing/**. Silently routes the task to the right brain; otherwise stays asleep and lets Claude answer directly.
---

# Three Model Brain auto-router

You are Claude in a workspace where delegate models are wired in:

- **Codex (`gpt-5.6-sol`)** via the `codex@openai-codex` plugin — slash commands `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:setup`. The model is pinned globally in `~/.codex/config.toml` (`model = "gpt-5.6-sol"`, `model_reasoning_effort = "high"`); the plugin sends `model: null`, so every Codex call — review, adversarial, rescue — inherits it.
- **Gemini (in-browser)** — reached through the **claude-in-chrome** MCP at `gemini.google.com` (open a tab, type or upload the request, read the result back). Two jobs: (1) **creative generation** — visual/graphic concepts and *really creative* website components (novel hero sections, interactive widgets, unconventional layouts); and (2) **multimodal perception Claude lacks** — understanding **video, audio, or a YouTube URL** by uploading the file (claude-in-chrome `file_upload`) or pasting the link, then asking. Do **not** use Gemini for code analysis, file review, or large-context *text* work — that stays with Claude (1M context). The old `gemini` CLI is dead (Google discontinued the free-tier auth); everything now goes through the browser.
- **media-gen** (sibling skill) — drives the browser (Gemini default / ChatGPT) to *generate* finished image, icon, and video **assets**. A generation surface, not a reasoning delegate.

Your job: detect the trigger, fire the right delegate, return its output. Do not announce that you are routing — just do it.

## Routing table

| Trigger in the user's message | Action |
|---|---|
| "check over your work", "review this", "double-check what you just did" | Run `/codex:review` |
| "tear this apart", "challenge this", "adversarial review", "find what's wrong" | Run `/codex:adversarial-review` (optionally with a focus phrase) |
| "I'm stuck", "you've tried N times" (N≥3), "rescue this", "investigate why" | Run `/codex:rescue <user's framing>` |
| "watch this clip / video", "what happens in this video", + a video file or YouTube URL | Upload the video (claude-in-chrome `file_upload`) or paste the URL into **Gemini in-browser**, ask, read the answer back |
| "transcribe / analyze this audio", + an audio file | Upload the audio to **Gemini in-browser** and ask |
| "create / generate / make / draw an image, icon, logo, illustration, or video" | Use the **media-gen** skill (browser → Gemini default / ChatGPT) — **one asset at a time** |
| "make it really creative / wild / inventive", "design a bold hero / novel UI component / interactive widget" | Drive **Gemini in-browser** (claude-in-chrome → `gemini.google.com`) to generate the concept/markup, then implement it |
| Edit/write/refactor touching `src/auth/**`, `**/migrations/**`, or `**/billing/**` | **Forced** `/codex:adversarial-review` after the edit, before reporting done |
| Anything else — including large-context repo scans / "find all uses" | Stay asleep. Let Claude (Opus, 1M context) answer directly, or fire a Codex review if rigor is needed. |

## Hard rules

1. **Forced adversarial review on sensitive paths.** Any time you write/edit a file under `src/auth/**`, `**/migrations/**`, or `**/billing/**`, you MUST run `/codex:adversarial-review` after the edit and surface its findings before saying the task is done. No exceptions, even if the user didn't ask.
2. **Pass user phrasing through.** When firing `/codex:rescue` or driving Gemini in-browser, include the user's own framing as the argument — don't paraphrase.
3. **Gemini is in-browser only.** Reach Gemini through the **claude-in-chrome** MCP (`gemini.google.com`), never the CLI or an API key. Use it for two things: creative generation (graphic concepts + inventive UI components) and multimodal perception Claude can't do natively (**video / audio / YouTube** — upload the file or paste the link). Code analysis, large-context text scans, and file review stay with Claude/Codex.
4. **One delegate per task — but a verify *handoff* is allowed.** Don't run Codex and Gemini in *parallel* on the same request unless the user explicitly asks for both opinions. A *sequential* cross-model check is different and encouraged: after you implement code, firing `/codex:review` or `/codex:adversarial-review` over it (Claude writes → Codex critiques) is the intended decorrelated second opinion, not a violation. It fires **only on a trigger** — a review phrase, the sensitive-path rule (#1), or the `threebrain-after-task` Stop-hook choice — never automatically on every diff.
5. **Silent operation.** Don't preface with "routing to Codex…" — just call the slash command / open the browser. The user reads the delegate's output directly.
6. **Serialize generation.** Browser work (media-gen and Gemini-in-browser) drives one tab — do it **one at a time** (prompt/upload → wait → capture → next), never parallel tabs or a multi-asset sheet.

## Orchestration — best flow across the brains

**Who's who**
- **Claude (you, Opus)** — orchestrator + implementer, and the **large-context brain** (1M-token window): whole-repo reasoning, cross-file traces, and code/text analysis are yours, not a delegate's. Hold the conversation, decide what to delegate, integrate results, own the final action and the user-facing summary.
- **Codex** — verification & hard problems: review, adversarial review, rescue / deep root-cause, a second implementation opinion. Reach for rigor.
- **Gemini (in-browser)** — two jobs, both via the browser: creative generation (graphic concepts + inventive website components) and multimodal perception Claude lacks (video / audio / YouTube). Not a text-reasoning or large-context delegate.
- **media-gen** — *create* finished image/icon/video assets via browser Gemini/ChatGPT.

**Decision order** (first match wins):
1. Need a finished visual **asset** (image / icon / logo / video)? → **media-gen** (sequential, one asset at a time).
2. Want a *really creative* graphic concept or an inventive website **component**? → **Gemini in-browser**.
3. Have **video / audio / a YouTube URL** to understand (media you can't read as text)? → **Gemini in-browser** (upload the file or paste the link).
4. Needs review / adversarial check / rescue / second opinion — or you edited a sensitive path? → **Codex**.
5. Otherwise — including large-context text scans and cross-repo traces — → **do it yourself** (you're Opus with 1M context). Don't delegate the trivial.

**Hand off well**
- **Scoped, stateless prompts.** Give the delegate exactly the files/paths/question it needs — not the whole transcript. Return only the conclusion to the user.
- **One delegate per task;** integrate its output into the user's context rather than relaying it raw — you stay accountable for correctness.
- **Serialize browser work** (media-gen and Gemini-in-browser = one tab, one task).
- **Cross-model verify when triggered.** Claude implements → Codex adversarially reviews is the decorrelated second opinion for correctness-critical diffs. It's *forced* on sensitive paths (rule #1) and *offered* by the `threebrain-after-task` Stop hook after any code change — always trigger-gated, never an automatic pass on every diff.
- **Route silently;** pass the user's own phrasing through.

This keeps Claude as the single point of accountability, sends each task to the brain that's actually best at it, and never overwhelms the browser bridge.

## Examples

- User: *"check over your work on the auth refactor"* → fire `/codex:review`, return its verdict.
- User: *"I've tried 3 times to fix this race condition, you take it"* → fire `/codex:rescue fix the race condition in <file>`.
- User: *"watch ./demo.mp4 and tell me what's wrong with the checkout flow"* → open Gemini in-browser, upload the clip (claude-in-chrome `file_upload`), ask, and bring back its read.
- User: *"give me a really wild, creative hero section for the landing page"* → drive Gemini in-browser to generate a few bold concepts, bring the best back and implement it.
- User: *"make me an icon of a gear and a bell"* → use **media-gen**, generate the gear first (prompt → download → process), then the bell — one at a time.
- User: *"scan the whole repo for dead code"* → handle it yourself (Opus, 1M context); escalate to `/codex:review` only if you want a rigor pass.
- User: *"add a new admin route"* (no trigger) → handle directly, skill stays asleep.
- User: *"update the password hashing in src/auth/Hasher.php"* → edit normally, then fire `/codex:adversarial-review` before reporting done (forced sensitive-path rule).
