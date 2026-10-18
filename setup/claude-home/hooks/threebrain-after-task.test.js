#!/usr/bin/env node
'use strict';
/*
 * Fixture tests for threebrain-after-task.js. Run: node threebrain-after-task.test.js
 * Each case writes a transcript (and optionally a sibling <name>/subagents/agent-X.jsonl)
 * to a temp dir, pipes Stop-hook JSON to the hook, and checks block vs silent.
 * Silent = exit 0 and empty stdout.
 * Every hook run gets HOME/USERPROFILE pointed at a per-test temp dir (os.homedir() reads
 * USERPROFILE on Windows, HOME elsewhere) so the codex plugin lookup never sees the real machine.
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
// Every agent with a subagent transcript gets an agent-<id>.meta.json marked finished (as a
// completed subagent has). `metas` = { agentId: metaObject } overrides/adds meta files, e.g. {} for a
// still-running agent (no `finished` key) — with a transcript it is "pending". Bash-style task ids get neither.
function fixture(records, subagents, metas) {
  const dir = path.join(ROOT, 'case' + (++n));
  fs.mkdirSync(dir, { recursive: true });
  const tp = path.join(dir, 'session.jsonl');
  fs.writeFileSync(tp, records.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n');
  const all = {};
  Object.keys(subagents || {}).forEach(function (id) { all[id] = { finished: true }; });
  Object.keys(metas || {}).forEach(function (id) { all[id] = metas[id]; });
  Object.keys(all).forEach(function (id) {
    const sd = path.join(dir, 'session', 'subagents');
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'agent-' + id + '.meta.json'), JSON.stringify(all[id]));
  });
  Object.keys(subagents || {}).forEach(function (id) {
    const sd = path.join(dir, 'session', 'subagents');
    fs.writeFileSync(path.join(sd, 'agent-' + id + '.jsonl'),
      subagents[id].map(function (r) { return JSON.stringify(r); }).join('\n') + '\n');
  });
  return tp;
}

// Session-dir helpers for the pending/deferral cases.
function sessionDir(tp) { return path.join(path.dirname(tp), 'session'); }
function deferredFile(tp) { return path.join(sessionDir(tp), 'threebrain-deferred.json'); }
function setMeta(tp, id, meta) {
  fs.writeFileSync(path.join(sessionDir(tp), 'subagents', 'agent-' + id + '.meta.json'), JSON.stringify(meta));
}
function rewriteAgent(tp, id, records) {
  fs.writeFileSync(path.join(sessionDir(tp), 'subagents', 'agent-' + id + '.jsonl'),
    records.map(function (r) { return JSON.stringify(r); }).join(String.fromCharCode(10)) + String.fromCharCode(10));
}
function rewrite(tp, records) {
  fs.writeFileSync(tp, records.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n');
}

function asyncLaunch(agentId, t) {
  return {
    type: 'user', timestamp: ts(t), toolUseResult: { isAsync: true, agentId: agentId, status: 'async_launched' },
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: 'launched' }] }
  };
}

// A fresh empty fake home per call; `plugins` = version dir names that get a companion script.
function fakeHome(plugins) {
  const home = fs.mkdtempSync(path.join(ROOT, 'home-'));
  (plugins || []).forEach(function (v) {
    const sd = path.join(home, '.claude', 'plugins', 'cache', 'openai-codex', 'codex', v, 'scripts');
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'codex-companion.mjs'), '// fake\n');
  });
  return home;
}

function run(tp, extra, home) {
  const h = home || fakeHome();
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(Object.assign({ transcript_path: tp }, extra || {})), encoding: 'utf8',
    env: Object.assign({}, process.env, { HOME: h, USERPROFILE: h })
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
  assert.ok(reason.includes('review --scope working-tree'));
  assert.ok(!reason.includes('adversarial'));
  assert.ok(!reason.includes('"Both"'));
});

test('(b) Edit on src/auth/Hasher.php -> adversarial review', function () {
  const reason = expectBlock(run(fixture([typed('fix it', 0), tool('Edit', { file_path: '/app/src/auth/Hasher.php' }, 1)])));
  assert.ok(reason.includes('adversarial-review --scope working-tree'));
  assert.ok(reason.includes('Review + Simplify'));
});

test('(b2) migrations / billing / path-start / Windows separators are sensitive; "authors" is not', function () {
  [['/app/db/migrations/001.sql'], ['billing\\Invoice.php'], ['src/auth/x.php'], ['C:\\app\\src\\auth\\x.php']].forEach(function (p) {
    const reason = expectBlock(run(fixture([typed('go', 0), tool('Write', { file_path: p[0] }, 1)])));
    assert.ok(reason.includes('adversarial-review --scope working-tree'), p[0]);
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
  assert.ok(expectBlock(run(tp)).includes('adversarial-review --scope working-tree'));
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

const AGENT = { subagent_type: 'general-purpose', run_in_background: true, prompt: 'x' };

test('(n) newest plugin version wins by numeric compare (1.0.10 > 1.0.6)', function () {
  const home = fakeHome(['1.0.6', '1.0.10', 'latest']);
  const reason = expectBlock(run(fixture([typed('fix', 0), tool('Edit', { file_path: '/a.js' }, 1)]), null, home));
  assert.ok(reason.includes('/1.0.10/scripts/codex-companion.mjs'), reason);
  assert.ok(!reason.includes('/1.0.6/'));
  assert.ok(reason.includes('review --scope working-tree'));
});

test('(o) no plugin dir -> fallback wording, still the review args', function () {
  const reason = expectBlock(run(fixture([typed('fix', 0), tool('Edit', { file_path: '/a.js' }, 1)])));
  assert.ok(reason.includes('scripts/codex-companion.mjs'));
  assert.ok(reason.includes("codex@openai-codex plugin's"));
  assert.ok(reason.includes('review --scope working-tree'));
  assert.ok(!reason.includes('node "'));
});

const EDIT = function (t) { return tool('Edit', { file_path: '/a.js' }, t); };
const READ = function (t) { return tool('Read', { file_path: '/a.js' }, t); };

test('(A) Edit + unfinished agent -> silent and deferral file written', function () {
  const tp = fixture([typed('go', 0), tool('Agent', AGENT, 1), asyncLaunch('bg1', 2), EDIT(3)],
    { bg1: [READ(5)] }, { bg1: {} });
  expectSilent(run(tp));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(deferredFile(tp), 'utf8')), { changed: true, sensitive: false, agents: { bg1: T0 } });
});

test('(B) later Stop, agent finished, read-only window -> block, deferral file deleted', function () {
  const tp = fixture([typed('go', 0), tool('Agent', AGENT, 1), asyncLaunch('bg1', 2), EDIT(3)],
    { bg1: [READ(5)] }, { bg1: {} });
  expectSilent(run(tp));
  setMeta(tp, 'bg1', { finished: true });
  rewrite(tp, [typed('go', 0), typed('and now?', 10), READ(11), notification('bg1', 20)]);
  expectBlock(run(tp));
  assert.ok(!fs.existsSync(deferredFile(tp)), 'deferral file must be deleted');
});

test('(C) unfinished meta but transcript 2h stale -> not pending -> Edit blocks', function () {
  const tp = fixture([typed('go', 0), EDIT(1)], { bg1: [READ(5)] }, { bg1: {} });
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(path.join(sessionDir(tp), 'subagents', 'agent-bg1.jsonl'), old, old);
  expectBlock(run(tp));
});

test('(D) deferral file + hook reason in window -> silent, file deleted', function () {
  const reasonText = 'THREEBRAIN_AFTER_TASK: This task changed code. Before you finish...';
  const tp = fixture([typed('go', 0), EDIT(1), typed(reasonText, 2)]);
  fs.mkdirSync(sessionDir(tp), { recursive: true });
  fs.writeFileSync(deferredFile(tp), '{"sensitive":false}');
  expectSilent(run(tp));
  assert.ok(!fs.existsSync(deferredFile(tp)), 'deferral file must be deleted');
});

test('(E) resumed agent (meta without finished) + Edit -> silent', function () {
  const tp = fixture([typed('go', 0), tool('Agent', AGENT, 1), asyncLaunch('bg1', 2), notification('bg1', 10),
    tool('SendMessage', { to: 'bg1', message: 'more' }, 11), EDIT(12)], { bg1: [READ(5)] }, { bg1: {} });
  expectSilent(run(tp));
});

test('(F) Bash-style notification (no meta) + read-only window -> silent, no file', function () {
  const tp = fixture([typed('go', 0), READ(1), notification('b3674gaqb', 20)]);
  expectSilent(run(tp));
  assert.ok(!fs.existsSync(deferredFile(tp)));
});

test('(G) sensitive edit deferred, later read-only window after finish -> adversarial block', function () {
  const tp = fixture([typed('go', 0), tool('Write', { file_path: '/app/src/auth/Hasher.php' }, 1), asyncLaunch('bg1', 2)],
    { bg1: [READ(5)] }, { bg1: {} });
  expectSilent(run(tp));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(deferredFile(tp), 'utf8')), { changed: true, sensitive: true, agents: { bg1: T0 } });
  setMeta(tp, 'bg1', { finished: true });
  rewrite(tp, [typed('go', 0), typed('status?', 10), READ(11)]);
  assert.ok(expectBlock(run(tp)).includes('adversarial-review --scope working-tree'));
});

// (H)/(I): agent pending at Stop 1 with a read-only window (so nothing is "changed" yet); Stop 2 is a
// newer typed turn whose own window starts after the agent's work, so only the recorded `since` finds it.
function stopOnePending() {
  const tp = fixture([typed('go', 0), READ(1), tool('Agent', AGENT, 2), asyncLaunch('bg1', 3)],
    { bg1: [READ(5)] }, { bg1: {} });
  expectSilent(run(tp));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(deferredFile(tp), 'utf8')),
    { changed: false, sensitive: false, agents: { bg1: T0 } });
  setMeta(tp, 'bg1', { finished: true });
  rewrite(tp, [typed('go', 0), READ(1), typed('later question', 10), READ(11), notification('bg1', 20)]);
  return tp;
}

test('(H) read-only Stop while agent pending, agent edits, newer typed turn, agent done -> block', function () {
  const tp = stopOnePending();
  rewriteAgent(tp, 'bg1', [READ(5), tool('Write', { file_path: '/app/src/foo.js' }, 6)]);
  expectBlock(run(tp));
  assert.ok(!fs.existsSync(deferredFile(tp)));
});

test('(I) same as (H) but the agent never wrote -> silent, file deleted', function () {
  const tp = stopOnePending();
  expectSilent(run(tp));
  assert.ok(!fs.existsSync(deferredFile(tp)));
});

let failed = 0;
cases.forEach(function (c) {
  try { c[1](); console.log('ok   ' + c[0]); } catch (e) { failed++; console.log('FAIL ' + c[0] + '\n     ' + e.message); }
});
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
console.log(failed ? failed + ' failed' : 'all ' + cases.length + ' passed');
process.exit(failed ? 1 : 0);
