#requires -Version 5.1
<#
  setup.ps1 - provision "the whole brain" on a Windows device.

  Installs the ai-brain plugin set, replicates config (clauded launcher, statusline,
  keybindings, global CLAUDE.md, dream command), then prints a manual auth checklist.

  Usage:
    pwsh setup\setup.ps1           # run it
    pwsh setup\setup.ps1 -Check    # dry run: print planned actions, change nothing

  Idempotent: re-running skips already-installed items and re-backs-up config.
  No secrets are handled - logins are guided, not stored.
#>
[CmdletBinding()]
param([switch]$Check)

$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$homeSnap  = Join-Path $root 'claude-home'
$claudeDir = Join-Path $env:USERPROFILE '.claude'

function Info($m){ Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "  [!] $m" -ForegroundColor Yellow }
function Step($m){ Write-Host "`n== $m ==" -ForegroundColor Magenta }
function Would($m){ Write-Host "  [check] would $m" -ForegroundColor DarkGray }
function Have($c){ [bool](Get-Command $c -ErrorAction SilentlyContinue) }

if($Check){ Write-Host "DRY RUN - no changes will be made.`n" -ForegroundColor Yellow }

# 1) Preflight ---------------------------------------------------------------
Step "1/7 Preflight"
$missing = @()
foreach($c in 'node','npm','claude'){
  if(Have $c){ Ok "$c -> $((Get-Command $c).Source)" } else { $missing += $c; Warn "$c NOT found" }
}
if($missing.Count){
  Warn "Install the missing prerequisites first, then re-run:"
  if($missing -contains 'node'){ Info "Node (nvm-windows): https://github.com/coreybutler/nvm-windows  ->  nvm install lts; nvm use lts" }
  if($missing -contains 'claude'){ Info "Claude Code: npm i -g @anthropic-ai/claude-code (or the native installer), then run 'claude' to log in" }
  throw "Missing prerequisites: $($missing -join ', ')"
}

# 2) Global CLIs -------------------------------------------------------------
Step "2/7 Global CLIs (gemini, codex)"
foreach($t in @(@{cmd='gemini';pkg='@google/gemini-cli'},@{cmd='codex';pkg='@openai/codex'})){
  if(Have $t.cmd){ Ok "$($t.cmd) already installed" }
  elseif($Check){ Would "npm i -g $($t.pkg)" }
  else{ Info "npm i -g $($t.pkg)"; npm i -g $t.pkg; if($LASTEXITCODE -eq 0){ Ok "installed $($t.pkg)" } else { Warn "npm install $($t.pkg) returned $LASTEXITCODE" } }
}

# 3) Marketplaces ------------------------------------------------------------
Step "3/7 Plugin marketplaces"
foreach($m in 'anthropics/claude-plugins-official','openai/codex-plugin-cc','thepushkarp/cc-gemini-plugin','lotoras/ai-brain'){
  if($Check){ Would "claude plugin marketplace add $m"; continue }
  claude plugin marketplace add $m
  if($LASTEXITCODE -eq 0){ Ok "marketplace $m" } else { Warn "marketplace $m (already added?)" }
}

# 4) Plugins -----------------------------------------------------------------
Step "4/7 Plugins (user scope)"
foreach($p in 'superpowers@claude-plugins-official','frontend-design@claude-plugins-official','codex@openai-codex','cc-gemini-plugin@cc-gemini-plugin','ai-brain@ai-brain'){
  if($Check){ Would "claude plugin install $p --scope user (+ enable)"; continue }
  claude plugin install $p --scope user
  claude plugin enable ($p.Split('@')[0]) 2>$null
  if($LASTEXITCODE -eq 0){ Ok "plugin $p" } else { Warn "plugin $p (already installed?)" }
}

# 5) Config copy with backup -------------------------------------------------
Step "5/7 Config -> ~/.claude (with backup)"
$files = @('settings.json','statusline-command.js','keybindings.json','CLAUDE.md','commands/dream.md')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $claudeDir "backup/$stamp"
foreach($rel in $files){
  $srcF = Join-Path $homeSnap $rel
  $dstF = Join-Path $claudeDir $rel
  if(-not (Test-Path $srcF)){ Warn "snapshot missing $rel (skip)"; continue }
  if($Check){ Would "copy $rel -> ~/.claude/$rel (backup existing first)"; continue }
  if(Test-Path $dstF){
    $b = Join-Path $backup $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $b) | Out-Null
    Copy-Item $dstF $b -Force
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $dstF) | Out-Null
  Copy-Item $srcF $dstF -Force
  Ok "wrote ~/.claude/$rel"
}
if(-not $Check -and (Test-Path $backup)){ Info "backed up prior config to $backup" }

# 6) clauded launcher --------------------------------------------------------
Step "6/7 clauded launcher (bypass-permissions)"
if($Check){
  Would "add 'function clauded' to your PowerShell `$PROFILE"
  Would "add 'alias clauded' to ~/.bashrc"
  Would "write ~/.local/bin/clauded.cmd"
} else {
  $profDir = Split-Path $PROFILE
  if(-not (Test-Path $profDir)){ New-Item -ItemType Directory -Force -Path $profDir | Out-Null }
  if(-not (Test-Path $PROFILE) -or -not (Select-String -Path $PROFILE -Pattern 'function clauded' -Quiet)){
    Add-Content -Path $PROFILE -Value "`nfunction clauded { claude --dangerously-skip-permissions @args }"
    Ok "PowerShell: clauded added to $PROFILE"
  } else { Ok "PowerShell: clauded already in profile" }

  $bashrc = Join-Path $env:USERPROFILE '.bashrc'
  if(-not (Test-Path $bashrc) -or -not (Select-String -Path $bashrc -Pattern 'alias clauded' -Quiet)){
    Add-Content -Path $bashrc -Value "`nalias clauded='claude --dangerously-skip-permissions'"
    Ok "bash: clauded alias added to ~/.bashrc"
  } else { Ok "bash: clauded alias already present" }

  $binDir = Join-Path $env:USERPROFILE '.local\bin'
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $cmdPath = Join-Path $binDir 'clauded.cmd'
  Set-Content -Path $cmdPath -Value "@echo off`r`nclaude --dangerously-skip-permissions %*" -Encoding ascii
  Ok "wrote $cmdPath"
  if(($env:Path -split ';') -notcontains $binDir){ Warn "$binDir is not on PATH - add it so 'clauded' works from cmd/PowerShell" }
}

# 7) Verify + manual checklist ----------------------------------------------
Step "7/7 Verify"
if(-not $Check){
  try { Ok ("claude " + (claude --version)) } catch {}
  if(Have 'gemini'){ try { Ok ("gemini " + (gemini --version)) } catch {} }
  if(Have 'codex'){ try { Ok ("codex " + (codex --version)) } catch {} }
  Info "Installed plugins:"; claude plugin list
}

Write-Host "`n== Manual steps (guided auth - nothing stored) ==" -ForegroundColor Magenta
@(
  "1. Claude login:      run 'claude' once and sign in (Anthropic).",
  "2. Gemini CLI auth:   run 'gemini' once and sign in (Google). Use --skip-trust in untrusted dirs.",
  "3. Codex CLI auth:    run 'codex login' (OpenAI / ChatGPT).",
  "4. Claude-in-Chrome:  install the 'Claude in Chrome' extension, then let it pair in a Claude session (click Connect); name it (e.g. luka_computer).",
  "5. media-gen logins:  sign in to chatgpt.com and gemini.google.com in that Chrome profile.",
  "6. (optional) Enable claude.ai connectors (Gmail/Calendar/Drive/Stunden) at claude.ai.",
  "7. Restart your shell so 'clauded' resolves, then start Claude with:  clauded"
) | ForEach-Object { Write-Host "  $_" }

Write-Host "`nDone." -ForegroundColor Green
