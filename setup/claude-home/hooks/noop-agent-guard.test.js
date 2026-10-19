#!/usr/bin/env node
'use strict';
/*
 * Fixture tests for noop-agent-guard.js. Run: node noop-agent-guard.test.js
 * Each case pipes PreToolUse JSON to the hook and checks deny vs silent.
 * Silent = exit 0 and empty stdout.
 */

const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

const HOOK = path.join(__dirname, 'noop-agent-guard.js');

function runRaw(input) {
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'hook must always exit 0');
  return r.stdout.trim();
}

function run(toolInput) {
  return runRaw(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: toolInput }));
}

function denied(out) {
  return out !== '' && JSON.parse(out).hookSpecificOutput.permissionDecision === 'deny';
}

const BRIEF = 'Objective: map how text sizes are set on the site so we can plan a sitewide type change. ' +
  'Read-only. Repo dir: C:/laragon/www/claude-designs/project. Find and report: 1. the helmet style block ' +
  '2. inline font sizes under 18px with counts 3. the hero trust line markup. Output: bullets, ≤400 words.';
const ROLE = 'Look at CLAUDE.md, README.md, and any top-level .md files in docs/ to figure out the tech stack, ' +
  'domain, and likely role of someone working on the task below. Return ONE line: a role phrased as ' +
  "'a senior [stack/domain] [role]' — nothing else. Task: make the hero text bigger.";

const cases = [
  // the two real calls that triggered this guard
  ['denies fork "noop"', { subagent_type: 'fork', description: 'Placeholder', prompt: 'noop' }, true],
  ['denies fork canned reply', { subagent_type: 'fork', description: 'Wait placeholder', prompt: 'Reply with exactly: ok. Do not run any tools.' }, true],
  // rule a — whole prompt is a no-op word
  ['denies bare "wait"', { prompt: 'wait' }, true],
  ['denies "No-op."', { prompt: 'No-op.' }, true],
  ['denies "ok"', { subagent_type: 'fork', prompt: 'ok' }, true],
  // rule b — canned reply / nothing to do
  ['denies "reply only: done"', { prompt: 'Reply only "done".' }, true],
  ['denies "just wait"', { prompt: 'Just wait until the explorers finish.' }, true],
  ['denies "do nothing"', { prompt: 'Do nothing and return.' }, true],
  // rule c — description says placeholder
  ['denies placeholder description', { description: 'Placeholder', prompt: 'Check in later.' }, true],
  ['denies keep-alive description', { description: 'keep-alive', prompt: 'Return.' }, true],
  // allowed
  ['allows a long brief', { subagent_type: 'Explore', description: 'Map typography', prompt: BRIEF }, false],
  ['allows the cc-enhance role prompt', { subagent_type: 'Explore', model: 'haiku', description: 'Infer role for prompt', prompt: ROLE }, false],
  ['allows a short real fork task', { subagent_type: 'fork', description: 'Finish step B2', prompt: 'Continue with step B2 and report the result.' }, false],
  ['allows "wait for CI then report"', { prompt: 'Wait for the CI run on PR 42 to finish, then report failures.' }, false],
  ['allows missing prompt', { description: 'x' }, false],
];

let failed = 0;
for (const [name, input, expectDeny] of cases) {
  const got = denied(run(input));
  if (got === expectDeny) console.log('ok   ' + name);
  else { failed++; console.log('FAIL ' + name + ' (expected ' + (expectDeny ? 'deny' : 'allow') + ')'); }
}
// fail-open on garbage
if (runRaw('not json') === '') console.log('ok   fails open on invalid JSON');
else { failed++; console.log('FAIL fails open on invalid JSON'); }

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
