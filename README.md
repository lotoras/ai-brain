# ai-brain

My public, cross-project Claude Code toolbox — packaged as a **plugin marketplace** so the skills load in every project, on any machine.

## What's inside

A single plugin, **`ai-brain`**, bundling these skills:

| Skill | What it does |
|---|---|
| **media-gen** | Generate **images / icons** by driving ChatGPT in Chrome (via the `claude-in-chrome` MCP), then download and post-process; reroute to OpenRouter when a result isn't good enough. **Video** defaults to the OpenRouter API (browser Veo fallback). |
| **pixel-art** | Generates pixel art in a reusable style. Opus-direct by default, ChatGPT on request; the style is saved as a `.md` for consistency. Also builds looping sprite animations (sprite sheet + frame data). |
| **recolor-icons** | Knock out icon backgrounds and recolor PNGs — icons are delivered **dark on transparent by default**; recolor only on request: **solid** in the named color, **gradient** only if "gradient" is said (Petrol `#006b6e` → mid-green `#a8d680`); "recolor" with no color asks which. Pillow + NumPy. |
| **site-style** | Base styling for claude.ai/design and the local claude-designs toolkit: a short interview, then a `DESIGN.md` for a whole site or one ready-to-paste prompt for a single artifact. Overrides the generic AI look. |
| **animated-sections** | Animated banners, hero sections and scroll effects — code via free component registries, video via `stop-animation` / `media-gen`, Lottie for vector animation. |
| **stop-animation** | Scroll-driven / looping / hover stop animation of an object transforming: 3 AI stills → video → frames → canvas snippet. |
| **threebrain** | Auto-router: delegate test-writing (planned work, spec-first) / review / adversarial / rescue to **Codex** (`gpt-6.1-sol`), and video/audio/YouTube perception to **ChatGPT** (in-browser). Claude orchestrates and runs Simplify last. |
| **cc-enhance** | Rewrite a raw prompt into a tight Role + Task block for Claude Code (Opus). Routes media/icon requests to `media-gen`. Always ends the Task with `use ultracode`. |
| **setup-brain** | Provision a new device: install this whole plugin set + replicate config (`clauded` launcher, statusline, keybindings, global `CLAUDE.md`, `dream`) and guide the logins. |

## Set up a whole new device

Replicate the entire environment — plugins + the `clauded` bypass-permissions launcher, statusline, keybindings, global `CLAUDE.md`, and the `dream` command — and get guided through the logins that can't be scripted:

```
git clone https://github.com/lotoras/ai-brain
pwsh ai-brain\setup\setup.ps1        # Windows (add -Check for a dry run)
# or: bash ai-brain/setup/setup.sh   # Git Bash / macOS / Linux (add --check)
```

Or, once `ai-brain` is installed, just say **"set up my whole brain"** (the `setup-brain` skill drives it). Prereqs (Node + Claude Code) and the full runbook live in [`setup/SETUP.md`](setup/SETUP.md).

## Install just the plugin (one-time)

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
setup/
  setup.ps1 / setup.sh               # new-device bootstrap (idempotent, -Check/--check)
  SETUP.md                           # runbook + manual-login guide
  claude-home/                       # config snapshot copied into ~/.claude (no secrets)
  codex-home/config.toml             # Codex model pin, merged into ~/.codex/config.toml
```

## Editing skills

Edit the `SKILL.md` (and any sibling scripts) under `plugins/ai-brain/skills/`, then reload the session. `recolor-icons` scripts reference themselves via `${CLAUDE_PLUGIN_ROOT}` so they resolve wherever the plugin is installed.
