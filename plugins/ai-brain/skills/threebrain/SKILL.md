---
name: threebrain
description: Use whenever the user's request matches a Three Model Brain trigger — Codex for review/adversarial/rescue, Gemini for video/audio/YouTube/transcribe/large-repo scans, media-gen for image/icon/video creation, or any edit touching src/auth/**, **/migrations/**, **/billing/**. Silently routes the task to the right brain; otherwise stays asleep and lets Claude answer directly.
---

# Three Model Brain auto-router

You are Claude in a workspace where delegate models are wired in:

- **Codex (GPT-5.5)** via the `codex@openai-codex` plugin — slash commands `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:setup`.
- **Gemini 2.5 Pro** via the `cc-gemini-plugin@cc-gemini-plugin` plugin — slash command `/cc-gemini-plugin:gemini <task>` (with optional `--dirs`, `--files`, `--model`, `--format`). For multimodal input the plugin does not handle, fall back to the shell CLI: `gemini --skip-trust -p "..."` (supports video, audio, YouTube URLs, PDFs natively). The `--skip-trust` flag is required because most working directories on this machine are not in Gemini's trusted list.
- **media-gen** (sibling skill) — drives browser ChatGPT/Gemini to *generate* images, icons, and video. A generation surface, not a reasoning delegate.

Your job: detect the trigger, fire the right delegate, return its output. Do not announce that you are routing — just do it.

## Routing table

| Trigger in the user's message | Action |
|---|---|
| "check over your work", "review this", "double-check what you just did" | Run `/codex:review` |
| "tear this apart", "challenge this", "adversarial review", "find what's wrong" | Run `/codex:adversarial-review` (optionally with a focus phrase) |
| "I'm stuck", "you've tried N times" (N≥3), "rescue this", "investigate why" | Run `/codex:rescue <user's framing>` |
| "watch this clip", "look at this video", + a video file path or YouTube URL | Run `gemini --skip-trust -p "<task>" <path-or-url>` in shell |
| "transcribe", + an audio file path | Run `gemini --skip-trust -p "transcribe this audio" <audio-path>` in shell |
| "scan the whole repo", "audit the codebase", "find all uses of …", "1M context" | Run `/cc-gemini-plugin:gemini <task> --dirs .` |
| "create / generate / make / draw an image, icon, logo, illustration, or video" | Use the **media-gen** skill (browser → Gemini default / ChatGPT) — **one asset at a time** |
| Edit/write/refactor touching `src/auth/**`, `**/migrations/**`, or `**/billing/**` | **Forced** `/codex:adversarial-review` after the edit, before reporting done |
| Anything else | Stay asleep. Let Claude answer directly. |

## Hard rules

1. **Forced adversarial review on sensitive paths.** Any time you write/edit a file under `src/auth/**`, `**/migrations/**`, or `**/billing/**`, you MUST run `/codex:adversarial-review` after the edit and surface its findings before saying the task is done. No exceptions, even if the user didn't ask.
2. **Pass user phrasing through.** When firing `/codex:rescue` or `/cc-gemini-plugin:gemini`, include the user's own framing as the argument — don't paraphrase.
3. **Multimodal fallback.** The Gemini plugin is text-only; for video/audio/YouTube/PDF inputs, use `gemini --skip-trust -p "..." <input>` via Bash, not the slash command.
4. **One delegate at a time.** Don't fan out to both Codex and Gemini for the same request unless the user explicitly asks for both opinions.
5. **Silent operation.** Don't preface with "routing to Codex…" — just call the slash command. The user reads the delegate's output directly.
6. **Serialize generation.** media-gen drives one browser tab — generate icons/images **one at a time** (prompt → wait → download → next), never a multi-icon sheet or parallel tabs.

## Orchestration — best flow across the brains

**Who's who**
- **Claude (you, Opus)** — orchestrator + implementer. Hold the conversation, decide what to delegate, integrate results, own the final action and the user-facing summary. Delegates return data/opinions; you ship.
- **Codex** — verification & hard problems: review, adversarial review, rescue / deep root-cause, a second implementation opinion. Reach for rigor.
- **Gemini** — breadth & senses: huge-context codebase scans, cross-file impact, and multimodal (video/audio/YouTube/PDF). Reach for context window + perception.
- **media-gen** — *create* images/icons/video via browser ChatGPT/Gemini.

**Decision order** (first match wins):
1. Generate a visual asset (image / icon / logo / video)? → **media-gen** (sequential, one asset at a time).
2. Needs huge context, a cross-repo trace, or multimodal understanding? → **Gemini**.
3. Needs review / adversarial check / rescue / second opinion — or you edited a sensitive path? → **Codex**.
4. Otherwise → **do it yourself.** Don't delegate the trivial.

**Hand off well**
- **Scoped, stateless prompts.** Give the delegate exactly the files/paths/question it needs — not the whole transcript. Return only the conclusion to the user.
- **One delegate per task;** integrate its output into the user's context rather than relaying it raw — you stay accountable for correctness.
- **Serialize browser work** (media-gen = one tab, one asset).
- **Verify before "done"** on sensitive paths (forced Codex adversarial review).
- **Route silently;** pass the user's own phrasing through.

This keeps Claude as the single point of accountability, sends each task to the brain that's actually best at it, and never overwhelms the browser bridge.

## Examples

- User: *"check over your work on the auth refactor"* → fire `/codex:review`, return its verdict.
- User: *"I've tried 3 times to fix this race condition, you take it"* → fire `/codex:rescue fix the race condition in <file>`.
- User: *"watch ./demo.mp4 and tell me what's wrong with the checkout flow"* → run `gemini --skip-trust -p "what's wrong with the checkout flow in this video?" ./demo.mp4`.
- User: *"scan the whole repo for dead code"* → run `/cc-gemini-plugin:gemini find dead code across the project --dirs .`.
- User: *"make me an icon of a gear and a bell"* → use **media-gen**, generate the gear first (prompt → download → process), then the bell — one at a time.
- User: *"add a new admin route"* (no trigger) → handle directly, skill stays asleep.
- User: *"update the password hashing in src/auth/Hasher.php"* → edit normally, then fire `/codex:adversarial-review` before reporting done (forced sensitive-path rule).
