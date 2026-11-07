---
name: explain
description: Use when the user wants more or deeper explanation than a text answer gives — "explain more", "explain in detail", "explain it visually", "explain with a picture / diagram", "I don't get it", "I still don't understand", "diagram this", "draw how X works", "show me how X flows", "visualize this", "make an HTML page for it", "make me an explainer", or says yes to an offered explainer page. Builds a diagram or interactive HTML page that opens in Chrome by itself. Not for finished image/icon/video assets (media-gen), charts of real data in an app (dataviz), or website styling (site-style).
---

# Explain with a page

The `ai-brain:explainer` agent (Sonnet, low effort) builds one self-contained HTML page and opens
it in Chrome by itself. You hand it the facts; it does not explore. Pages are throwaway: they live
in the session scratchpad, never in the repo.

## 1. Choose the form
- Flow, sequence, architecture, state, data path → **diagram page** (inline SVG, short captions).
- Data, comparison, options side by side, step-through, "what happens if" → **interactive HTML
  page** (tabs, steps, toggles; still with a diagram where it helps).
- Video explainers are not built yet. If the user asks for one, say so and offer a page.

## 2. Write the brief
The agent sees only the brief, so make it self-contained:
- the user's question, verbatim;
- what to explain, for whom (the user), and how deep;
- every fact you already have: names, `file:line` refs, numbers, the order of steps, the text answer
  you gave;
- the user's language;
- the output path: `<scratchpad>/explain/<short-slug>.html`, written as an absolute path (the
  scratchpad path from your environment section). If your environment lists no scratchpad
  (headless `claude -p`), use `<OS temp dir>/claude-explain/<short-slug>.html`; the after-task hooks
  then count the page as a change, which is expected there.

## 3. Dispatch
```
Agent(subagent_type: "ai-brain:explainer", run_in_background: true,
      description: "Explainer page: <topic>", prompt: <brief>)
```
- Do not pass `model` or `effort`: the agent's frontmatter sets them.
- Tell the user in one line: "Building the page; it opens in Chrome when ready." Then end the turn.
- For two independent topics, dispatch two agents in one message.

## 4. When it returns
- Reply in one line with the page's absolute path.
- If it reports `Opened: no`, run the command it names again, or open the file in the default
  browser.

## 5. Follow-ups
- Changes to the page ("add the error path", "bigger font"): `SendMessage` to the same agent, not a
  new spawn. It rewrites the same file and opens it again.
- Share or keep it: only on ask, publish the file with the Artifact tool (load `artifact-design`
  first).
