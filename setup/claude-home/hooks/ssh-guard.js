#!/usr/bin/env node
'use strict';
/*
 * ssh-guard.js — Claude Code "PreToolUse" hook: read-only SSH guardrail.
 *
 * Remote servers (Laravel Forge) are only ever touched through the fixed, read-only
 * artisan commands of secureit-cms-site-manager (ssh:check, site:download-db,
 * site:pull-storage, site:pull-file, site:push-storage). This hook denies every
 * direct SSH-family client call from Bash / PowerShell and every attempt to write
 * such a call into a file, so a session cannot improvise remote commands.
 * It is a guardrail against accidents, not a sandbox.
 *
 * Wired in ~/.claude/settings.json:
 *   "hooks": { "PreToolUse": [ {
 *     "matcher": "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit",
 *     "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/ssh-guard.js" }]
 *   } ] }
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
 * (permissions.deny in settings.json is the fail-closed backstop).
 */

const fs = require('fs');

const CLIENT = /(^|[\s;&|(\\/])(ssh|scp|sftp|plink|pscp|psftp|putty|kitty|winscp(\.com)?|rsync)(\.exe)?(?=\s|$)/i;
const INDIRECT = /forge@|GIT_SSH|core\.sshCommand|Enter-PSSession|New-PSSession/i;
const CONTENT = /plink|pscp|psftp|forge@/i;

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

function normalisePath(p) {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function checkCommand(command) {
  const cmd = String(command || '').replace(/["'`^]/g, '');
  if (CLIENT.test(cmd)) deny('direct SSH-family client calls are blocked (SSH is read-only, via fixed commands only).');
  if (INDIRECT.test(cmd)) deny('indirect SSH routes (forge@, GIT_SSH, core.sshCommand, PSSession) are blocked.');
}

function checkContent(filePath, contents) {
  const p = normalisePath(filePath);
  if (CONTENT_ALLOWED.some(function (re) { return re.test(p); })) return;
  if (contents.some(function (c) { return CONTENT.test(String(c || '')); })) {
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

  if (tool === 'Bash' || tool === 'PowerShell') {
    checkCommand(ti.command);
  } else if (tool === 'Write') {
    checkContent(ti.file_path, [ti.content]);
  } else if (tool === 'Edit') {
    checkContent(ti.file_path, [ti.new_string]);
  } else if (tool === 'MultiEdit') {
    checkContent(ti.file_path, (ti.edits || []).map(function (e) { return e && e.new_string; }));
  } else if (tool === 'NotebookEdit') {
    checkContent(ti.notebook_path, [ti.new_source]);
  }
  process.exit(0);
} catch (_) {
  process.exit(0);
}
