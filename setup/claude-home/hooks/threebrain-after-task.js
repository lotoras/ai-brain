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
 * Order: "Review + Simplify" runs the Review first, has a Sonnet coder fix the
 * accepted findings, and runs Simplify LAST (so the final code is the simplified one).
 *
 * Sensitive paths: the file_path / notebook_path of every mutating tool_use is
 * collected. If any matches src/auth/, /migrations/ or /billing/ (also at the path
 * start; `\` normalised to `/`), the Review option becomes /codex:adversarial-review.
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
 * Wired in ~/.claude/settings.json:
 *   "hooks": { "Stop": [ { "hooks": [
 *     { "type": "command", "command": "node ~/.claude/hooks/threebrain-after-task.js" }
 *   ] } ] }
 *
 * Contract (Stop hook):
 *   stdin  = JSON { stop_hook_active, transcript_path, ... }
 *   stdout = JSON { "decision": "block", "reason": "<instruction>" }  -> Claude continues
 *   exit 0 with no stdout                                            -> Claude stops normally
 *
 * Anti-loop: two independent guards (stop_hook_active, and the hook's own prior
 * `reason` signature in the transcript). Either one alone terminates.
 */

const fs = require('fs');
const path = require('path');

const MARKER = 'THREEBRAIN_AFTER_TASK';
// The distinctive opening of the reason ask() plants. We match this signature
// (not the bare MARKER) so prose or code that merely mentions the marker — e.g.
// a tool_result echoing this file, or a message discussing the hook — can't be
// mistaken for the hook's own prior prompt and wrongly suppress a fresh one.
const REASON_SIGNATURE = MARKER + ': This task changed code';
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Paths whose changes force the adversarial Codex review (matched on `/`-normalised paths).
const SENSITIVE_PATH = /(^|\/)(src\/auth|migrations|billing)\//i;
// Agent ids end up in a file name: accept only plain id characters (no path separators).
const SAFE_AGENT_ID = /^[A-Za-z0-9_.-]+$/;

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

// The record's plain text: the string content, or all text blocks joined.
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(function (p) {
      return p && p.type === 'text' && typeof p.text === 'string' ? p.text : '';
    }).join('\n');
  }
  return '';
}

// Record a mutating tool_use's target path (file_path, or notebook_path for NotebookEdit).
function collectPaths(part, paths) {
  const inp = part.input || {};
  [inp.file_path, inp.notebook_path].forEach(function (p) {
    if (typeof p === 'string' && p) paths.push(p.replace(/\\/g, '/'));
  });
}

// Read one subagent transcript and report its mutating tool_use at/after `since`
// (ms epoch; NaN = no boundary, count all). Missing/unreadable file -> nothing.
function scanSubagent(tpath, agentId, since, paths) {
  let found = false;
  try {
    const file = path.join(path.dirname(tpath), path.basename(tpath, '.jsonl'),
      'subagents', 'agent-' + agentId + '.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      if (!line || !line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch (_) { continue; }
      const c = rec && rec.message && rec.message.content;
      if (!rec || rec.type !== 'assistant' || !Array.isArray(c)) continue;
      if (!isNaN(since)) {
        const t = Date.parse(rec.timestamp);
        if (isNaN(t) || t < since) continue; // unknowable age -> don't count (allow-list)
      }
      for (const part of c) {
        if (part && part.type === 'tool_use' && MUTATING_TOOLS.has(part.name)) {
          found = true;
          collectPaths(part, paths);
        }
      }
    }
  } catch (_) { /* missing subagent file: nothing to add */ }
  return found;
}

function ask(sensitive) {
  const reviewCmd = sensitive ? '/codex:adversarial-review' : '/codex:review';
  const reviewHandoff = 'by delegating the handoff to a subagent with model "haiku" — Haiku only triggers the Codex review and relays its output word-for-word, never summarising or reviewing the code itself';
  const simplifyPass = 'run /simplify on the code you just changed as an Opus pass (if the session model is not Opus, dispatch the pass to a subagent with model "opus")';
  const reason = [
    MARKER + ': This task changed code. Before you finish, do NOT stop yet —',
    'ask the user with the AskUserQuestion tool (header "threebrain",',
    'question "Run a threebrain pass over what just changed?") offering exactly these options:',
    '"Simplify" — ' + simplifyPass + ';',
    '"Review" — trigger the Codex review (' + reviewCmd + ') ' + reviewHandoff + ';',
    '"Review + Simplify" — run the Review first (' + reviewCmd + ', same handoff), then have a coder subagent with model "sonnet" fix the accepted findings, then run Simplify LAST: ' + simplifyPass + ';',
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

  const content = msg && msg.message && msg.message.content;

  // Guard 2 (anti-loop): the hook's own prior reason is present since the last
  // user turn -> we already asked, don't ask again.
  if (isHookReason(content)) stop();

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
      const re = /<task-id>([^<]+)<\/task-id>/g;
      let m;
      while ((m = re.exec(text)) !== null) agentIds.add(m[1].trim());
      continue;
    }
    // A genuine typed user turn ends the lookback at the current turn boundary.
    // That's plain-string content, or an array carrying real text (e.g. a message
    // with an attachment) — but NOT an array of only tool_result blocks.
    const typedTurn = typeof content === 'string'
      || (Array.isArray(content) && content.some(function (p) { return p && p.type === 'text'; }));
    if (typedTurn) { boundaryTs = Date.parse(msg.timestamp); break; }
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

if (changedCode) ask(changedPaths.some(function (p) { return SENSITIVE_PATH.test(p); }));
stop();
