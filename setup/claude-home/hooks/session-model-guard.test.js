#!/usr/bin/env node
'use strict';
/*
 * Fixture tests for session-model-guard.js. Run: node session-model-guard.test.js
 * Each case pipes SessionStart JSON to the hook (with HOME pointed at an empty
 * temp dir so the real settings cascade can't leak in) and checks the injected
 * additionalContext.
 */

const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'session-model-guard.js');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'smg-test-'));

function runRaw(input, env) {
  const r = spawnSync(process.execPath, [HOOK], {
    input, encoding: 'utf8',
    env: Object.assign({}, process.env, { HOME, USERPROFILE: HOME, CLAUDE_CODE_EFFORT_LEVEL: '' }, env || {}),
  });
  assert.strictEqual(r.status, 0, 'hook must always exit 0');
  return r.stdout.trim();
}

function context(fields, env) {
  const out = runRaw(JSON.stringify(Object.assign({ hook_event_name: 'SessionStart', source: 'startup', cwd: HOME, session_id: 'smg-test' }, fields)), env);
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

const OPT_IN = /SESSION_WORKFLOW_POLICY/;
const LOOP = /Work in one main loop/;
const STALE = /strict orchestrator|Never Edit\/Write|cheapest tier|when in doubt, workflow/;
const WARN = /effortLevel "high"/;

const cases = [
  ['opus: opt-in + single loop', { model: 'claude-opus-5-5' }, null, (c) => OPT_IN.test(c) && LOOP.test(c) && /Opus session/.test(c)],
  ['fable: opt-in + single loop', { model: 'claude-fable-5-1' }, null, (c) => OPT_IN.test(c) && LOOP.test(c) && /Fable 5 session/.test(c)],
  ['sonnet: opt-in only', { model: 'claude-sonnet-5-5' }, null, (c) => OPT_IN.test(c) && !LOOP.test(c)],
  ['haiku: opt-in only', { model: { id: 'claude-haiku-5-5' } }, null, (c) => OPT_IN.test(c) && !LOOP.test(c)],
  ['unknown: opt-in + single loop + model note', {}, null, (c) => OPT_IN.test(c) && LOOP.test(c) && /could not be read/.test(c)],
  ['no stale pipeline wording (fable)', { model: 'claude-fable-5-1' }, null, (c) => !STALE.test(c)],
  ['no stale pipeline wording (opus)', { model: 'claude-opus-5-5' }, null, (c) => !STALE.test(c)],
  ['fable high effort on startup warns', { model: 'claude-fable-5-1' }, { CLAUDE_CODE_EFFORT_LEVEL: 'high' }, (c) => WARN.test(c)],
  ['fable high effort on resume does not warn', { model: 'claude-fable-5-1', source: 'resume' }, { CLAUDE_CODE_EFFORT_LEVEL: 'high' }, (c) => !WARN.test(c)],
  ['opus high effort does not warn', { model: 'claude-opus-5-5' }, { CLAUDE_CODE_EFFORT_LEVEL: 'high' }, (c) => !WARN.test(c)],
];

let failed = 0;
for (const [name, fields, env, check] of cases) {
  let ok = false;
  try { ok = check(context(fields, env)); } catch (_) { ok = false; }
  if (ok) console.log('ok   ' + name);
  else { failed++; console.log('FAIL ' + name); }
}
// fail-open on garbage: still exits 0 and emits valid JSON (opt-in at minimum)
try {
  const out = runRaw('not json');
  if (out === '' || OPT_IN.test(JSON.parse(out).hookSpecificOutput.additionalContext)) console.log('ok   fails open on invalid JSON');
  else { failed++; console.log('FAIL fails open on invalid JSON'); }
} catch (_) { failed++; console.log('FAIL fails open on invalid JSON'); }

try { fs.rmSync(HOME, { recursive: true, force: true }); } catch (_) {}
console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
