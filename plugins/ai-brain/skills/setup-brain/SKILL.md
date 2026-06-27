---
name: setup-brain
description: Use when the user wants to provision a device with their full Claude Code environment — "set up my whole brain", "setup my claude according to this", "provision this machine / new device". Runs the ai-brain bootstrap (plugins, config, clauded launcher, statusline, dream) then guides the logins that can't be scripted (Claude, Gemini CLI, Codex CLI, Claude-in-Chrome, ChatGPT/Gemini web).
---

# setup-brain — provision the whole brain

Bring a device up to the user's full Claude Code setup. The heavy lifting is a bootstrap script in
this repo (`setup/setup.ps1` / `setup/setup.sh`); your job is to **run it and then guide the manual
logins one at a time, verifying each**.

## 0. Locate the repo + scripts
The bootstrap lives at the repo root under `setup/`, not inside the plugin. Find it (first hit wins):
- `%USERPROFILE%\.claude\plugins\marketplaces\ai-brain\setup\` (the marketplace clone — present once
  `claude plugin marketplace add lotoras/ai-brain` has run)
- the user's dev clone, e.g. `C:\laragon\www\ai-brain\setup\`
- otherwise `git clone https://github.com/lotoras/ai-brain` to a temp dir and use that.

**Virgin-device note:** on a brand-new machine this skill isn't installed yet — so the *first* setup
is run from a clone (`pwsh ai-brain\setup\setup.ps1`). This skill is for re-running/repair and for
machines where `ai-brain` is already installed.

## 1. Run the bootstrap
- Detect the OS/shell. On Windows run `pwsh setup\setup.ps1` (fall back to
  `powershell -ExecutionPolicy Bypass -File setup\setup.ps1`); on Git Bash / macOS / Linux run
  `bash setup/setup.sh`.
- Offer a dry run first (`-Check` / `--check`) so the user sees the plan, then the real run.
- The script is idempotent and backs up existing `~/.claude` config to `~/.claude/backup/<timestamp>/`.
- It installs: marketplaces + the 5 user plugins (superpowers, frontend-design, codex,
  cc-gemini-plugin, ai-brain), the `gemini` + `codex` CLIs, the config snapshot, and the `clauded`
  launcher. Read its output back to the user; surface any `[!]` warnings.

## 2. Guide the manual logins — one at a time, verify each
Walk these in order. Do each, then verify before moving on. **Never handle or store credentials** —
the user signs in themselves.
1. **Claude** — `claude` → sign in (Anthropic). Verify: `claude --version` and that it's logged in.
2. **Gemini CLI** — `gemini` → sign in (Google). Powers `cc-gemini-plugin`. Note `--skip-trust` for
   untrusted dirs. Verify: `gemini --version`.
3. **Codex CLI** — `codex login` (OpenAI / ChatGPT). Powers the `codex` plugin. Verify: `codex --version`.
4. **Claude-in-Chrome** — have the user install the *Claude in Chrome* extension, then trigger pairing:
   load the browser MCP tools (`ToolSearch select:mcp__claude-in-chrome__switch_browser`), call
   `switch_browser`, and have the user click **Connect** and name the browser (e.g. `luka_computer`).
   Powers `media-gen`.
5. **media-gen web logins** — open `chatgpt.com` and `gemini.google.com` in that Chrome profile and
   have the user sign in.
6. **(optional) claude.ai connectors** — Gmail / Calendar / Drive / Stunden at claude.ai, if used.

## 3. Final verify
- `claude plugin list` → the 5 user plugins enabled.
- `clauded --version` works in a **fresh** shell (remind the user to restart their shell / that
  `~/.local/bin` must be on PATH).
- Statusline renders `📂 cwd · 🤖 model · 🧠 tokens · #session`.
- Summarize what's done and what (if anything) still needs a login.

## Safety
`bypassPermissions` + `clauded` (`--dangerously-skip-permissions`) is the user's deliberate choice for
a trusted personal machine. Mention it once; don't set it up on a shared/untrusted device without
confirming. The repo and this flow store **no** secrets.
