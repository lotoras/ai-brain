#!/usr/bin/env node
'use strict';
/*
 * noop-agent-guard.js — Claude Code "PreToolUse" hook: no placeholder agents.
 *
 * While background agents or a workflow run, the model sometimes "waits" by spawning a
 * do-nothing agent ("noop", "Reply with exactly: ok"). A fork copies the whole conversation,
 * so such a call costs 60–100k tokens and achieves nothing — background work notifies the
 * session by itself. This hook denies those calls and tells the model to end its turn instead.
 *
 * Wired in ~/.claude/settings.json:
 *   "hooks": { "PreToolUse": [ {
 *     "matcher": "Agent|Task",
 *     "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/noop-agent-guard.js" }]
 *   } ] }
 *
 * Rules — only for short prompts (≤ MAX_LEN chars after trim), so a real brief is never blocked:
 *   a) the whole prompt is a no-op word (noop, placeholder, wait, ok, ping, …), punctuation ignored
 *   b) the prompt asks for a canned reply or for nothing ("reply with exactly: ok", "do nothing", …)
 *   c) the description labels the call a placeholder / no-op / keep-alive / idle
 *
 * Contract: stdout = JSON { hookSpecificOutput: { permissionDecision: "deny", ... } } on a match;
 * otherwise no output. Always exit 0; unparseable input fails open.
 */

const fs = require('fs');

const MAX_LEN = 200;
const WHOLE = /^(no[-\s]?op|placeholder|wait(ing)?|idle|ok(ay)?|ping|nothing|do nothing|sleep|keep[-\s]?alive|stand[-\s]?by)$/i;
const PHRASE = /reply(\s+with)?\s+(exactly|only)\b[\s:"'`]*(ok|done|ack|ready)\b|\bdo nothing\b|\bnothing to do\b|\bjust wait\b|\bwait for (the )?(background|other) agents?\b/i;
const DESC = /placeholder|\bno[-\s]?op\b|keep[-\s]?alive|\bidle\b/i;

const REASON =
  'noop-agent-guard: this Agent call does no work. Background agents and workflows notify you ' +
  'automatically when they finish — to wait, end your turn (or keep doing independent work). ' +
  'Never spawn placeholder/no-op agents: a fork copies your full context and costs 60–100k tokens ' +
  'even when it does nothing.';

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function deny() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: REASON,
    },
  }));
  process.exit(0);
}

function isNoop(input) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt || prompt.length > MAX_LEN) return false;
  const bare = prompt.replace(/[^a-z\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (WHOLE.test(bare)) return true;
  if (PHRASE.test(prompt)) return true;
  return DESC.test(String(input.description || ''));
}

try {
  const raw = readStdin().replace(/^﻿/, '');
  const data = JSON.parse(raw);
  if (isNoop(data.tool_input || {})) deny();
} catch (_) { /* fail open */ }
process.exit(0);
