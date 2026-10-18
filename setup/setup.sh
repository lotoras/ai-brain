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
step "2/7 Global CLIs (codex)"
for pair in "codex:@openai/codex@latest:upgrade"; do
  cmd="${pair%%:*}"; rest="${pair#*:}"; pkg="${rest%%:*}"; mode="${rest##*:}"
  if have "$cmd" && [ "$mode" != "upgrade" ]; then ok "$cmd already installed"
  elif [ $CHECK -eq 1 ]; then would "npm i -g $pkg"
  else cyan "npm i -g $pkg"; npm i -g "$pkg" && ok "installed $pkg" || warn "npm install $pkg failed"; fi
done

# Codex model pin: merge setup/codex-home/config.toml -> ~/.codex/config.toml (never overrides an existing model)
CFG_SRC="$ROOT/codex-home/config.toml"; CFG_DST="$HOME/.codex/config.toml"
if [ -f "$CFG_SRC" ]; then
  if [ $CHECK -eq 1 ]; then would "merge codex-home/config.toml -> ~/.codex/config.toml (copy if missing; prepend if no top-level model; else leave)"
  elif [ ! -f "$CFG_DST" ]; then
    mkdir -p "$(dirname "$CFG_DST")"; cp "$CFG_SRC" "$CFG_DST"; ok "wrote ~/.codex/config.toml (model pin)"
  elif awk '/^[[:space:]]*\[/{exit} /^[[:space:]]*model[[:space:]]*=/{f=1} END{exit !f}' "$CFG_DST"; then
    warn "~/.codex/config.toml already sets a model - left as-is (template pin: $CFG_SRC)"
  else
    cp "$CFG_DST" "$CFG_DST.bak-$(date +%Y%m%d-%H%M%S)"
    { cat "$CFG_SRC"; printf '\n'; cat "$CFG_DST"; } > "$CFG_DST.tmp" && mv "$CFG_DST.tmp" "$CFG_DST" && ok "prepended model pin to ~/.codex/config.toml (backup kept alongside)"
  fi
fi

# 3) Marketplaces
step "3/7 Plugin marketplaces"
for m in anthropics/claude-plugins-official openai/codex-plugin-cc lotoras/ai-brain; do
  if [ $CHECK -eq 1 ]; then would "claude plugin marketplace add $m"
  else claude plugin marketplace add "$m" && ok "marketplace $m" || warn "marketplace $m (already added?)"; fi
done

# 4) Plugins
step "4/7 Plugins (user scope)"
PLUGINS="superpowers@ai-brain frontend-design@claude-plugins-official codex@openai-codex ai-brain@ai-brain"
for p in $PLUGINS; do
  if [ $CHECK -eq 1 ]; then would "claude plugin install $p --scope user (+ enable)"
  else
    claude plugin install "$p" --scope user && claude plugin enable "${p%@*}" >/dev/null 2>&1 && ok "plugin $p" || warn "plugin $p (already installed?)"
  fi
done
# Keep every marketplace and plugin current (non-fatal; installs otherwise stay on an old cached version)
if [ $CHECK -eq 1 ]; then would "claude plugin marketplace update; claude plugin update <each plugin>"
else
  claude plugin marketplace update || warn "marketplace update failed - continuing"
  for p in $PLUGINS; do
    claude plugin update "$p" && ok "$p up to date" || warn "$p update failed - continuing"
  done
fi
# Free design MCP servers, user scope (idempotent: skipped when already registered)
MCPS="shadcn|-- npx -y shadcn@latest mcp
magicui|-- npx -y @magicuidesign/mcp@latest
lottiefiles|--transport http https://mcp.lottiefiles.com/mcp"
if [ $CHECK -eq 1 ]; then would "claude mcp add --scope user shadcn magicui lottiefiles (skipped if already registered)"
else
  REGISTERED="$(claude mcp list 2>/dev/null)"
  printf '%s\n' "$MCPS" | while IFS='|' read -r m args; do
    if printf '%s\n' "$REGISTERED" | grep -q "^$m:"; then ok "mcp $m already registered"; continue; fi
    # shellcheck disable=SC2086 # args is a word list on purpose
    claude mcp add --scope user "$m" $args </dev/null && ok "mcp $m" || warn "mcp $m add failed - continuing"
  done
  cyan "lottiefiles: run /mcp in Claude Code and sign in once"
fi

# 5) Config copy with backup
step "5/7 Config -> ~/.claude (with backup)"
STAMP="$(date +%Y%m%d-%H%M%S)"; BK="$CLAUDE_DIR/backup/$STAMP"; MERGE_JS="$ROOT/merge-settings.js"
for rel in settings.json statusline-command.js keybindings.json CLAUDE.md commands/dream.md hooks/threebrain-after-task.js hooks/session-model-guard.js hooks/fable-edit-guard.js; do
  src="$SNAP/$rel"; dst="$CLAUDE_DIR/$rel"
  [ -f "$src" ] || { warn "snapshot missing $rel"; continue; }
  if [ $CHECK -eq 1 ]; then
    if [ "$rel" = "settings.json" ]; then would "merge settings.json -> ~/.claude/settings.json (backup first; preserves local keys like permissions.allow)"
    else would "copy $rel -> ~/.claude/$rel (backup existing first)"; fi
    continue
  fi
  if [ -f "$dst" ]; then mkdir -p "$(dirname "$BK/$rel")"; cp "$dst" "$BK/$rel"; fi
  mkdir -p "$(dirname "$dst")"
  if [ "$rel" = "settings.json" ]; then
    if node "$MERGE_JS" "$src" "$dst"; then ok "merged ~/.claude/settings.json (local keys preserved)"
    else warn "settings.json merge failed - writing snapshot as-is"; cp "$src" "$dst"; fi
  else
    cp "$src" "$dst"; ok "wrote ~/.claude/$rel"
  fi
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
  have codex  && ok "codex $(codex --version 2>/dev/null)"
  claude plugin list 2>/dev/null || true
fi

cat <<'CHK'

== Manual steps (guided auth - nothing stored) ==
  1. Claude login:      run 'claude' once and sign in (Anthropic).
  2. Codex CLI auth:    run 'codex login' (OpenAI / ChatGPT).
  3. Claude-in-Chrome:  install the 'Claude in Chrome' extension, then let it pair in a Claude session (click Connect); name it (e.g. luka_computer).
  4. media-gen logins:  sign in to chatgpt.com in that Chrome profile (and gemini.google.com if you want Veo video).
  5. (optional) Enable claude.ai connectors (Gmail/Calendar/Drive/Stunden) at claude.ai.
  6. Restart your shell so 'clauded' resolves, then start Claude with:  clauded
CHK
printf '\033[32mDone.\033[0m\n'
