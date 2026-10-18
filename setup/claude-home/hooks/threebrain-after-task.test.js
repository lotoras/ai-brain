#!/usr/bin/env node
'use strict';
/*
 * Fixture tests for threebrain-after-task.js. Run: node threebrain-after-task.test.js
 * Each case writes a transcript (and optionally a sibling <name>/subagents/agent-X.jsonl)
 * to a temp dir, pipes Stop-hook JSON to the hook, and checks block vs silent.
 * Silent = exit 0 and empty stdout.
 */

const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'threebrain-after-task.js');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'threebrain-test-'));
const T0 = Date.parse('2026-01-01T12:00:00Z');
const ts = function (offsetSec) { return new Date(T0 + offsetSec * 1000).toISOString(); };

// --- fixture record builders ---
function typed(text, t) { return { type: 'user', timestamp: ts(t), message: { role: 'user', content: text } }; }
function tool(name, input, t) {
  return { type: 'assistant', timestamp: ts(t), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_' + t, name: name, input: input }] } };
}
function text(s, t) { return { type: 'assistant', timestamp: ts(t), message: { role: 'assistant', content: [{ type: 'text', text: s }] } }; }
function agentResult(agentId, t) {
  return {
    type: 'user', timestamp: ts(t), toolUseResult: { agentId: agentId, status: 'completed' },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: 'done' }] }
  };
}
function notification(agentId, t) {
  return { type: 'user', timestamp: ts(t), message: { role: 'user', content: '<task-notification><task-id>' + agentId + '</task-id><status>completed</status></task-notification>' } };
}

let n = 0;
// Write a fixture; returns the transcript path. `subagents` = { agentId: [records] }.
function fixture(records, subagents) {
  const dir = path.join(ROOT, 'case' + (++n));
  fs.mkdirSync(dir, { recursive: true });
  const tp = path.join(dir, 'session.jsonl');
  fs.writeFileSync(tp, records.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n');
  Object.keys(subagents || {}).forEach(function (id) {
    const sd = path.join(dir, 'session', 'subagents');
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'agent-' + id + '.jsonl'),
      subagents[id].map(function (r) { return JSON.stringify(r); }).join('\n') + '\n');
  });
  return tp;
}

function run(tp, extra) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(Object.assign({ transcript_path: tp }, extra || {})), encoding: 'utf8'
  });
  assert.strictEqual(r.status, 0, 'hook must exit 0: ' + r.stderr);
  return r.stdout;
}
function expectBlock(out) {
  assert.ok(out.length > 0, 'expected a block, got silence');
  const j = JSON.parse(out);
  assert.strictEqual(j.decision, 'block');
  return j.reason;
}
function expectSilent(out) { assert.strictEqual(out, '', 'expected silence, got: ' + out.slice(0, 120)); }

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('(a) Edit on src/foo.js -> block, plain review', function () {
  const reason = expectBlock(run(fixture([typed('fix it', 0), tool('Edit', { file_path: 'C:\\app\\src\\foo.js' }, 1)])));
  assert.ok(reason.includes('Review + Simplify'));
  assert.ok(reason.includes('/codex:review'));
  assert.ok(!reason.includes('adversarial'));
  assert.ok(!reason.includes('"Both"'));
});

test('(b) Edit on src/auth/Hasher.php -> adversarial review', function () {
  const reason = expectBlock(run(fixture([typed('fix it', 0), tool('Edit', { file_path: '/app/src/auth/Hasher.php' }, 1)])));
  assert.ok(reason.includes('/codex:adversarial-review'));
  assert.ok(reason.includes('Review + Simplify'));
});

test('(b2) migrations / billing / path-start / Windows separators are sensitive; "authors" is not', function () {
  [['/app/db/migrations/001.sql'], ['billing\\Invoice.php'], ['src/auth/x.php'], ['C:\\app\\src\\auth\\x.php']].forEach(function (p) {
    const reason = expectBlock(run(fixture([typed('go', 0), tool('Write', { file_path: p[0] }, 1)])));
    assert.ok(reason.includes('/codex:adversarial-review'), p[0]);
  });
  const reason = expectBlock(run(fixture([typed('go', 0), tool('Write', { file_path: '/app/src/authors/x.js' }, 1)])));
  assert.ok(!reason.includes('adversarial'));
});

test('(c) subagent Write after the boundary -> block', function () {
  const tp = fixture(
    [typed('delegate', 0), tool('Agent', { subagent_type: 'general-purpose', prompt: 'x' }, 1), agentResult('abc123', 10)],
    { abc123: [tool('Write', { file_path: '/app/src/foo.js' }, 5)] });
  expectBlock(run(tp));
});

test('(c2) subagent writing under billing/ -> adversarial', function () {
  const tp = fixture(
    [typed('delegate', 0), tool('Agent', { subagent_type: 'general-purpose', prompt: 'x' }, 1), agentResult('abc123', 10)],
    { abc123: [tool('Write', { file_path: '/app/billing/Pay.php' }, 5)] });
  assert.ok(expectBlock(run(tp)).includes('/codex:adversarial-review'));
});

test('(d) subagent Write before the boundary -> silent', function () {
  const tp = fixture(
    [typed('earlier work', -100), typed('delegate', 0), tool('Agent', { subagent_type: 'general-purpose', prompt: 'x' }, 1), agentResult('abc123', 10)],
    { abc123: [tool('Write', { file_path: '/app/src/foo.js' }, -50)] });
  expectSilent(run(tp));
});

test('(d2) resumed agent: old edit ignored, new edit counted', function () {
  const tp = fixture(
    [typed('again', 0), tool('SendMessage', { to: 'abc123', message: 'more' }, 1)],
    { abc123: [tool('Write', { file_path: '/a.js' }, -50)] });
  expectSilent(run(tp));
  const tp2 = fixture(
    [typed('again', 0), tool('SendMessage', { to: 'abc123', message: 'more' }, 1)],
    { abc123: [tool('Write', { file_path: '/a.js' }, -50), tool('Edit', { file_path: '/a.js' }, 5)] });
  expectBlock(run(tp2));
});

test('(e) codex:codex-rescue Agent call -> block', function () {
  expectBlock(run(fixture([typed('rescue', 0), tool('Agent', { subagent_type: 'codex:codex-rescue', prompt: 'fix' }, 1)])));
});

test('(f) read-only transcript -> silent', function () {
  expectSilent(run(fixture([typed('what is this', 0), tool('Read', { file_path: '/a.js' }, 1), text('it is a file', 2)])));
});

test('(g) stop_hook_active -> silent', function () {
  expectSilent(run(fixture([typed('fix', 0), tool('Edit', { file_path: '/a.js' }, 1)]), { stop_hook_active: true }));
});

test('(h) prior hook reason present -> silent', function () {
  const reasonText = 'THREEBRAIN_AFTER_TASK: This task changed code. Before you finish...';
  expectSilent(run(fixture([typed('fix', 0), tool('Edit', { file_path: '/a.js' }, 1), typed(reasonText, 2)])));
});

test('(i) task-notification is not a turn boundary; async agent edit counted', function () {
  const tp = fixture(
    [typed('start async', 0), tool('Agent', { subagent_type: 'general-purpose', run_in_background: true, prompt: 'x' }, 1), notification('async9', 20)],
    { async9: [tool('Edit', { file_path: '/a.js' }, 10)] });
  expectBlock(run(tp));
});

test('(j) missing subagent file / missing transcript -> silent', function () {
  expectSilent(run(fixture([typed('delegate', 0), agentResult('ghost', 5)])));
  expectSilent(run(path.join(ROOT, 'nope.jsonl')));
});

let failed = 0;
cases.forEach(function (c) {
  try { c[1](); console.log('ok   ' + c[0]); } catch (e) { failed++; console.log('FAIL ' + c[0] + '\n     ' + e.message); }
});
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
console.log(failed ? failed + ' failed' : 'all ' + cases.length + ' passed');
process.exit(failed ? 1 : 0);
