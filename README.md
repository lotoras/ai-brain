# ai-brain

My public, cross-project Claude Code toolbox — packaged as a **plugin marketplace** so the skills load in every project, on any machine.

## What's inside

A single plugin, **`ai-brain`**, bundling these skills:

| Skill | What it does |
|---|---|
| **media-gen** | Generate **images / icons / video** by driving ChatGPT or Gemini in Chrome (via the `claude-in-chrome` MCP), then download and post-process. Default generator: **Gemini**. |
| **recolor-icons** | Knock out icon backgrounds and recolor PNGs — **solid by default** (any color), **gradient** on request (Petrol `#006b6e` → mid-green `#a8d680`); left dark if no color is asked. Pillow + NumPy. |
| **threebrain** | Auto-router: delegate review / adversarial / rescue to **Codex**, and video/audio/large-repo analysis to **Gemini**. |
| **cc-enhance** | Rewrite a raw prompt into a tight Role + Task block for Claude Code (Opus). Routes media/icon requests to `media-gen`. |

## Install (one-time)

```
/plugin marketplace add C:\laragon\www\ai-brain
/plugin install ai-brain@ai-brain
```

(Local-path install → edits to this repo reflect on the next session reload. The GitHub remote `lotoras/ai-brain` is an alternate source: `/plugin marketplace add lotoras/ai-brain`.)

## Layout

```
.claude-plugin/marketplace.json     # marketplace manifest
plugins/ai-brain/
  .claude-plugin/plugin.json         # plugin manifest
  skills/<name>/SKILL.md             # auto-discovered skills
```

## Editing skills

Edit the `SKILL.md` (and any sibling scripts) under `plugins/ai-brain/skills/`, then reload the session. `recolor-icons` scripts reference themselves via `${CLAUDE_PLUGIN_ROOT}` so they resolve wherever the plugin is installed.
