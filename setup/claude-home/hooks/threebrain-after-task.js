#!/usr/bin/env node
'use strict';
/*
 * threebrain-after-task.js — Claude Code "Stop" hook.
 *
 * Fires ONLY when this task is confirmed to have changed code — i.e. an
 * Edit/Write/MultiEdit/NotebookEdit tool_use is found in the transcript since
 * the last user turn — to ask whether to run a threebrain pass over the changes
 * (Simplify / Review / Both / No) before it finishes. In every other case it
 * stays silent: read-only / Q&A tasks AND any case where history can't be
 * inspected (no/unreadable transcript). Strict allow-list — when in doubt, silent.
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

const MARKER = 'THREEBRAIN_AFTER_TASK';
// The distinctive opening of the reason ask() plants. We match this signature
// (not the bare MARKER) so prose or code that merely mentions the marker — e.g.
// a tool_result echoing this file, or a message discussing the hook — can't be
// mistaken for the hook's own prior prompt and wrongly suppress a fresh one.
const REASON_SIGNATURE = MARKER + ': This task changed code';
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

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

function ask() {
  const reason = [
    MARKER + ': This task changed code. Before you finish, do NOT stop yet —',
    'ask the user with the AskUserQuestion tool (header "threebrain",',
    'question "Run a threebrain pass over what just changed?") offering exactly these options:',
    '"Simplify" — run /simplify on the code you just changed as a Fable 5 pass (if the session model is not Fable 5, dispatch the pass to a subagent with model "fable");',
    '"Review" — trigger the Codex review (/codex:review) by delegating the handoff to a subagent with model "sonnet" — Sonnet only triggers and relays the Codex review, it never reviews the code itself;',
    '"Both" — run both: Simplify, then Review;',
    '"No" — skip and stop.',
    'Then act on the choice, routing silently per the threebrain skill. If the user picks "No", just stop.'
  ].join(' ');
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
for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i];
  if (!line || !line.trim()) continue;

  let msg;
  // An unparseable line is a blind spot: we can't tell a turn boundary from an
  // edit past it, so stop the lookback and decide on what we've confirmed so far
  // (strict allow-list — never cross a blind spot to grab a stale edit).
  try { msg = JSON.parse(line); } catch (_) { break; }

  const content = msg && msg.message && msg.message.content;

  // Guard 2 (anti-loop): the hook's own prior reason is present since the last
  // user turn -> we already asked, don't ask again.
  if (isHookReason(content)) stop();

  // Confirm a file-mutating tool call in an assistant turn.
  if (msg.type === 'assistant' && Array.isArray(content)) {
    for (const part of content) {
      if (part && part.type === 'tool_use' && MUTATING_TOOLS.has(part.name)) {
        changedCode = true;
      }
    }
  }

  // A genuine typed user turn ends the lookback at the current turn boundary.
  // That's plain-string content, or an array carrying real text (e.g. a message
  // with an attachment) — but NOT an array of only tool_result blocks.
  if (msg.type === 'user') {
    const typedTurn = typeof content === 'string'
      || (Array.isArray(content) && content.some(function (p) { return p && p.type === 'text'; }));
    if (typedTurn) break;
  }
}

if (changedCode) ask();
stop();
