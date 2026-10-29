#!/usr/bin/env node
'use strict';
/*
 * chat-log.js — Claude Code "Stop" hook: log every code-changing turn to a
 * cross-device, AI-searchable chat log.
 *
 * The log is a local git clone at ~/.claude/chat-log (private GitHub repo, cloned by
 * setup.ps1 / setup.sh). No clone (no .git) -> the hook does nothing. Each Stop
 * writes the current turn into
 *   <clone>/<YYYY>/<MM>/<DD>/<project>--<session8>.md     (local date of the prompt)
 * as an upserted block keyed by the prompt record's uuid:
 *   <!-- turn:<uuid> --> ## HH:MM · <title> / Where / Files / Prompt / Result <!-- /turn -->
 * so the Stop after a threebrain continuation (stop_hook_active) REPLACES that turn's
 * block with the fuller result instead of adding a second one. Then it spawns itself
 * detached with --sync (commit + pull --rebase + push) and exits at once.
 * The chat-log skill searches the clone to answer "did I do this before?".
 *
 * Turn window: back to the last non-meta typed user record (Stop-hook feedback and
 * skill bodies are isMeta, task notifications are not prompts). Changed = a mutating
 * tool_use in the window, a codex:codex-rescue Agent, or a linked subagent (Agent
 * tool_result agentId, <task-id> notification, SendMessage) with a mutating tool_use
 * at/after the prompt. Read-only turns write nothing. Helpers: ./lib/transcript.js.
 * Files under Claude's session scratchpad are left out of the Files list.
 *
 * Secrets of common shapes (sk-, ghp_, github_pat_, xox?-, AKIA, PEM private keys)
 * are redacted, and credentials are stripped from remote URLs, before writing.
 *
 * Wired in ~/.claude/settings.json (same Stop group as threebrain-after-task.js):
 *   { "type": "command", "command": "node ~/.claude/hooks/chat-log.js" }
 *
 * Contract (Stop hook):
 *   stdin  = JSON { session_id, transcript_path, cwd, stop_hook_active, ... }
 *   stdout = always empty; never blocks.  exit 0 on every path (fail open).
 *   node chat-log.js --sync  -> sync the clone (lock: <clone>/.git/chat-log-sync.lock,
 *                               a lock younger than 2 min skips); failures keep the
 *                               local commit for the next sync.
 * Env: CHAT_LOG_NO_SYNC=1 (no background sync), CHAT_LOG_DEVICE (default hostname).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

// Fail open: a bug or an odd transcript must never block Claude from stopping.
process.on('uncaughtException', function () { process.exit(0); });

const {
  MUTATING_TOOLS, SAFE_AGENT_ID, textOf, isTypedTurn, collectPaths,
  notifiedAgentIds, scanSubagent
} = require(path.join(__dirname, 'lib', 'transcript.js'));

const CLONE = path.join(os.homedir(), '.claude', 'chat-log');
const DEVICE = String(process.env.CHAT_LOG_DEVICE || os.hostname() || 'device').replace(/\s+/g, ' ').trim();
const MAX_TEXT = 1500;
const MAX_TITLE = 100;
const MAX_FILES = 30;
const LOCK_STALE_MS = 2 * 60 * 1000;
const END = '<!-- /turn -->';
// Claude's per-session scratchpad (<tmp>/claude/<project>/<session uuid>/scratchpad/...) is noise.
const SCRATCHPAD = /\/claude\/[^/]+\/[0-9a-f-]{36}\/scratchpad\//i;
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g
];

function done() { process.exit(0); }

// git output (trimmed), or null on any failure / timeout.
function git(cwd, args, timeout) {
  try {
    return execFileSync('git', args, {
      cwd: cwd, encoding: 'utf8', timeout: timeout || 3000, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (_) { return null; }
}

function hasClone() {
  try { return fs.existsSync(path.join(CLONE, '.git')); } catch (_) { return false; }
}

// --- sync mode: commit + pull --rebase + push the clone ------------------------
function sync() {
  if (!hasClone()) done();
  const lock = path.join(CLONE, '.git', 'chat-log-sync.lock');
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs < LOCK_STALE_MS) done(); // another sync runs
    fs.unlinkSync(lock); // stale lock from a crashed sync: take it over
  } catch (_) { /* no lock */ }
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch (_) { done(); }
  try {
    // A fresh device may have no git identity: fall back to a local one so commits never stall.
    const id = git(CLONE, ['config', 'user.email']) ? [] : ['-c', 'user.name=chat-log', '-c', 'user.email=chat-log@' + DEVICE.replace(/[^A-Za-z0-9.-]/g, '-')];
    git(CLONE, ['add', '-A'], 10000);
    if (git(CLONE, ['diff', '--cached', '--name-only'], 10000)) {
      git(CLONE, id.concat(['commit', '-q', '-m', 'chat-log: ' + DEVICE]), 10000);
    }
    const branch = git(CLONE, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch && branch !== 'HEAD') {
      git(CLONE, id.concat(['pull', '--rebase', '--autostash', '-q', 'origin', branch]), 30000);
      git(CLONE, ['push', '-q', 'origin', 'HEAD:' + branch], 30000);
    }
  } finally {
    try { fs.unlinkSync(lock); } catch (_) { /* already gone */ }
  }
  done();
}

if (process.argv.indexOf('--sync') !== -1) sync();

// --- hook mode ----------------------------------------------------------------
function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function fwd(p) { return String(p).replace(/\\/g, '/'); }

// Same path, or below it (case-insensitive on Windows).
function isInside(p, dir) {
  const norm = function (x) {
    const r = path.resolve(x);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const a = norm(p), b = norm(dir);
  return a === b || a.indexOf(b + path.sep) === 0;
}

function redact(s) {
  return SECRETS.reduce(function (acc, re) { return acc.replace(re, '[REDACTED]'); }, s);
}

// Keep user text from closing or opening a turn marker.
function defang(s) { return s.replace(/<!--/g, '<!- -').replace(/-->/g, '- ->'); }

function clip(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

// Prompt text; a slash-command record renders as "/name args".
function promptText(content) {
  const t = textOf(content);
  const name = /<command-name>([^<]*)<\/command-name>/.exec(t);
  if (!name) return t.trim();
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t);
  return (name[1].trim() + (args && args[1].trim() ? ' ' + args[1].trim() : '')).trim();
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

const raw = readStdin().trim(); // trim() also strips a leading BOM
let input = {};
try { input = JSON.parse(raw || '{}') || {}; } catch (_) { input = {}; }
if (typeof input !== 'object') done();

const tp = input.transcript_path;
if (typeof tp !== 'string' || !tp) done();
if (!hasClone()) done();
const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
if (isInside(cwd, CLONE)) done(); // never log work on the log itself

let lines;
try { lines = fs.readFileSync(tp, 'utf8').split('\n'); } catch (_) { done(); }

// Walk back to the prompt record; everything after it is this turn's window.
let prompt = null;
const windowRecs = [];
for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i] || !lines[i].trim()) continue;
  let rec;
  try { rec = JSON.parse(lines[i]); } catch (_) { continue; }
  if (!rec || typeof rec !== 'object') continue;
  const content = rec.message && rec.message.content;
  if (rec.type === 'user' && !rec.isMeta && isTypedTurn(content)
      && textOf(content).indexOf('<task-notification>') === -1) { prompt = rec; break; }
  windowRecs.push(rec);
}
if (!prompt) done();
windowRecs.reverse();

let changed = false;
let result = '';
const changedPaths = [];
const agentIds = new Set();
for (const rec of windowRecs) {
  const content = rec.message && rec.message.content;
  if (rec.toolUseResult && typeof rec.toolUseResult.agentId === 'string') agentIds.add(rec.toolUseResult.agentId);
  if (rec.type === 'user') {
    const text = textOf(content);
    if (text.indexOf('<task-notification>') !== -1) notifiedAgentIds(tp, text).forEach(function (id) { agentIds.add(id); });
  }
  if (rec.type !== 'assistant' || !Array.isArray(content)) continue;
  for (const part of content) {
    if (!part) continue;
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) result = part.text.trim();
    if (part.type !== 'tool_use') continue;
    if (MUTATING_TOOLS.has(part.name)) {
      changed = true;
      collectPaths(part, changedPaths);
    } else if (part.name === 'Agent' && part.input && part.input.subagent_type === 'codex:codex-rescue') {
      changed = true; // Codex writes via Bash — invisible to tool scanning
    } else if (part.name === 'SendMessage' && part.input && typeof part.input.to === 'string') {
      agentIds.add(part.input.to);
    }
  }
}
const since = Date.parse(prompt.timestamp);
agentIds.forEach(function (id) {
  if (SAFE_AGENT_ID.test(id) && scanSubagent(tp, id, since, changedPaths)) changed = true;
});
if (!changed) done();

// Git context of the working directory (every call optional).
const revParse = (git(cwd, ['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD']) || '').split('\n');
const top = revParse[0] || null;
const project = (path.basename(top || path.resolve(cwd)) || 'unknown').replace(/[^A-Za-z0-9._-]/g, '-');
let where = '`' + fwd(path.resolve(cwd)) + '`';
if (top) {
  const branch = revParse[1];
  const sha = git(cwd, ['rev-parse', '--short', 'HEAD']);
  const dirty = git(cwd, ['status', '--porcelain']);
  const remote = git(cwd, ['config', '--get', 'remote.origin.url']);
  if (branch) where += ' · ' + branch + (sha ? ' @ ' + sha : '') + (dirty ? ' (dirty)' : '');
  if (remote) where += ' · ' + remote.replace(/\/\/[^@\/]+@/, '//'); // drop credentials
}

// Changed paths: de-duplicated, relative to the repo top when under it.
const topFwd = top ? fwd(top).replace(/\/+$/, '') : '';
const files = [];
changedPaths.forEach(function (p) {
  let rel = fwd(p);
  if (SCRATCHPAD.test(rel)) return;
  if (topFwd) {
    const a = process.platform === 'win32' ? rel.toLowerCase() : rel;
    const b = process.platform === 'win32' ? topFwd.toLowerCase() : topFwd;
    if (a.indexOf(b + '/') === 0) rel = rel.slice(topFwd.length + 1);
  }
  if (files.indexOf(rel) === -1) files.push(rel);
});
const fileList = files.slice(0, MAX_FILES).join(', ')
  + (files.length > MAX_FILES ? ', … +' + (files.length - MAX_FILES) + ' more' : '');

const when = isNaN(since) ? new Date() : new Date(since);
const ymd = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate());
const hm = pad(when.getHours()) + ':' + pad(when.getMinutes());
const session8 = (String(input.session_id || path.basename(tp, '.jsonl')).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8)) || 'session';
const key = String(prompt.uuid || prompt.timestamp || 'turn').replace(/[^A-Za-z0-9_.:-]/g, '');

const promptBody = defang(redact(promptText(prompt.message && prompt.message.content)));
const title = clip((promptBody.split('\n').find(function (l) { return l.trim(); }) || '(no prompt text)').trim(), MAX_TITLE);
const start = '<!-- turn:' + key + ' -->';
const block = [
  start,
  '## ' + hm + ' · ' + title,
  '- **Where:** ' + defang(redact(where)),
  '- **Files:** ' + (fileList ? defang(fileList) : '(edits not attributable to paths)'),
  '',
  '**Prompt:** ' + clip(promptBody, MAX_TEXT),
  '',
  '**Result:** ' + (result ? clip(defang(redact(result)), MAX_TEXT) : '(no text reply)'),
  END
].join('\n');

const file = path.join(CLONE, String(when.getFullYear()), pad(when.getMonth() + 1), pad(when.getDate()),
  project + '--' + session8 + '.md');
try {
  let doc = '';
  try { doc = fs.readFileSync(file, 'utf8'); } catch (_) { /* new file */ }
  if (!doc.trim()) doc = '# ' + project + ' · ' + ymd + ' · ' + DEVICE + '\nsession ' + session8 + ' · `' + fwd(path.resolve(cwd)) + '`\n';
  const i = doc.indexOf(start);
  const j = i === -1 ? -1 : doc.indexOf(END, i);
  if (i !== -1 && j !== -1) doc = doc.slice(0, i) + block + doc.slice(j + END.length);
  else doc = doc.replace(/\s*$/, '\n\n') + block + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(CLONE, '.git', 'chat-log-' + process.pid + '.tmp'); // outside the work tree
  fs.writeFileSync(tmp, doc);
  fs.renameSync(tmp, file);
} catch (_) { done(); }

if (process.env.CHAT_LOG_NO_SYNC !== '1') {
  try {
    spawn(process.execPath, [__filename, '--sync'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (_) { /* next Stop retries */ }
}
done();
