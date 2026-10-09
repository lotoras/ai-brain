#!/usr/bin/env node
'use strict';
/*
 * fable-edit-guard.js — Claude Code "PreToolUse" hook.
 *
 * Denies Edit / Write / NotebookEdit calls that originate from the *main thread*
 * of a Fable 5 session.  Subagent calls (identified by the presence of agent_id
 * or agent_type in stdin) are always allowed — coders must be able to edit.
 * Plan files (*.md under a .claude/plans/ dir) are also always allowed.
 *
 * Wired in ~/.claude/settings.json:
 *   "hooks": { "PreToolUse": [ {
 *     "matcher": "Edit|Write|NotebookEdit",
 *     "hooks": [{ "type": "command",
 *                 "command": "node ~/.claude/hooks/fable-edit-guard.js" }]
 *   } ] }
 *
 * Contract (PreToolUse hook):
 *   stdin  = JSON { hook_event_name, tool_name, tool_input, session_id,
 *                   agent_id?, agent_type?, ... }
 *   stdout = JSON { hookSpecificOutput: { hookEventName: "PreToolUse",
 *                                         permissionDecision: "allow"|"deny",
 *                                         permissionDecisionReason: "..." } }
 *            OR empty / no output → allow (fail-open)
 *   exit 0 always — never crash the session or block a legitimate coder.
 *
 * State file (written by session-model-guard.js):
 *   <os.tmpdir()>/claude-model-guard/<sanitised-sid>.state.json
 *   { session_id, model_class, effort, cwd, written_at }
 *
 * Fail-open: any branch that cannot confirm (fable + main-thread) exits 0 silently.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ── helpers ───────────────────────────────────────────────────────────────────

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function allow() { process.exit(0); }

function deny() {
  const reason =
    'Fable 5 session policy: the main thread never edits. Dispatch a named coder ' +
    'subagent with a self-contained brief (objective, exact paths, gathered findings, ' +
    'required output format) and let it make this change. ' +
    'The only main-thread write allowed on Fable is a plan file: *.md under a ' +
    '.claude/plans/ directory. ' +
    '(If this denial seems wrong — e.g. the session is no longer on Fable 5 — tell ' +
    'the user to start a fresh session; this guard is keyed to the session-start model.)';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName:          'PreToolUse',
      permissionDecision:     'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

// Plan files are the one main-thread write a Fable orchestrator may do itself:
// any *.md directly inside a .claude/plans/ directory (harness plan mode writes to
// ~/.claude/plans/<slug>.md; project convention is <repo>/.claude/plans/<slug>.md).
function isPlanFile(toolInput) {
  const p = toolInput && (toolInput.file_path || toolInput.notebook_path || toolInput.path);
  if (!p || typeof p !== 'string') return false;
  const norm = p.replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/../') || norm.startsWith('../')) return false;  // no traversal escape
  return /(^|\/)\.claude\/plans\/[^/]+\.md$/.test(norm);
}

// ── main ──────────────────────────────────────────────────────────────────────
try {
  // 1. Parse stdin (BOM-safe).
  const raw = readStdin().replace(/^﻿/, '').trim();
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch (_) { allow(); }

  // 2. Subagent check — agent_id or agent_type present and truthy → always allow.
  if (input && (input.agent_id || input.agent_type)) allow();

  // 3. Resolve session state file.
  const rawSid = (input && input.session_id) != null ? String(input.session_id) : 'unknown';
  const sid    = rawSid.replace(/[^A-Za-z0-9_-]/g, '_');
  const stateFile = path.join(os.tmpdir(), 'claude-model-guard', `${sid}.state.json`);

  let state = null;
  try {
    const stateRaw = fs.readFileSync(stateFile, 'utf8').replace(/^﻿/, '');
    state = JSON.parse(stateRaw);
  } catch (_) { allow(); }  // missing or unparseable → allow

  // 4. Not fable → allow.
  if (!state || state.model_class !== 'fable') allow();

  // 5. State older than 48 h → allow (stale).
  const AGE_LIMIT = 48 * 60 * 60 * 1000;
  if (!state.written_at || (Date.now() - state.written_at) > AGE_LIMIT) allow();

  // 6. Plan-file exception — the orchestrator may write its own plan.
  if (isPlanFile(input && input.tool_input)) allow();

  // 7. Confirmed: fable + main thread + fresh state + not a plan file → DENY.
  deny();

} catch (_) {
  // Any unexpected error: fail-open, never crash the session.
  process.exit(0);
}
