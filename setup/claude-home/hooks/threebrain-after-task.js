#!/usr/bin/env node
'use strict';
/*
 * threebrain-after-task.js — Claude Code "Stop" hook.
 *
 * After a task that CHANGED CODE/FILES, force Claude to ask whether to run a
 * threebrain pass over the changes (Simplify / Review / Both / No) before it
 * finishes. Stays silent on pure Q&A / read-only tasks.
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
 * Anti-loop: two independent guards (stop_hook_active, and a transcript marker
 * that this hook itself plants in `reason`). Either one alone terminates.
 */

const fs = require('fs');

const MARKER = 'THREEBRAIN_AFTER_TASK';
const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function ask() {
  const reason = [
    MARKER + ': This task changed code. Before you finish, do NOT stop yet —',
    'ask the user with the AskUserQuestion tool (header "threebrain",',
    'question "Run a threebrain pass over what just changed?") offering exactly these options:',
    '"Simplify" — run /simplify on the code you just changed;',
    '"Review" — look the changes over for bugs/issues via threebrain (/codex:review);',
    '"Both" — run /simplify, then /codex:review;',
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

// Guard 2 + "only when code changed": scan the transcript tail.
const tp = input && input.transcript_path;
if (!tp || !fs.existsSync(tp)) {
  // Can't inspect history. Degrade to "ask" so the feature isn't silently dead;
  // Guard 1 still prevents loops.
  ask();
}

let lines;
try {
  lines = fs.readFileSync(tp, 'utf8').split('\n');
} catch (_) {
  ask();
}

let changedCode = false;
for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i];
  if (!line || !line.trim()) continue;

  // Already asked since the last user turn -> don't ask again (deterministic anti-loop).
  if (line.indexOf(MARKER) !== -1) stop();

  let msg;
  try { msg = JSON.parse(line); } catch (_) { continue; }

  // Detect file-mutating tool calls in assistant turns.
  const content = msg && msg.message && msg.message.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && part.type === 'tool_use' && MUTATING_TOOLS.has(part.name)) {
        changedCode = true;
      }
    }
  }

  // A genuine typed user message (string content, not a tool_result array) ends the lookback.
  if (msg && msg.type === 'user' && typeof content === 'string') break;
}

if (changedCode) ask();
stop();
