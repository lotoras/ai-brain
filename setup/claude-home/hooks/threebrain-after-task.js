#!/usr/bin/env node
'use strict';
/*
 * threebrain-after-task.js — Claude Code "Stop" hook.
 *
 * Fires ONLY when this task is confirmed to have changed code — i.e. an
 * Edit/Write/MultiEdit/NotebookEdit tool_use is found since the last typed user
 * turn — to ask whether to run a threebrain pass over the changes
 * (Simplify / Review / Review + Simplify / No) before it finishes. In every other
 * case it stays silent: read-only / Q&A tasks AND any case where history can't be
 * inspected (no/unreadable transcript). Strict allow-list — when in doubt, silent.
 *
 * Order: "Review + Simplify" runs the Review first, fixes the accepted findings in the
 * main loop, and runs Simplify LAST (so the final code is the simplified one).
 *
 * Sensitive paths: the file_path / notebook_path of every mutating tool_use is
 * collected. If any matches src/auth/, /migrations/ or /billing/ (also at the path
 * start; `\` normalised to `/`), the Review option becomes the adversarial review.
 *
 * Delegated edits: subagent turns are NOT in the main transcript. They live in
 *   <dir of transcript_path>/<transcript basename without .jsonl>/subagents/agent-<agentId>.jsonl
 * so edits made by a subagent are invisible to a main-transcript scan. Within the
 * lookback window (back to the last typed user turn) we therefore collect agentIds
 * from (1) `toolUseResult.agentId` on the user record carrying an Agent tool_result,
 * (2) `<task-id>` in `<task-notification>` records (async agents finishing later —
 * such a record is NOT a typed-turn boundary, so the walk continues past it), and
 * (3) assistant `SendMessage` tool_use (`input.to`, resuming an earlier agent). Each
 * agent's subagent JSONL is then read (silently skipped if missing) and its mutating
 * tool_use counted — and their paths collected — only from records whose `timestamp`
 * is >= the boundary typed turn's timestamp (all records if there is no boundary
 * timestamp), so an agent resumed this turn doesn't drag in its older edits.
 * Separately, an assistant `Agent` tool_use with subagent_type "codex:codex-rescue"
 * counts as changed code: Codex writes through Bash, which tool scanning can't see.
 *
 * Pending background agents: while any subagent is still running the hook stays silent,
 * so it doesn't ask between pipeline phases. "Running" comes from the subagent meta files, not
 * from the transcript: <session>/subagents/agent-<id>.meta.json has no `finished` key while the
 * agent runs, gets `"finished": true` on completion, and loses it again when the agent is resumed
 * via SendMessage (Bash background tasks have no meta file). That state is window-independent and
 * resume-aware; an agent whose transcript hasn't been written for 30 min is treated as dead.
 * While agents are pending (even with nothing changed yet) the hook records the window in
 * <session>/threebrain-deferred.json ({ changed, sensitive, agents: { id: earliest boundary } }),
 * so edits survive typed user turns in between — no cross-turn transcript walking. Once nothing
 * is pending the next Stop replays it (scanning each recorded agent from its recorded boundary),
 * asks if code changed, and deletes the file; the hook's own reason (guard 2) also deletes it.
 *
 * Review invocation: /codex:review and /codex:adversarial-review are user-only slash
 * commands (disable-model-invocation), so the reason names the command a Haiku relay can
 * actually run: `node "<plugin>/scripts/codex-companion.mjs" review --scope working-tree`.
 *
 * Wired in ~/.claude/settings.json:
 *   "hooks": { "Stop": [ { "hooks": [
 *     { "type": "command", "command": "node ~/.claude/hooks/threebrain-after-task.js" }
 *   ] } ] }
 * The transcript helpers (subagent paths/scans, typed-turn test) live in
 * ~/.claude/hooks/lib/transcript.js, shared with chat-log.js; a missing lib fails open.
 *
 * Contract (Stop hook):
 *   stdin  = JSON { stop_hook_active, transcript_path, ... }
 *   stdout = JSON { "decision": "block", "reason": "<instruction>" }  -> Claude continues
 *   exit 0 with no stdout                                            -> Claude stops normally
 *   any unexpected exception                                         -> exit 0 silently (fail open)
 *
 * Anti-loop: two independent guards (stop_hook_active, and the hook's own prior
 * `reason` signature in the transcript). Either one alone terminates.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Fail open: a bug or an odd transcript must never block Claude from stopping.
process.on('uncaughtException', function () { process.exit(0); });

// Shared transcript helpers (required after the handler, so a missing lib fails open).
const {
  MUTATING_TOOLS, SAFE_AGENT_ID, textOf, isTypedTurn, collectPaths,
  subagentPath, notifiedAgentIds, scanSubagent
} = require(path.join(__dirname, 'lib', 'transcript.js'));

const MARKER = 'THREEBRAIN_AFTER_TASK';
// The distinctive opening of the reason ask() plants. We match this signature
// (not the bare MARKER) so prose or code that merely mentions the marker — e.g.
// a tool_result echoing this file, or a message discussing the hook — can't be
// mistaken for the hook's own prior prompt and wrongly suppress a fresh one.
const REASON_SIGNATURE = MARKER + ': This task changed code';
// Paths whose changes force the adversarial Codex review (matched on `/`-normalised paths).
const SENSITIVE_PATH = /(^|\/)(src\/auth|migrations|billing)\//i;
// An unfinished agent whose transcript is older than this is presumed crashed/killed.
const STALE_MS = 30 * 60 * 1000;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

// True only for the hook's own injected reason: its signature appears in a real
// text block (or string content), never in tool_use inputs or tool_result blocks.
function isHookReason(content) {
  if (typeof content === 'string') return content.indexOf(REASON_SIGNATURE) !== -1;
  if (Array.isArray(content)) {
    return content.some(function (p) {
      return p && p.type === 'text' && typeof p.text === 'string'
        && p.text.indexOf(REASON_SIGNATURE) !== -1;
    });
  }
  return false;
}

// Ids of this session's subagents still running: meta has no `finished: true` and the transcript
// was written within STALE_MS. Any error -> not pending (fail-silent).
function pendingAgents(tpath) {
  try {
    const dir = subagentPath(tpath, '');
    const ids = [];
    fs.readdirSync(dir).forEach(function (f) {
      const m = /^agent-(.+)\.meta\.json$/.exec(f);
      if (!m) return;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (meta && meta.finished === true) return;
        if (Date.now() - fs.statSync(path.join(dir, 'agent-' + m[1] + '.jsonl')).mtimeMs < STALE_MS) ids.push(m[1]);
      } catch (_) { /* unreadable / no transcript: not pending */ }
    });
    return ids;
  } catch (_) { return []; }
}

// Session-scoped deferral file (see header). All three helpers are fail-silent.
function deferredPath(tpath) {
  return path.join(path.dirname(tpath), path.basename(tpath, '.jsonl'), 'threebrain-deferred.json');
}
function readDeferred(tpath) {   // null = no file; {} = file with unreadable content
  let txt;
  try { txt = fs.readFileSync(deferredPath(tpath), 'utf8'); } catch (_) { return null; }
  try { return JSON.parse(txt) || {}; } catch (_) { return {}; }
}
// Merge into the file: { changed, sensitive, agents: { <pendingId>: <since ms epoch | null> } }.
// `since` is the EARLIEST window boundary seen while the agent was pending (existing entries win;
// null = no boundary, scan all), so the completion Stop can still find the agent's earlier edits
// even though its own window starts at a newer typed turn.
function writeDeferred(tpath, changed, sensitive, ids, since) {
  try {
    const prev = readDeferred(tpath) || {};
    const agents = prev.agents && typeof prev.agents === 'object' ? prev.agents : {};
    ids.forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(agents, id)) agents[id] = isNaN(since) ? null : since;
    });
    fs.mkdirSync(path.dirname(deferredPath(tpath)), { recursive: true });
    fs.writeFileSync(deferredPath(tpath), JSON.stringify({
      changed: !!prev.changed || changed, sensitive: !!prev.sensitive || sensitive, agents: agents
    }));
  } catch (_) { /* best effort */ }
}
function clearDeferred(tpath) {
  try { fs.unlinkSync(deferredPath(tpath)); } catch (_) { /* none to delete */ }
}

// Numeric dotted compare of two version-ish names (1.0.10 > 1.0.6). A non-numeric
// segment counts as -1, so a name like "latest" or "tmp" sorts below any real version.
function cmpVersion(a, b) {
  const pa = a.split('.'), pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = /^\d+$/.test(pa[i] || '') ? parseInt(pa[i], 10) : -1;
    const y = /^\d+$/.test(pb[i] || '') ? parseInt(pb[i], 10) : -1;
    if (x !== y) return x - y;
  }
  return 0;
}

// Absolute path (forward slashes) of the newest installed codex plugin's companion
// script, or null if it can't be found. The plugin cache holds one dir per version.
function resolveCompanion() {
  try {
    const base = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'openai-codex', 'codex');
    const versions = fs.readdirSync(base).filter(function (v) {
      return fs.existsSync(path.join(base, v, 'scripts', 'codex-companion.mjs'));
    }).sort(cmpVersion);
    if (!versions.length) return null;
    return path.join(base, versions[versions.length - 1], 'scripts', 'codex-companion.mjs')
      .replace(/\\/g, '/');
  } catch (_) { return null; }
}

function ask(sensitive) {
  const sub = sensitive ? 'adversarial-review' : 'review';
  const companion = resolveCompanion();
  const reviewCmd = companion
    ? 'node "' + companion + '" ' + sub + ' --scope working-tree'
    : "the installed codex@openai-codex plugin's scripts/codex-companion.mjs with \"" + sub + " --scope working-tree\"";
  const reviewHandoff = 'by delegating to a subagent with model "haiku" that runs exactly that one Bash command and relays its stdout word-for-word, never summarising or reviewing the code itself (/codex:' + sub + ' is a user-only slash command, so the relay must run the command, not the slash command)';
  const simplifyPass = 'run /simplify on the code you just changed as an Opus pass (if the session model is not Opus, dispatch the pass to a subagent with model "opus")';
  const reason = [
    MARKER + ': This task changed code. Before you finish, do NOT stop yet —',
    'ask the user with the AskUserQuestion tool (header "threebrain",',
    'question "Run a threebrain pass over what just changed?") offering exactly these options:',
    '"Simplify" — ' + simplifyPass + ';',
    '"Review" — trigger the Codex review (' + reviewCmd + ') ' + reviewHandoff + ';',
    '"Review + Simplify" — run the Review first (' + reviewCmd + ', same handoff), then fix the accepted findings yourself in the main loop, then run Simplify LAST: ' + simplifyPass + ';',
    '"No" — skip and stop.',
    sensitive
      ? 'A sensitive path (src/auth/, migrations/, billing/) was changed, so the sensitive-path rule forces adversarial review — recommend "Review" or "Review + Simplify".'
      : '',
    'Then act on the choice, routing silently per the threebrain skill. If the user picks "No", just stop.'
  ].filter(Boolean).join(' ');
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function stop() { process.exit(0); }

// trim() also strips a leading BOM, so JSON.parse won't choke on it.
const raw = readStdin().trim();
let input = {};
try { input = JSON.parse(raw || '{}'); } catch (_) { input = {}; }

// Guard 1: never re-fire while already continuing from a Stop hook.
if (input && input.stop_hook_active) stop();

// Allow-list: only fire on a confirmed edit-tool change. If we can't read the
// transcript (no path, or missing/unreadable file), we can't confirm one -> silent.
const tp = input && input.transcript_path;
if (!tp) stop();

let lines;
try {
  lines = fs.readFileSync(tp, 'utf8').split('\n');
} catch (_) {
  stop();
}

let changedCode = false;
const changedPaths = [];       // file_path / notebook_path of every mutating tool_use seen
const agentIds = new Set();    // subagents whose own transcripts must be scanned
let boundaryTs = NaN;          // ms epoch of the typed user turn that ends the window
let blindSpot = false;         // lookback was cut short by an unparseable line

for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i];
  if (!line || !line.trim()) continue;

  let msg;
  // An unparseable line is a blind spot: we can't tell a turn boundary from an
  // edit past it, so stop the lookback and decide on what we've confirmed so far
  // (strict allow-list — never cross a blind spot to grab a stale edit).
  try { msg = JSON.parse(line); } catch (_) { blindSpot = true; break; }
  if (!msg || typeof msg !== 'object') continue; // a literal null / scalar line carries no record

  const content = msg && msg.message && msg.message.content;

  // Guard 2 (anti-loop): the hook's own prior reason is present since the last
  // user turn -> we already asked, don't ask again.
  if (isHookReason(content)) { clearDeferred(tp); stop(); }

  // Agent tool_result: the user record carries the spawned agent's id.
  const tur = msg && msg.toolUseResult;
  if (tur && typeof tur.agentId === 'string') agentIds.add(tur.agentId);

  // Confirm a file-mutating tool call in an assistant turn; note delegations.
  if (msg.type === 'assistant' && Array.isArray(content)) {
    for (const part of content) {
      if (!part || part.type !== 'tool_use') continue;
      if (MUTATING_TOOLS.has(part.name)) {
        changedCode = true;
        collectPaths(part, changedPaths);
      } else if (part.name === 'Agent' && part.input
          && part.input.subagent_type === 'codex:codex-rescue') {
        changedCode = true; // Codex writes via Bash — invisible to tool scanning
      } else if (part.name === 'SendMessage' && part.input
          && typeof part.input.to === 'string') {
        agentIds.add(part.input.to);
      }
    }
  }

  if (msg.type === 'user') {
    // An async agent finishing: not a typed turn, so keep walking past it.
    const text = textOf(content);
    if (text.indexOf('<task-notification>') !== -1) {
      notifiedAgentIds(tp, text).forEach(function (id) { agentIds.add(id); }); // not Bash tasks
      continue;
    }
    // A genuine typed user turn ends the lookback at the current turn boundary.
    if (isTypedTurn(content)) { boundaryTs = Date.parse(msg.timestamp); break; }
  }
}

// Subagent edits live in their own files. Skip when the window is unreliable
// (blind spot) — without a boundary we'd count stale edits from earlier turns.
// Always scanned (even if already confirmed) so the sensitive-path rule sees their paths.
if (!blindSpot) {
  agentIds.forEach(function (id) {
    if (SAFE_AGENT_ID.test(id) && scanSubagent(tp, id, boundaryTs, changedPaths)) changedCode = true;
  });
}

// Pending subagents (from the meta files, not the transcript) -> defer: ALWAYS record the window
// (changed code?, sensitive?) and each pending agent with its earliest boundary in the session's
// deferral file, then stay silent. A later Stop with nothing pending replays it — even if its own
// window is read-only or starts at a newer typed turn (so scanSubagent's `since` would hide the
// agent's earlier edits) — so edits survive user turns without any cross-turn walking.
const sensitive = changedPaths.some(function (p) { return SENSITIVE_PATH.test(p); });
const pending = pendingAgents(tp);
if (pending.length) {
  // Blind spot -> no reliable boundary: don't record the agents (a null `since` would replay
  // their whole history, including edits from earlier turns). Still defer.
  writeDeferred(tp, changedCode, sensitive, blindSpot ? [] : pending, boundaryTs);
  stop();
}
const deferred = readDeferred(tp);
let deferredChanged = false, deferredSensitive = false;
if (deferred) {
  const filePaths = [];
  const agents = deferred.agents && typeof deferred.agents === 'object' ? deferred.agents : {};
  // A file without an explicit `changed: false` (older format) means code did change.
  deferredChanged = deferred.changed !== false;
  Object.keys(agents).forEach(function (id) {
    const since = typeof agents[id] === 'number' ? agents[id] : NaN;
    if (SAFE_AGENT_ID.test(id) && scanSubagent(tp, id, since, filePaths)) deferredChanged = true;
  });
  deferredSensitive = !!deferred.sensitive || filePaths.some(function (p) { return SENSITIVE_PATH.test(p); });
  clearDeferred(tp); // always consumed once nothing is pending (ask or not)
}
if (changedCode || deferredChanged) ask(sensitive || deferredSensitive);
stop();
