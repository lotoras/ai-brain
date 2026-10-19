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
Step "2/7 Global CLIs (codex)"
foreach($t in @(@{cmd='codex';pkg='@openai/codex@latest';upgrade=$true})){
  if((Have $t.cmd) -and -not $t.upgrade){ Ok "$($t.cmd) already installed" }
  elseif($Check){ Would "npm i -g $($t.pkg)" }
  else{ Info "npm i -g $($t.pkg)"; npm i -g $t.pkg; if($LASTEXITCODE -eq 0){ Ok "installed $($t.pkg)" } else { Warn "npm install $($t.pkg) returned $LASTEXITCODE" } }
}

# Codex model pin: merge setup/codex-home/config.toml -> ~/.codex/config.toml (never overrides an existing model)
$cfgSrc = Join-Path $root 'codex-home/config.toml'
$cfgDst = Join-Path $env:USERPROFILE '.codex/config.toml'
# and, on Windows, codex-home/config.windows.toml (without [windows] sandbox, Codex silently runs --write read-only).
# Read once, merge in memory, then one backup + one UTF-8 (no BOM) write — and only if something changed.
$winSrc = Join-Path $root 'codex-home/config.windows.toml'
# matches [windows], [ windows ], ["windows"], ['windows'] and any [windows.<sub>] table
$winHdr = '(?m)^\s*\[\s*(?:windows|"windows"|''windows'')\s*(?:\.[^\]]*)?\]'
# top-level keys also provisioned from the template (added when missing, never overridden)
$extraKeys = 'forced_login_method','project_doc_fallback_filenames','sandbox_workspace_write.network_access','sandbox_workspace_write.writable_roots'   # writable_roots is rendered per machine, not in the template
$sbHdr = '(?m)^\s*\[\s*(?:sandbox_workspace_write|"sandbox_workspace_write"|''sandbox_workspace_write'')\s*(?:\.[^\]]*)?\]'   # a [sandbox_workspace_write] table conflicts with the dotted key
function HasTopKey($t,$k){
  $top = ($t -split '(?m)^\s*\[', 2)[0]
  if($k -like 'sandbox_workspace_write.*' -and $top -match '(?m)^\s*sandbox_workspace_write\s*='){ return $true }
  $top -match ('(?m)^\s*' + [regex]::Escape($k) + '\s*=')
}
if(Test-Path $cfgSrc){
  if($Check){ Would "merge codex-home/config.toml -> ~/.codex/config.toml (copy if missing; prepend if no top-level model; add missing forced_login_method / project_doc_fallback_filenames / sandbox_workspace_write.network_access keys, never overriding; append config.windows.toml unless a [windows] table exists)" }
  else {
    $orig = if(Test-Path $cfgDst){ [System.IO.File]::ReadAllText($cfgDst) } else { $null }
    $text = $orig
    if($null -eq $text){ $text = [System.IO.File]::ReadAllText($cfgSrc); Ok "wrote ~/.codex/config.toml (model pin)" }
    elseif(($text -split '(?m)^\s*\[', 2)[0] -match '(?m)^\s*model\s*='){ Warn "~/.codex/config.toml already sets a model - left as-is (template pin: $cfgSrc)" }
    else {
      # drop template keys the existing file already sets (a duplicate top-level key is invalid TOML)
      $tpl = [System.IO.File]::ReadAllText($cfgSrc)
      foreach($k in $extraKeys){ if((HasTopKey $text $k) -or ($k -like 'sandbox_workspace_write.*' -and $text -match $sbHdr)){ $tpl = $tpl -replace ('(?m)^[ \t]*' + [regex]::Escape($k) + '[ \t]*=.*(\r?\n|$)'), '' } }
      $text = $tpl.TrimEnd() + "`n`n" + $text; Ok "prepended model pin to ~/.codex/config.toml"
    }

    # Add any missing top-level template key at the end of the top-level region (before the first table); never overrides.
    $tplText = [System.IO.File]::ReadAllText($cfgSrc)
    foreach($k in $extraKeys){
      if(HasTopKey $text $k){ continue }
      if($k -like 'sandbox_workspace_write.*' -and $text -match $sbHdr){ Warn "~/.codex/config.toml has a [sandbox_workspace_write] table - add $k there yourself"; continue }
      $line = if($k -like '*.writable_roots'){ if($env:LOCALAPPDATA){ "$k = ['$env:LOCALAPPDATA\npm-cache', '$env:LOCALAPPDATA\Composer']" } } # npm/composer caches, so installs work in the sandbox
               else { [regex]::Match($tplText, '(?m)^[ \t]*' + [regex]::Escape($k) + '[ \t]*=.*$').Value.TrimEnd() }
      if(-not $line){ continue }
      $nl = if($text -match "`r`n"){ "`r`n" } else { "`n" }
      $m = [regex]::Match($text, '(?m)^\s*\[')
      $head = if($m.Success){ $text.Substring(0, $m.Index) } else { $text }
      $tail = if($m.Success){ $text.Substring($m.Index) } else { '' }
      if($head -and -not $head.EndsWith("`n")){ $head += $nl }
      $text = $head + $line + $nl + $tail
      Ok "added $k to ~/.codex/config.toml"
    }

    if(Test-Path $winSrc){
      if($text -match $winHdr){ Ok "~/.codex/config.toml already has a [windows] table" }
      else { $text = $text.TrimEnd() + "`n`n" + [System.IO.File]::ReadAllText($winSrc); Ok "appended [windows] sandbox = unelevated to ~/.codex/config.toml (enables Codex --write)" }
    }

    if($text -cne $orig){
      if($null -eq $orig){ New-Item -ItemType Directory -Force -Path (Split-Path $cfgDst) | Out-Null }
      else { Copy-Item $cfgDst "$cfgDst.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')" -Force; Info "backup kept alongside ~/.codex/config.toml" }
      [System.IO.File]::WriteAllText($cfgDst, $text, (New-Object System.Text.UTF8Encoding($false)))
    }
  }
}

# 3) Marketplaces ------------------------------------------------------------
Step "3/7 Plugin marketplaces"
foreach($m in 'anthropics/claude-plugins-official','openai/codex-plugin-cc','lotoras/ai-brain'){
  if($Check){ Would "claude plugin marketplace add $m"; continue }
  claude plugin marketplace add $m
  if($LASTEXITCODE -eq 0){ Ok "marketplace $m" } else { Warn "marketplace $m (already added?)" }
}

# 4) Plugins -----------------------------------------------------------------
Step "4/7 Plugins (user scope)"
$plugins = 'superpowers@ai-brain','frontend-design@claude-plugins-official','codex@openai-codex','ai-brain@ai-brain'
foreach($p in $plugins){
  if($Check){ Would "claude plugin install $p --scope user (+ enable)"; continue }
  claude plugin install $p --scope user
  claude plugin enable ($p.Split('@')[0]) 2>$null
  if($LASTEXITCODE -eq 0){ Ok "plugin $p" } else { Warn "plugin $p (already installed?)" }
}
# Keep every marketplace and plugin current (non-fatal; installs otherwise stay on an old cached version)
if($Check){ Would "claude plugin marketplace update; claude plugin update <each plugin>" }
else {
  claude plugin marketplace update
  if($LASTEXITCODE -ne 0){ Warn "marketplace update failed ($LASTEXITCODE) - continuing" }
  foreach($p in $plugins){
    claude plugin update $p
    if($LASTEXITCODE -eq 0){ Ok "$p up to date" } else { Warn "$p update returned $LASTEXITCODE - continuing" }
  }
}
# Free design MCP servers, user scope (idempotent: skipped when already registered)
$mcps = @(
  @{ name='shadcn';      args=@('--','cmd','/c','npx','-y','shadcn@latest','mcp') },
  @{ name='magicui';     args=@('--','cmd','/c','npx','-y','@magicuidesign/mcp@latest') },
  @{ name='lottiefiles'; args=@('--transport','http','https://mcp.lottiefiles.com/mcp'); hint='run /mcp in Claude Code and sign in to lottiefiles once' }
)
if($Check){ $mcps | ForEach-Object { Would "claude mcp add --scope user $($_.name) (skipped if already registered)" } }
else {
  $registered = (claude mcp list 2>$null) -join "`n"
  foreach($m in $mcps){
    if($registered -match "(?m)^$($m.name):"){ Ok "mcp $($m.name) already registered"; continue }
    claude mcp add --scope user $m.name @($m.args)
    if($LASTEXITCODE -eq 0){ Ok "mcp $($m.name)"; if($m.hint){ Info $m.hint } } else { Warn "mcp $($m.name) add returned $LASTEXITCODE - continuing" }
  }
}

# 5) Config copy with backup -------------------------------------------------
Step "5/7 Config -> ~/.claude (with backup)"
$files = @('settings.json','statusline-command.js','keybindings.json','CLAUDE.md','commands/dream.md','hooks/threebrain-after-task.js','hooks/session-model-guard.js','hooks/fable-edit-guard.js','hooks/ssh-guard.js')
$mergeJs = Join-Path $root 'merge-settings.js'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $claudeDir "backup/$stamp"
foreach($rel in $files){
  $srcF = Join-Path $homeSnap $rel
  $dstF = Join-Path $claudeDir $rel
  if(-not (Test-Path $srcF)){ Warn "snapshot missing $rel (skip)"; continue }
  if($Check){
    if($rel -eq 'settings.json'){ Would "merge settings.json -> ~/.claude/settings.json (backup first; preserves local keys like permissions.allow)" }
    else { Would "copy $rel -> ~/.claude/$rel (backup existing first)" }
    continue
  }
  if(Test-Path $dstF){
    $b = Join-Path $backup $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $b) | Out-Null
    Copy-Item $dstF $b -Force
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $dstF) | Out-Null
  if($rel -eq 'settings.json'){
    node $mergeJs $srcF $dstF
    if($LASTEXITCODE -eq 0){ Ok "merged ~/.claude/settings.json (local keys preserved)" }
    else { Warn "settings.json merge failed ($LASTEXITCODE) - writing snapshot as-is"; Copy-Item $srcF $dstF -Force }
  } else {
    Copy-Item $srcF $dstF -Force
    Ok "wrote ~/.claude/$rel"
  }
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
  if(Have 'codex'){ try { Ok ("codex " + (codex --version)) } catch {} }
  Info "Installed plugins:"; claude plugin list
}

Write-Host "`n== Manual steps (guided auth - nothing stored) ==" -ForegroundColor Magenta
@(
  "1. Claude login:      run 'claude' once and sign in (Anthropic).",
  "2. Codex CLI auth:    run 'codex login' (OpenAI / ChatGPT).",
  "3. Claude-in-Chrome:  install the 'Claude in Chrome' extension, then let it pair in a Claude session (click Connect); name it (e.g. luka_computer).",
  "4. media-gen logins:  sign in to chatgpt.com in that Chrome profile (and gemini.google.com if you want Veo video).",
  "5. (optional) Enable claude.ai connectors (Gmail/Calendar/Drive/Stunden) at claude.ai.",
  "6. Restart your shell so 'clauded' resolves, then start Claude with:  clauded"
) | ForEach-Object { Write-Host "  $_" }

Write-Host "`nDone." -ForegroundColor Green
