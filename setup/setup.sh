#!/usr/bin/env bash
# setup.sh - provision "the whole brain" (Git Bash on Windows, or macOS/Linux best-effort).
#
# Usage:
#   bash setup/setup.sh           # run it
#   bash setup/setup.sh --check   # dry run: print planned actions, change nothing
#
# Idempotent; re-running skips installed items and re-backs-up config.
# No secrets handled - logins are guided, not stored.
set -uo pipefail

CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAP="$ROOT/claude-home"
CLAUDE_DIR="$HOME/.claude"

cyan(){ printf '\033[36m  %s\033[0m\n' "$1"; }
ok(){   printf '\033[32m  [ok] %s\033[0m\n' "$1"; }
warn(){ printf '\033[33m  [!] %s\033[0m\n' "$1"; }
step(){ printf '\n\033[35m== %s ==\033[0m\n' "$1"; }
would(){ printf '\033[90m  [check] would %s\033[0m\n' "$1"; }
have(){ command -v "$1" >/dev/null 2>&1; }

[ $CHECK -eq 1 ] && printf '\033[33mDRY RUN - no changes.\033[0m\n'

# 1) Preflight
step "1/7 Preflight"
missing=()
for c in node npm claude; do
  if have "$c"; then ok "$c -> $(command -v "$c")"; else missing+=("$c"); warn "$c NOT found"; fi
done
if [ ${#missing[@]} -gt 0 ]; then
  warn "Install missing prerequisites first: ${missing[*]}"
  printf '    Node (nvm): https://github.com/nvm-sh/nvm   |   Claude: npm i -g @anthropic-ai/claude-code\n'
  exit 1
fi

# 2) Global CLIs
step "2/7 Global CLIs (gemini, codex)"
for pair in "gemini:@google/gemini-cli" "codex:@openai/codex"; do
  cmd="${pair%%:*}"; pkg="${pair#*:}"
  if have "$cmd"; then ok "$cmd already installed"
  elif [ $CHECK -eq 1 ]; then would "npm i -g $pkg"
  else cyan "npm i -g $pkg"; npm i -g "$pkg" && ok "installed $pkg" || warn "npm install $pkg failed"; fi
done

# 3) Marketplaces
step "3/7 Plugin marketplaces"
for m in anthropics/claude-plugins-official openai/codex-plugin-cc thepushkarp/cc-gemini-plugin lotoras/ai-brain; do
  if [ $CHECK -eq 1 ]; then would "claude plugin marketplace add $m"
  else claude plugin marketplace add "$m" && ok "marketplace $m" || warn "marketplace $m (already added?)"; fi
done

# 4) Plugins
step "4/7 Plugins (user scope)"
for p in superpowers@claude-plugins-official frontend-design@claude-plugins-official codex@openai-codex cc-gemini-plugin@cc-gemini-plugin ai-brain@ai-brain; do
  if [ $CHECK -eq 1 ]; then would "claude plugin install $p --scope user (+ enable)"
  else
    claude plugin install "$p" --scope user && claude plugin enable "${p%@*}" >/dev/null 2>&1 && ok "plugin $p" || warn "plugin $p (already installed?)"
  fi
done

# 5) Config copy with backup
step "5/7 Config -> ~/.claude (with backup)"
STAMP="$(date +%Y%m%d-%H%M%S)"; BK="$CLAUDE_DIR/backup/$STAMP"
for rel in settings.json statusline-command.js keybindings.json CLAUDE.md commands/dream.md; do
  src="$SNAP/$rel"; dst="$CLAUDE_DIR/$rel"
  [ -f "$src" ] || { warn "snapshot missing $rel"; continue; }
  if [ $CHECK -eq 1 ]; then would "copy $rel -> ~/.claude/$rel (backup existing first)"; continue; fi
  if [ -f "$dst" ]; then mkdir -p "$(dirname "$BK/$rel")"; cp "$dst" "$BK/$rel"; fi
  mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"; ok "wrote ~/.claude/$rel"
done
[ $CHECK -eq 0 ] && [ -d "$BK" ] && cyan "backed up prior config to $BK"

# 6) clauded launcher
step "6/7 clauded launcher (bypass-permissions)"
if [ $CHECK -eq 1 ]; then
  would "add 'alias clauded' to ~/.bashrc"; would "write ~/.local/bin/clauded.cmd"; would "add 'function clauded' to PowerShell profile (if present)"
else
  if ! grep -q 'alias clauded' "$HOME/.bashrc" 2>/dev/null; then
    printf "\nalias clauded='claude --dangerously-skip-permissions'\n" >> "$HOME/.bashrc"; ok "bash alias added to ~/.bashrc"
  else ok "bash alias already present"; fi
  mkdir -p "$HOME/.local/bin"
  printf '@echo off\r\nclaude --dangerously-skip-permissions %%*\r\n' > "$HOME/.local/bin/clauded.cmd"; ok "wrote ~/.local/bin/clauded.cmd"
  for ps in pwsh powershell; do
    if have "$ps"; then
      "$ps" -NoProfile -Command 'if(-not (Test-Path (Split-Path $PROFILE))){New-Item -ItemType Directory -Force -Path (Split-Path $PROFILE)|Out-Null}; if(-not (Test-Path $PROFILE) -or -not (Select-String -Path $PROFILE -Pattern "function clauded" -Quiet)){Add-Content $PROFILE "`nfunction clauded { claude --dangerously-skip-permissions @args }"}' >/dev/null 2>&1 && ok "PowerShell ($ps): clauded function ensured"
      break
    fi
  done
fi

# 7) Verify
step "7/7 Verify"
if [ $CHECK -eq 0 ]; then
  have claude && ok "claude $(claude --version 2>/dev/null)"
  have gemini && ok "gemini $(gemini --version 2>/dev/null)"
  have codex  && ok "codex $(codex --version 2>/dev/null)"
  claude plugin list 2>/dev/null || true
fi

cat <<'CHK'

== Manual steps (guided auth - nothing stored) ==
  1. Claude login:      run 'claude' once and sign in (Anthropic).
  2. Gemini CLI auth:   run 'gemini' once and sign in (Google). Use --skip-trust in untrusted dirs.
  3. Codex CLI auth:    run 'codex login' (OpenAI / ChatGPT).
  4. Claude-in-Chrome:  install the 'Claude in Chrome' extension, then let it pair in a Claude session (click Connect); name it (e.g. luka_computer).
  5. media-gen logins:  sign in to chatgpt.com and gemini.google.com in that Chrome profile.
  6. (optional) Enable claude.ai connectors (Gmail/Calendar/Drive/Stunden) at claude.ai.
  7. Restart your shell so 'clauded' resolves, then start Claude with:  clauded
CHK
printf '\033[32mDone.\033[0m\n'
