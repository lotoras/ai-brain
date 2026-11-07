# Karpathy's output ladder: understanding LLM output through richer formats

**Status:** rungs 1–3 applied 2026-11-07 (ai-brain plugin 0.13.0); the video rung is still an idea. See §5.
**Source:** Andrej Karpathy, [X post](https://x.com/karpathy/status/2105819303471976479) (2026-10-02, read verbatim in Chrome).

## 1. What the post says

Premise: we will spend much more time *understanding* model output than producing it. Each format below is "even better" than the one before:

1. **Writing in ASD-STE100.** Ask the LLM to explain something in ASD-STE100, a controlled-language spec from aerospace maintenance docs. Its strict style rules make text more readable. If the spec is too stringent, ask for "80% of the way to ASD-STE100".
2. **Diagrams / images.** Instead of prose, ask for a diagram. Easier to process, parse and understand.
3. **Web pages.** Ask for output "in HTML" to get a beautiful, interactive page with animations.
4. **Explainer videos.** The format he is most bullish on: bespoke videos on any topic. Example prompt: *"Create a 3b1b style video explainer on X. Use my ElevenLabs API key for audio narration."* Needs an API key, or ask the LLM for free local-compute alternatives. "This is actually starting to work!"

Summary points:
- As LLMs do more legwork autonomously, our work rises to oversight and understanding.
- Code is abundant, so ask for large, custom, **discardable** software artifacts (web apps, video explainers) that were never worth building before.

## 2. What we already have in ai-brain

| Rung | Existing piece |
|---|---|
| Text | nothing (no ASD-STE100 / controlled-language mode) |
| Diagram | `artifact-diagramming` skill, `dataviz` skill |
| HTML | Artifact tool + `artifact-design` skill, `frontend-design`, `animated-sections` |
| Video | `media-gen` (OpenRouter video), `stop-animation`; no narration, no 3b1b-style (Manim) pipeline |

## 3. Implementation ideas

1. **`explain` skill (the ladder itself).** Given a topic or a long output, ask once which rung fits (or pick by content: process → diagram, data or interaction → HTML, concept over time → video) and produce it. Default to the lowest rung that works.
2. **ASD-STE100 mode.** A short style block usable by any skill: short sentences (about 20 words max), one idea each, active voice, simple verbs, no figurative language. Offer a "soft" variant (80%). Could be a flag on `explain` or a snippet in `cc-enhance`.
3. **Explainer video pipeline.** Script → Manim (3b1b-style) scenes → narration → merged mp4. Narration via ElevenLabs only if a key exists; otherwise a free local TTS. Reuse `media-gen` for any generated stills. This is the only rung that needs new tooling.
4. **Discardable artifacts.** Treat explainers as throwaway: write to the scratchpad or an Artifact, never into the repo, unless asked.

## 4. Open questions

- Is video worth the build cost compared with HTML-with-animation for most topics?
- Local TTS choice (quality vs. setup effort on Windows).
- Where the ASD-STE100 style block should live so it doesn't add to the always-on policy load (see `single-loop-setup.md`: keep it in a skill, loaded on demand). → Answered in §5: the style must apply to every answer, so it is a short always-on block.

## 5. What was applied (2026-11-07)

| Rung | Piece | Where |
|---|---|---|
| Text | "80% of the way to ASD-STE100" for all chat text (~700 B always-on) | global `CLAUDE.md` → "How to talk to me" (`setup/claude-home/CLAUDE.md`); same rules in `setup/codex-home/AGENTS.md` (Codex) and in claude.ai → Settings → Your Claude → Instructions (all claude.ai chats) |
| Diagram + HTML | `explain` skill: build a page when asked, else a one-line offer after long answers | `plugins/ai-brain/skills/explain/SKILL.md` |
| Diagram + HTML | `ai-brain:explainer` agent: Sonnet at low effort, background, one pass, opens the page in Chrome by itself | `plugins/ai-brain/agents/explainer.md` |

Decisions:
- **Global CLAUDE.md, not an output style.** The official plugins call output styles deprecated (`explanatory-output-style` README). A skill is on demand, but the style must be always on.
- **Local pages, not Artifacts.** Pages go to `<scratchpad>/explain/<slug>.html`, and nothing is uploaded. The agent opens the page itself, so no main-loop turn sits in between. A page becomes an Artifact only when the user asks to share it.
- **Speed:** Sonnet at low effort, `run_in_background`, a self-contained brief (no exploring), no screenshot loop.
- **Hooks:** scratchpad writes no longer count as "changed code" (`hooks/lib/transcript.js`), so an explainer turn sets off neither the threebrain ask nor a chat-log entry.
- **Video:** not built. The open questions in §4 still apply.
