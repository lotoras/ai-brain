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
2. **Global CLIs** — `npm i -g @openai/codex@latest` (always upgrades, even if installed), then
   merges `setup/codex-home/config.toml` into `~/.codex/config.toml` to pin the default
   `model = "gpt-6-astra"` + `model_reasoning_effort = "high"` (serves `/codex:review` and
   `/codex:rescue`; the "use codex" test-writing step overrides it per call with
   `--model gpt-6.1-sol --effort medium`, high for risky domains): copied if missing, prepended if the file has no top-level
   `model =` line (backup kept alongside), left untouched with a notice if it already sets a model.
   The same template also carries three top-level keys: `forced_login_method = "chatgpt"`
   (subscription only, never an API-key fallback), `project_doc_fallback_filenames = ["CLAUDE.md"]`
   (Codex reads the project's CLAUDE.md as its project doc when AGENTS.md is missing) and
   `sandbox_workspace_write.network_access = true` (npm/composer installs and networked tests in
   `--write` runs). A fourth, `sandbox_workspace_write.writable_roots`, is rendered per machine (not in
   the template): the npm and Composer cache dirs (`%LOCALAPPDATA%\npm-cache`, `%LOCALAPPDATA%\Composer`
   on Windows; `~/.npm`, `~/.cache/composer`, `~/.composer` on macOS/Linux), because npm fails with
   EPERM when its cache sits outside the sandbox's writable roots. On an existing config, any of these
   four keys that is missing is inserted at the end of the top-level region (before the first table);
   an existing key is never overridden, and a `[sandbox_workspace_write]` table skips the two dotted
   `sandbox_workspace_write.*` keys with a warning.
   On Windows (`setup.ps1`) it also appends `setup/codex-home/config.windows.toml`
   (`[windows] sandbox = "unelevated"`) unless a `[windows]` table exists — without it native
   Windows Codex silently downgrades `--write` to read-only, so `codex:codex-rescue` can't write
   tests or fixes. `setup.sh` (macOS/Linux) doesn't need it.
   Don't use the codex plugin's `spark` alias — it maps to the stale `gpt-5.3-codex-spark`.
3. **Marketplaces** — adds `anthropics/claude-plugins-official`, `openai/codex-plugin-cc`,
   `lotoras/ai-brain`.
4. **Plugins (user scope)** — installs + enables `superpowers@ai-brain`, `frontend-design`, `codex`,
   `ai-brain`. Then runs `claude plugin marketplace update openai-codex` and
   `claude plugin update codex@openai-codex` (non-fatal) so the codex plugin stays current. Keep its
   stop-review gate off (`/codex:setup --disable-review-gate`) — it duplicates the pipeline's Review phase.
5. **Config → `~/.claude`** — backs up any existing files to `~/.claude/backup/<timestamp>/`, then
   writes `statusline-command.js`, `keybindings.json`, `CLAUDE.md`, `commands/dream.md`, and
   `hooks/threebrain-after-task.js`. `settings.json` is **merged** (not overwritten) via
   `merge-settings.js`, so your local keys — notably the `permissions.allow` list — are preserved
   across re-runs while the curated keys (plugins, marketplaces, hooks) are applied.
6. **`clauded` launcher** — PowerShell `$PROFILE` function, `~/.bashrc` alias, and
   `~/.local/bin/clauded.cmd` (all = `claude --dangerously-skip-permissions`).

### End-of-task threebrain prompt
The snapshot installs a `Stop` hook (`~/.claude/hooks/threebrain-after-task.js`) that, **only when the
task is confirmed to have changed code** (an `Edit`/`Write`/`MultiEdit`/`NotebookEdit` tool call since
the last user turn), asks via a menu whether to run a threebrain pass over the changes:
**Simplify** (`/simplify`) · **Review** (`/codex:review`, auto-switching to `/codex:adversarial-review`
on `src/auth/**`, `**/migrations/**`, `**/billing/**`) · **Review + Simplify** (Review → fix → Simplify
last) · **No**. It also counts edits made by subagents and `codex:codex-rescue` dispatches. It's a strict
allow-list — it stays silent on read-only / Q&A tasks **and** whenever it can't inspect history
(no/unreadable transcript) — and guards against re-prompting loops (`stop_hook_active` + a transcript
marker). Activates from the next session (Claude Code may show a one-time hook-approval prompt).

## Manual steps (guided — nothing is stored)
| # | Step | How |
|---|---|---|
| 1 | **Claude login** | `claude` → sign in (Anthropic). |
| 2 | **Codex CLI** | `codex login` → OpenAI / ChatGPT. Powers the `codex` plugin. |
| 3 | **Claude-in-Chrome** | Install the *Claude in Chrome* extension. In a Claude session let it pair (click **Connect** in the extension); name it (e.g. `luka_computer`). Powers the `media-gen` browser fallback and ChatGPT perception. |
| 4 | **media-gen logins** | Image generation uses the Codex CLI login (step 2). For the browser fallback, sign in to **chatgpt.com** in that Chrome profile (and **gemini.google.com** if you want Veo video). |
| 5 | **OpenRouter key** | Create `<ai-brain repo>/.env` containing `OPENROUTER_API_KEY=<your key>` (git-ignored). Used by `media-gen` / `stop-animation` for OpenRouter **video** generation. Image reroute needs a logged-in Codex CLI with `image_generation` (`codex features list`), no key. Keys: openrouter.ai/keys. |
| 6 | **(optional) claude.ai connectors** | Enable Gmail / Calendar / Drive / Stunden at claude.ai if you use them. |
| 7 | **Restart your shell** | so `clauded` resolves, then start Claude with `clauded`. |

## Verify
- `claude plugin list` → the 4 user plugins enabled.
- `clauded --version` works in a fresh shell.
- Statusline shows `📂 cwd · 🤖 model · 🧠 tokens · #session`.
- `codex --version` responds.

Re-running the script is safe — it skips installed items and re-backs-up config.
