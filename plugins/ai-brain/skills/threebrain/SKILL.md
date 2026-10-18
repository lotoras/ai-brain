---
name: threebrain
description: Use whenever the user's request matches a Three Model Brain trigger — Codex for test-writing (planned work) and review/adversarial/rescue, ChatGPT (in-browser) for video/audio/YouTube perception, media-gen for finished image/icon/video assets, the pixel-art skill for pixel art / sprites / tilesets, or any edit touching src/auth/**, **/migrations/**, **/billing/**. Silently routes the task to the right brain; otherwise stays asleep and lets Claude answer directly.
---

# Three Model Brain auto-router

You are Claude in a workspace where delegate models are wired in:

- **Codex (`gpt-6.1-sol`)** via the `codex@openai-codex` plugin — slash commands `/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:setup`. The model is pinned globally in `~/.codex/config.toml` (`model = "gpt-6.1-sol"`, `model_reasoning_effort = "high"`; `setup` provisions the pin from `setup/codex-home/config.toml`); the plugin sends `model: null`, so every Codex call — tests, review, adversarial, rescue — inherits it. Never pass the plugin's `spark` alias — it maps to the stale `gpt-5.3-codex-spark`.
- **ChatGPT (in-browser)** — reached through the **claude-in-chrome** MCP at `chatgpt.com` (open a tab, type or upload the request, read the result back). One job: **multimodal perception Claude lacks** — understanding **video, audio, or a YouTube URL** by uploading the file (claude-in-chrome `file_upload`) or pasting the link, then asking. Do **not** use it for code analysis, file review, or large-context *text* work — that stays with Claude (1M context). Creative concepts and inventive website components are Claude's own job — no delegate.
- **media-gen** (sibling skill) — drives the browser (ChatGPT) to *generate* finished image, icon, and video **assets**. A generation surface, not a reasoning delegate.

Your job: detect the trigger, fire the right delegate, return its output. Do not announce that you are routing — just do it.

## Routing table

| Trigger in the user's message | Action |
|---|---|
| "check over your work", "review this", "double-check what you just did" | Run `/codex:review` |
| "tear this apart", "challenge this", "adversarial review", "find what's wrong" | Run `/codex:adversarial-review` (optionally with a focus phrase) |
| "I'm stuck", "you've tried N times" (N≥3), "rescue this", "investigate why" | Run `/codex:rescue <user's framing>` |
| "watch this clip / video", "what happens in this video", + a video file or YouTube URL | Upload the video (claude-in-chrome `file_upload`) or paste the URL into **ChatGPT in-browser**, ask, read the answer back |
| "transcribe / analyze this audio", + an audio file | Upload the audio to **ChatGPT in-browser** and ask |
| Planned multi-file feature/bugfix (after the plan file exists) | Run the **Development pipeline** below — Codex writes the red tests first (`codex:codex-rescue`) |
| "create / generate / make / draw an image, icon, logo, illustration, or video" | Use the **media-gen** skill (browser → ChatGPT) — **one asset at a time** (reroute to the OpenRouter API on request — see media-gen) |
| "pixel art", "sprite", "tileset", "8-bit / 16-bit" asset | Use the **pixel-art** skill |
| Edit/write/refactor touching `src/auth/**`, `**/migrations/**`, or `**/billing/**` | **Forced** `/codex:adversarial-review` after the edit, before reporting done |
| Anything else — including large-context repo scans / "find all uses" | Stay asleep. Let Claude (Opus, 1M context) answer directly, or fire a Codex review if rigor is needed. |

## Hard rules

1. **Forced adversarial review on sensitive paths.** Any time you write/edit a file under `src/auth/**`, `**/migrations/**`, or `**/billing/**`, you MUST run `/codex:adversarial-review` after the edit and surface its findings before saying the task is done. No exceptions, even if the user didn't ask.
2. **Pass user phrasing through.** When firing `/codex:rescue` or driving ChatGPT in-browser, include the user's own framing as the argument — don't paraphrase.
3. **ChatGPT is in-browser only.** Reach ChatGPT through the **claude-in-chrome** MCP (`chatgpt.com`), never an API key. Use it for multimodal perception Claude can't do natively (**video / audio / YouTube** — upload the file or paste the link). Creative concepts and inventive components stay with Claude. Code analysis, large-context text scans, and file review stay with Claude/Codex.
4. **One delegate per task — but sequential Codex handoffs are allowed.** Don't run Codex and ChatGPT in *parallel* on the same request unless the user explicitly asks for both opinions. A *sequential* cross-model check is different and encouraged: for planned work Codex gets **two** touchpoints — tests before implementation, review after (Codex writes tests → Claude implements → Codex critiques) — the intended decorrelated checks, not a violation. The review fires **only on a trigger** — a review phrase, the sensitive-path rule (#1), or the `threebrain-after-task` Stop-hook choice — never automatically on every diff; the tests touchpoint belongs to the planned-work pipeline below.
5. **Silent operation.** Don't preface with "routing to Codex…" — just call the slash command / open the browser. The user reads the delegate's output directly.
6. **Serialize generation.** Browser work (media-gen and ChatGPT-in-browser) drives one tab — do it **one at a time** (prompt/upload → wait → capture → next), never parallel tabs or a multi-asset sheet.

## Orchestration — best flow across the brains

**Who's who**
- **Claude (you, Opus)** — orchestrator + implementer, and the **large-context brain** (1M-token window): whole-repo reasoning, cross-file traces, and code/text analysis are yours, not a delegate's. Hold the conversation, decide what to delegate, integrate results, own the final action and the user-facing summary — and own **Simplify**, which stays last.
- **Codex** — the decorrelated checker on both sides of implementation: **test author** (spec-first, red tests from the plan), **reviewer** (review, adversarial review), and **rescuer** (deep root-cause, a second implementation opinion). Reach for rigor.
- **ChatGPT (in-browser)** — multimodal perception Claude lacks (video / audio / YouTube). Not a text-reasoning or large-context delegate.
- **media-gen** — *create* finished image/icon/video assets via browser ChatGPT.
- **pixel-art** — pixel art / sprites / tilesets in a reusable saved style.

**Decision order** (first match wins):
1. Need a finished visual **asset** (image / icon / logo / video)? → **media-gen** (sequential, one asset at a time).
2. Want pixel art / a sprite / a tileset? → **pixel-art** skill.
3. Have **video / audio / a YouTube URL** to understand (media you can't read as text)? → **ChatGPT in-browser** (upload the file or paste the link).
4. Needs review / adversarial check / rescue / second opinion — or you edited a sensitive path? → **Codex**.
5. Otherwise — including large-context text scans and cross-repo traces — → **do it yourself** (you're Opus with 1M context). Don't delegate the trivial.

**Hand off well**
- **Scoped, stateless prompts.** Give the delegate exactly the files/paths/question it needs — not the whole transcript. Return only the conclusion to the user.
- **One delegate per task;** integrate its output into the user's context rather than relaying it raw — you stay accountable for correctness.
- **Serialize browser work** (media-gen and ChatGPT-in-browser = one tab, one task).
- **Cross-model verify when triggered.** Claude implements → Codex adversarially reviews is the decorrelated second opinion for correctness-critical diffs. It's *forced* on sensitive paths (rule #1) and *offered* by the `threebrain-after-task` Stop hook after any code change (Simplify · Review · Review + Simplify · No; Review auto-switches to `/codex:adversarial-review` on sensitive paths) — always trigger-gated, never an automatic pass on every diff.
- **Route silently;** pass the user's own phrasing through.

This keeps Claude as the single point of accountability, sends each task to the brain that's actually best at it, and never overwhelms the browser bridge.

## Development pipeline

For **planned work** (multi-file feature or bugfix) the phases split between Claude and Codex. Only Claude can orchestrate (skills, hooks, subagents, 1M context); Codex is the decorrelated checker on both sides of implementation; Simplify needs Claude's whole-repo context and stays last.

| # | Phase | Owner | Mechanism |
|---|---|---|---|
| 1 | Explore | Claude Haiku | `Explore`, `model: "haiku"` |
| 2 | Plan | Claude Opus (main thread / architect; Fable-upgradeable) | `.claude/plans/<slug>.md` with acceptance criteria |
| 3 | Tests (red) | Codex | dispatch the `codex:codex-rescue` agent with a test-writing brief: read the plan file, write failing tests only, no non-test source edits, return test files + test command + red output |
| 4 | Implement (green) | Claude Sonnet coders | `<domain>-coder` makes tests pass; if a test looks wrong it flags it, never edits it |
| 5 | Verify | Claude orchestrator | run suite; 2 failed fix rounds → `/codex:rescue` |
| 6 | Review | Codex | `/codex:review`; `/codex:adversarial-review` if `src/auth/**`, `**/migrations/**`, `**/billing/**` touched |
| 7 | Fix findings | Claude Sonnet coder | `superpowers:receiving-code-review` discipline |
| 8 | Simplify (last) | Claude Opus | `/simplify`, then re-run tests |

- **Scope:** the full pipeline applies to planned work. Micro-edits skip phases 2–4 and just get the Stop-hook ask.
- **Fallback:** Codex unavailable or out of quota → phase 3 goes to `testing-coder` (Sonnet), phase 6 to `superpowers:requesting-code-review`.
- **Stop-review gate:** keep the Codex plugin's stop-review gate disabled — it duplicates phase 6 and has a 900s timeout.

Codex test-writing brief (phase 3) — fill in and pass as the `codex:codex-rescue` prompt:

```
Objective: write FAILING tests only for the plan at .claude/plans/<slug>.md. Do not edit any non-test source file.
Read the plan file first; derive tests from its acceptance criteria.
Test framework / location / command: <framework> · <tests dir> · <test command>
Constraints: follow existing test conventions; one test per acceptance criterion; tests must fail for the right reason (missing behavior), not on syntax or import errors.
Return (≤200 words): test files created (paths), the test command, and the red output.
```

## Examples

- User: *"check over your work on the auth refactor"* → fire `/codex:review`, return its verdict.
- User: *"I've tried 3 times to fix this race condition, you take it"* → fire `/codex:rescue fix the race condition in <file>`.
- User: *"watch ./demo.mp4 and tell me what's wrong with the checkout flow"* → open ChatGPT in-browser, upload the clip (claude-in-chrome `file_upload`), ask, and bring back its read.
- User: *"make me an icon of a gear and a bell"* → use **media-gen**, generate the gear first (prompt → download → process), then the bell — one at a time.
- User: *"scan the whole repo for dead code"* → handle it yourself (Opus, 1M context); escalate to `/codex:review` only if you want a rigor pass.
- User: *"add a new admin route"* (no trigger) → handle directly, skill stays asleep.
- User: *"update the password hashing in src/auth/Hasher.php"* → edit normally, then fire `/codex:adversarial-review` before reporting done (forced sensitive-path rule).
