#!/usr/bin/env node
'use strict';
/*
 * ssh-guard.js — Claude Code "PreToolUse" hook: read-only SSH guardrail for the SecureIT CMS.
 *
 * Remote servers (Laravel Forge) are only ever touched through the fixed, read-only
 * artisan commands of secureit-cms-site-manager (ssh:check, site:download-db,
 * site:pull-storage, site:pull-file, site:push-storage). Inside the CMS folders this hook
 * denies every direct SSH-family client call from Bash / PowerShell and every attempt to
 * write such a call into a file, so a session cannot improvise remote commands.
 * Outside them SSH is allowed (see the ai-brain ssh-pageant skill).
 * It is a guardrail against accidents, not a sandbox.
 *
 * Wired in ~/.claude/settings.json:
 *   "hooks": { "PreToolUse": [ {
 *     "matcher": "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit",
 *     "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/ssh-guard.js" }]
 *   } ] }
 *
 * Scope — the rules only apply when one of these holds:
 *   - the session cwd is under a CMS_ROOTS folder, or inside a git repo whose remote
 *     matches CMS_REMOTE (any other clone of cms / secureit-cms-site-manager / cms-mcp);
 *   - Bash|PowerShell: the command names a CMS_ROOTS path (cd C:/laragon/www/cms-local && ...);
 *   - Write|Edit|MultiEdit|NotebookEdit: the target file is under a CMS_ROOTS folder.
 *
 * Rules (case-insensitive; quotes, backticks and carets stripped first):
 *   a) Bash|PowerShell — a direct client invocation (also by full path):
 *        ssh scp sftp plink pscp psftp putty kitty winscp(.com) rsync [.exe]
 *      `ssh:check`, `--via=ssh`, `ssh-keygen` do not match (no whitespace after the name).
 *   b) Bash|PowerShell — indirect routes: forge@, GIT_SSH, core.sshCommand,
 *      Enter-PSSession, New-PSSession.
 *   c) Write|Edit|MultiEdit|NotebookEdit — content mentioning plink|pscp|psftp|forge@,
 *      except the files that legitimately hold the transport (see CONTENT_ALLOWED).
 *
 * Contract: stdout = JSON { hookSpecificOutput: { permissionDecision: "deny", ... } }
 * on a match; otherwise no output. Always exit 0; unparseable input fails open
 * (permissions.deny in the CMS projects' .claude/settings.local.json is the fail-closed backstop).
 */

const fs = require('fs');
const path = require('path');

const CLIENT = /(^|[\s;&|(\\/])(ssh|scp|sftp|plink|pscp|psftp|putty|kitty|winscp(\.com)?|rsync)(\.exe)?(?=\s|$)/i;
const INDIRECT = /forge@|GIT_SSH|core\.sshCommand|Enter-PSSession|New-PSSession/i;
const CONTENT = /plink|pscp|psftp|forge@/i;

// CMS folders (normalised) and the remotes of their repos — the guard's scope.
const CMS_ROOTS = [
  'c:/laragon/www/cms-local',
  'c:/laragon/www/secureit-cms-site-manager',
  'c:/laragon/www/cms-mcp',
];
const CMS_REMOTE = /secureit-swiss\/(cms|secureit-cms-site-manager|cms-mcp)(\.git)?\s*$/im;

// Files allowed to contain transport code / rules (matched on a normalised, forward-slash path).
const CONTENT_ALLOWED = [
  /\/app\/services\/readonlysshservice\.php$/,
  /\/app\/services\/siteprovisionservice\.php$/,
  /\/config\/ssh\.php$/,
  /\/tests\//,
  /\.md$/,
  /\/hooks\/ssh-guard(\.test)?\.js$/,
  /\/\.claude\/settings(\.local)?\.json$/,
  /\/setup\/claude-home\/settings\.json$/,
];

const COMMANDS =
  'Use the read-only site-manager commands instead (run in C:/laragon/www/secureit-cms-site-manager): ' +
  'ssh:check <site>, site:download-db <site>, site:pull-storage <site>, site:pull-file <site> <path>, ' +
  'site:push-storage <site> — see the /sitemanager skill. ' +
  'If the match is only text (a commit message, an echo), put the text in a file (git commit -F) or reword it.';

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'ssh-guard: ' + reason + ' ' + COMMANDS,
    },
  }));
  process.exit(0);
}

// Forward slashes, lower case, Git Bash drive prefix (/c/...) -> c:/...
function normalisePath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase().replace(/^\/([a-z])(?=\/|$)/, '$1:');
}

function underCmsRoot(p) {
  const n = normalisePath(p).replace(/\/+$/, '');
  return CMS_ROOTS.some(function (r) { return n === r || n.indexOf(r + '/') === 0; });
}

function mentionsCmsRoot(cmd) {
  const n = String(cmd || '').replace(/\\/g, '/').toLowerCase().replace(/(^|[\s=;&|(])\/([a-z])\//g, '$1$2:/');
  return CMS_ROOTS.some(function (r) { return n.indexOf(r) !== -1; });
}

// Nearest enclosing git repo (worktree .git files followed) has a CMS remote.
function gitRemoteIsCms(dir) {
  try {
    let d = path.resolve(process.platform === 'win32' ? String(dir).replace(/^\/([a-z])(?=\/|$)/i, '$1:') : String(dir));
    for (;;) {
      const dotGit = path.join(d, '.git');
      if (fs.existsSync(dotGit)) {
        let gitDir = dotGit;
        if (fs.statSync(dotGit).isFile()) {
          const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
          if (!m) return false;
          gitDir = path.resolve(d, m[1].trim());
          const common = path.join(gitDir, 'commondir');
          if (fs.existsSync(common)) gitDir = path.resolve(gitDir, fs.readFileSync(common, 'utf8').trim());
        }
        return CMS_REMOTE.test(fs.readFileSync(path.join(gitDir, 'config'), 'utf8'));
      }
      const up = path.dirname(d);
      if (up === d) return false;
      d = up;
    }
  } catch (_) {
    return false;
  }
}

function cwdInScope(cwd) {
  return underCmsRoot(cwd) || gitRemoteIsCms(cwd);
}

function checkCommand(command, cwd) {
  const cmd = String(command || '').replace(/["'`^]/g, '');
  let reason = null;
  if (CLIENT.test(cmd)) reason = 'direct SSH-family client calls are blocked (SSH is read-only, via fixed commands only).';
  else if (INDIRECT.test(cmd)) reason = 'indirect SSH routes (forge@, GIT_SSH, core.sshCommand, PSSession) are blocked.';
  if (reason && (mentionsCmsRoot(cmd) || cwdInScope(cwd))) deny(reason);
}

function checkContent(filePath, contents, cwd) {
  const p = normalisePath(filePath);
  if (CONTENT_ALLOWED.some(function (re) { return re.test(p); })) return;
  if (!contents.some(function (c) { return CONTENT.test(String(c || '')); })) return;
  if (underCmsRoot(filePath) || cwdInScope(cwd)) {
    deny('writing SSH client calls (plink/pscp/psftp/forge@) into ' + (filePath || 'a file') +
      ' is blocked; transport code belongs in app/Services/ReadOnlySshService.php.');
  }
}

try {
  const raw = readStdin().replace(/^\uFEFF/, '').trim();
  let input;
  try { input = JSON.parse(raw || '{}'); } catch (_) { process.exit(0); }

  const tool = input && input.tool_name;
  const ti = (input && input.tool_input) || {};
  const cwd = (input && input.cwd) || process.cwd();

  if (tool === 'Bash' || tool === 'PowerShell') {
    checkCommand(ti.command, cwd);
  } else if (tool === 'Write') {
    checkContent(ti.file_path, [ti.content], cwd);
  } else if (tool === 'Edit') {
    checkContent(ti.file_path, [ti.new_string], cwd);
  } else if (tool === 'MultiEdit') {
    checkContent(ti.file_path, (ti.edits || []).map(function (e) { return e && e.new_string; }), cwd);
  } else if (tool === 'NotebookEdit') {
    checkContent(ti.notebook_path, [ti.new_source], cwd);
  }
  process.exit(0);
} catch (_) {
  process.exit(0);
}
