# Setup my whole brain

Provision a new device with Luka's full Claude Code environment: the `ai-brain` plugin set, the
`clauded` bypass-permissions launcher, the statusline, keybindings, the global `CLAUDE.md`, and the
`dream` command — then a guided pass through the logins that can't be scripted.

> ⚠️ This sets `permissions.defaultMode = "bypassPermissions"` and a `clauded` launcher that runs
> Claude Code with `--dangerously-skip-permissions`. That's a deliberate choice for a trusted
> personal machine — don't deploy it somewhere untrusted.

## Prerequisites (install manually first)
1. **Node + npm** (via [nvm-windows](https://github.com/coreybutler/nvm-windows) → `nvm install lts; nvm use lts`).
2. **Claude Code** — native installer, or `npm i -g @anthropic-ai/claude-code`. Then run `claude` once and sign in.

Everything else is automated by the script.

## Quick start
```powershell
git clone https://github.com/lotoras/ai-brain
pwsh ai-brain\setup\setup.ps1          # Windows (primary).  Add -Check for a dry run.
# or, in Git Bash / macOS / Linux:
bash ai-brain/setup/setup.sh           # add --check for a dry run
```
…or, once the `ai-brain` plugin is installed, just open Claude and say **"set up my whole brain"** —
the `setup-brain` skill runs the script and walks you through the logins.

## What the script does (idempotent, backs up existing config)
1. **Preflight** — checks `node` / `npm` / `claude` are present (stops with guidance if not).
2. **Global CLIs** — `npm i -g @google/gemini-cli @openai/codex` (skips if already installed).
3. **Marketplaces** — adds `anthropics/claude-plugins-official`, `openai/codex-plugin-cc`,
   `thepushkarp/cc-gemini-plugin`, `lotoras/ai-brain`.
4. **Plugins (user scope)** — installs + enables `superpowers`, `frontend-design`, `codex`,
   `cc-gemini-plugin`, `ai-brain`.
5. **Config → `~/.claude`** — backs up any existing files to `~/.claude/backup/<timestamp>/`, then
   writes `statusline-command.js`, `keybindings.json`, `CLAUDE.md`, `commands/dream.md`, and
   `hooks/threebrain-after-task.js`. `settings.json` is **merged** (not overwritten) via
   `merge-settings.js`, so your local keys — notably the `permissions.allow` list — are preserved
   across re-runs while the curated keys (plugins, marketplaces, hooks) are applied.
6. **`clauded` launcher** — PowerShell `$PROFILE` function, `~/.bashrc` alias, and
   `~/.local/bin/clauded.cmd` (all = `claude --dangerously-skip-permissions`).

### End-of-task threebrain prompt
The snapshot installs a `Stop` hook (`~/.claude/hooks/threebrain-after-task.js`) that, **after any
task that changed code/files**, asks via a menu whether to run a threebrain pass over the changes:
**Simplify** (`/simplify`) · **Review** (`/codex:review`) · **Both** · **No**. It stays silent on
read-only / Q&A tasks, and guards against re-prompting loops (`stop_hook_active` + a transcript
marker). Activates from the next session (Claude Code may show a one-time hook-approval prompt).

## Manual steps (guided — nothing is stored)
| # | Step | How |
|---|---|---|
| 1 | **Claude login** | `claude` → sign in (Anthropic). |
| 2 | **Gemini CLI** | `gemini` → sign in (Google). Powers the `cc-gemini-plugin`. Use `--skip-trust` in untrusted dirs. |
| 3 | **Codex CLI** | `codex login` → OpenAI / ChatGPT. Powers the `codex` plugin. |
| 4 | **Claude-in-Chrome** | Install the *Claude in Chrome* extension. In a Claude session let it pair (click **Connect** in the extension); name it (e.g. `luka_computer`). Powers `media-gen`. |
| 5 | **media-gen logins** | Sign in to **chatgpt.com** and **gemini.google.com** in that Chrome profile. |
| 6 | **(optional) claude.ai connectors** | Enable Gmail / Calendar / Drive / Stunden at claude.ai if you use them. |
| 7 | **Restart your shell** | so `clauded` resolves, then start Claude with `clauded`. |

## Verify
- `claude plugin list` → the 5 user plugins enabled.
- `clauded --version` works in a fresh shell.
- Statusline shows `📂 cwd · 🤖 model · 🧠 tokens · #session`.
- `gemini --version`, `codex --version` respond.

Re-running the script is safe — it skips installed items and re-backs-up config.
