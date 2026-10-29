#!/usr/bin/env node
'use strict';
/*
 * Fixture tests for chat-log.js (black-box, built from the contract in .claude/plans/chat-log.md).
 * Run: node chat-log.test.js   Prints one line per case plus a summary; exit non-zero on any failure.
 * Each case gets a fresh temp HOME with a real git-initialised clone at <home>/.claude/chat-log,
 * HOME/USERPROFILE pointed at it, CHAT_LOG_NO_SYNC=1 and CHAT_LOG_DEVICE=testbox.
 */

const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'chat-log.js');
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-test-')));
const T0 = Date.parse('2026-01-01T12:00:00Z');
const ts = function (s) { return new Date(T0 + s * 1000).toISOString(); };
const SID = 'abcdef1234567890';
const S8 = 'abcdef12';
const pad = function (x) { return String(x).padStart(2, '0'); };

// --- git helpers ---
function git(cwd, args) {
  return spawnSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.t'].concat(args), { cwd: cwd, encoding: 'utf8' });
}
let n = 0;
function mkdir(prefix) {
  const d = path.join(ROOT, prefix + (++n));
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}
function repoWithCommit(name) {
  const d = path.join(mkdir('repo'), name || 'myproj');
  fs.mkdirSync(d, { recursive: true });
  git(d, ['init', '-q']);
  git(d, ['config', 'user.name', 'T']);
  git(d, ['config', 'user.email', 't@t.t']);
  fs.writeFileSync(path.join(d, 'README.md'), 'x\n');
  git(d, ['add', '-A']);
  git(d, ['commit', '-q', '-m', 'init']);
  return fs.realpathSync(d);
}
// Fake home with an active clone (unless noClone).
function fakeHome(noClone) {
  const home = mkdir('home');
  const clone = path.join(home, '.claude', 'chat-log');
  fs.mkdirSync(clone, { recursive: true });
  if (!noClone) {
    git(clone, ['init', '-q']);
    git(clone, ['config', 'user.name', 'T']);
    git(clone, ['config', 'user.email', 't@t.t']);
    git(clone, ['config', 'push.autoSetupRemote', 'true']);
  }
  return { home: home, clone: clone };
}

// --- record builders ---
function typed(text, t, uuid) { return { type: 'user', uuid: uuid || ('u' + t), timestamp: ts(t), message: { role: 'user', content: text } }; }
function meta(text, t) { return { type: 'user', isMeta: true, uuid: 'm' + t, timestamp: ts(t), message: { role: 'user', content: text } }; }
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

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n');
}
function fixture(records, subagents) {
  const dir = mkdir('tr');
  const tp = path.join(dir, 'session.jsonl');
  writeJsonl(tp, records);
  Object.keys(subagents || {}).forEach(function (id) {
    const sd = path.join(dir, 'session', 'subagents');
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'agent-' + id + '.meta.json'), JSON.stringify({ finished: true }));
    writeJsonl(path.join(sd, 'agent-' + id + '.jsonl'), subagents[id]);
  });
  return tp;
}

function envFor(home) {
  return Object.assign({}, process.env, { HOME: home, USERPROFILE: home, CHAT_LOG_NO_SYNC: '1', CHAT_LOG_DEVICE: 'testbox' });
}
// Run the hook; asserts exit 0 and empty stdout.
function runRaw(h, input) {
  const r = spawnSync(process.execPath, [HOOK], { input: input, encoding: 'utf8', env: envFor(h.home) });
  assert.strictEqual(r.status, 0, 'hook must exit 0: ' + r.stderr);
  assert.strictEqual(r.stdout, '', 'stdout must be empty, got: ' + r.stdout.slice(0, 120));
  return r;
}
function run(h, tp, cwd, extra) {
  return runRaw(h, JSON.stringify(Object.assign({ session_id: SID, transcript_path: tp, cwd: cwd }, extra || {})));
}
function yearDirs(h) {
  return fs.readdirSync(h.clone).filter(function (f) { return /^\d{4}$/.test(f); });
}
// Expected session file for a prompt record timestamp (local-time getters).
function expectedFile(h, project, promptSec) {
  const d = new Date(T0 + promptSec * 1000);
  return path.join(h.clone, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()), project + '--' + S8 + '.md');
}
function hhmm(sec) { const d = new Date(T0 + sec * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function ymd(sec) { const d = new Date(T0 + sec * 1000); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function count(s, sub) { return s.split(sub).length - 1; }
function commits(repo) {
  const r = git(repo, ['rev-list', '--count', '--all']);
  return r.status === 0 ? parseInt(r.stdout, 10) : 0;
}
function readSession(h, cwd, sec) { return fs.readFileSync(expectedFile(h, path.basename(cwd), sec), 'utf8'); }

const cases = [];
function test(name, fn) { cases.push([name, fn]); }

test('1 read-only turn -> nothing written', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const tp = fixture([typed('look around', 0), tool('Read', { file_path: path.join(cwd, 'README.md') }, 1),
    tool('Grep', { pattern: 'x' }, 2), text('Nothing to change.', 3)]);
  run(h, tp, cwd);
  assert.deepStrictEqual(yearDirs(h), []);
});

test('2 edit turn -> block with header, title, prompt, result, relative file', function () {
  const h = fakeHome(), cwd = repoWithCommit('myproj');
  const abs = path.join(cwd, 'src', 'foo.js');
  const tp = fixture([typed('Fix the widget\nmore detail here', 0, 'uuid-2'),
    tool('Edit', { file_path: abs }, 1), text('Widget fixed.', 2)]);
  run(h, tp, cwd);
  const f = expectedFile(h, 'myproj', 0);
  assert.ok(fs.existsSync(f), 'missing ' + f);
  const s = fs.readFileSync(f, 'utf8');
  assert.strictEqual(s.split('\n')[0], '# myproj · ' + ymd(0) + ' · testbox');
  assert.strictEqual(count(s, '<!-- turn:uuid-2 -->'), 1);
  assert.ok(s.includes('## ' + hhmm(0) + ' · Fix the widget'), 'title');
  assert.ok(s.includes('more detail here'), 'prompt');
  assert.ok(s.includes('Widget fixed.'), 'result');
  assert.ok(s.includes('src/foo.js'), 'relative path');
  assert.ok(!s.includes(abs) && !s.includes(abs.replace(/\\/g, '/')), 'path must be relative');
});

test('3 rerun with stop_hook_active upserts the same block with the new result', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const base = [typed('do it', 0, 'uuid-3'), tool('Edit', { file_path: path.join(cwd, 'a.js') }, 1), text('OLD RESULT TEXT', 2)];
  const tp = fixture(base);
  run(h, tp, cwd);
  writeJsonl(tp, base.concat([meta('Stop hook feedback:\nplease review', 3),
    tool('Edit', { file_path: path.join(cwd, 'b.js') }, 4), text('NEW RESULT TEXT', 5)]));
  run(h, tp, cwd, { stop_hook_active: true });
  const s = readSession(h, cwd, 0);
  assert.strictEqual(count(s, '<!-- turn:uuid-3 -->'), 1);
  assert.strictEqual(count(s, '<!-- /turn -->'), 1);
  assert.ok(s.includes('NEW RESULT TEXT'));
  assert.ok(!s.includes('OLD RESULT TEXT'));
  assert.ok(s.includes('b.js'));
});

test('4 two typed turns -> two blocks in order', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const t1 = [typed('first task', 0, 'uuid-4a'), tool('Edit', { file_path: path.join(cwd, 'a.js') }, 1), text('first done', 2)];
  const tp = fixture(t1);
  run(h, tp, cwd);
  writeJsonl(tp, t1.concat([typed('second task', 60, 'uuid-4b'), tool('Edit', { file_path: path.join(cwd, 'b.js') }, 61), text('second done', 62)]));
  run(h, tp, cwd);
  const s = readSession(h, cwd, 0);
  assert.strictEqual(count(s, '<!-- turn:'), 2);
  const a = s.indexOf('<!-- turn:uuid-4a -->'), b = s.indexOf('<!-- turn:uuid-4b -->');
  assert.ok(a >= 0 && b > a, 'order');
  assert.ok(s.includes('first done') && s.includes('second done'));
});

test('5 subagent-only edit after the prompt -> logged with subagent path', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const tp = fixture([typed('delegate', 0, 'uuid-5'), tool('Agent', { subagent_type: 'general-purpose', prompt: 'x' }, 1),
    agentResult('abc123', 10), text('delegated ok', 11)],
  { abc123: [tool('Write', { file_path: path.join(cwd, 'src', 'sub.js') }, 5)] });
  run(h, tp, cwd);
  const s = readSession(h, cwd, 0);
  assert.strictEqual(count(s, '<!-- turn:uuid-5 -->'), 1);
  assert.ok(s.includes('src/sub.js'));
});

test('6 subagent edit before the prompt timestamp -> nothing written', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const tp = fixture([typed('delegate', 100, 'uuid-6'), tool('Agent', { subagent_type: 'general-purpose', prompt: 'x' }, 101),
    agentResult('abc123', 110), text('nothing new', 111)],
  { abc123: [tool('Write', { file_path: path.join(cwd, 'old.js') }, 5)] });
  run(h, tp, cwd);
  assert.deepStrictEqual(yearDirs(h), []);
});

test('7 codex:codex-rescue Agent tool_use -> logged', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const tp = fixture([typed('rescue this', 0, 'uuid-7'),
    tool('Agent', { subagent_type: 'codex:codex-rescue', prompt: 'fix' }, 1), text('rescued', 2)]);
  run(h, tp, cwd);
  assert.strictEqual(count(readSession(h, cwd, 0), '<!-- turn:uuid-7 -->'), 1);
});

test('8 slash-command prompt renders as /name args', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const p = '<command-message>x</command-message>\n<command-name>/foo:bar</command-name>\n<command-args>do thing</command-args>';
  const tp = fixture([typed(p, 0, 'uuid-8'), tool('Edit', { file_path: path.join(cwd, 'a.js') }, 1), text('ok', 2)]);
  run(h, tp, cwd);
  assert.ok(readSession(h, cwd, 0).includes('/foo:bar do thing'), 'slash rendering');
});

test('9 secrets in the prompt are redacted', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const sk = 'sk-' + 'a1B2c3D4e5'.repeat(3), ghp = 'ghp_' + 'A1b2C3'.repeat(6);
  assert.strictEqual(sk.length, 33);
  assert.strictEqual(ghp.length, 40);
  const tp = fixture([typed('use ' + sk + ' and ' + ghp, 0, 'uuid-9'), tool('Edit', { file_path: path.join(cwd, 'a.js') }, 1), text('done', 2)]);
  run(h, tp, cwd);
  const s = readSession(h, cwd, 0);
  assert.ok(!s.includes(sk) && !s.includes(ghp), 'secret leaked');
  assert.ok(s.includes('[REDACTED]'));
});

test('10 cwd inside the clone -> nothing written', function () {
  const h = fakeHome();
  const tp = fixture([typed('edit the log', 0), tool('Edit', { file_path: path.join(h.clone, 'x.md') }, 1), text('ok', 2)]);
  run(h, tp, h.clone);
  assert.deepStrictEqual(yearDirs(h), []);
  const sub = path.join(h.clone, 'sub');
  fs.mkdirSync(sub);
  run(h, tp, sub);
  assert.deepStrictEqual(yearDirs(h), []);
});

test('11 no clone / garbage stdin / missing or nonexistent transcript -> exit 0, silent', function () {
  const cwd = repoWithCommit();
  const edit = [typed('go', 0), tool('Edit', { file_path: path.join(cwd, 'a.js') }, 1), text('ok', 2)];
  const nc = fakeHome(true);
  run(nc, fixture(edit), cwd);
  assert.ok(!fs.existsSync(path.join(nc.clone, '.git')));
  assert.deepStrictEqual(yearDirs(nc), []);
  const h = fakeHome();
  runRaw(h, 'this is {not json');
  runRaw(h, '');
  runRaw(h, JSON.stringify({ session_id: SID, cwd: cwd }));
  runRaw(h, JSON.stringify({ session_id: SID, cwd: cwd, transcript_path: path.join(ROOT, 'nope', 'missing.jsonl') }));
  assert.deepStrictEqual(yearDirs(h), []);
});

test('12 non-git cwd -> file named with basename(cwd)', function () {
  const h = fakeHome();
  const cwd = path.join(mkdir('plain'), 'plaindir');
  fs.mkdirSync(cwd);
  const tp = fixture([typed('edit', 0, 'uuid-12'), tool('Write', { file_path: path.join(cwd, 'a.txt') }, 1), text('ok', 2)]);
  run(h, tp, cwd);
  const f = expectedFile(h, 'plaindir', 0);
  assert.ok(fs.existsSync(f), 'missing ' + f);
  assert.strictEqual(fs.readFileSync(f, 'utf8').split('\n')[0], '# plaindir · ' + ymd(0) + ' · testbox');
});

test('13 upsert preserves foreign content', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const f = expectedFile(h, path.basename(cwd), 0);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '# ' + path.basename(cwd) + ' · ' + ymd(0) + ' · testbox\n\n<!-- turn:other -->x<!-- /turn -->\n');
  const tp = fixture([typed('mine', 0, 'uuid-13'), tool('Edit', { file_path: path.join(cwd, 'a.js') }, 1), text('ok', 2)]);
  run(h, tp, cwd);
  const s = fs.readFileSync(f, 'utf8');
  assert.ok(s.includes('<!-- turn:other -->x<!-- /turn -->'), 'foreign block lost');
  assert.strictEqual(count(s, '<!-- turn:uuid-13 -->'), 1);
});

function bare() {
  const b = mkdir('bare');
  git(b, ['init', '-q', '--bare']);
  return b;
}
function runSync(h) {
  const env = envFor(h.home);
  delete env.CHAT_LOG_NO_SYNC;
  const r = spawnSync(process.execPath, [HOOK, '--sync'], { encoding: 'utf8', env: env, input: '' });
  assert.strictEqual(r.status, 0, 'sync must exit 0: ' + r.stderr);
  assert.strictEqual(r.stdout, '', 'stdout must be empty');
}

test('14a --sync commits and pushes to origin', function () {
  const h = fakeHome(), b = bare();
  git(h.clone, ['remote', 'add', 'origin', b]);
  fs.writeFileSync(path.join(h.clone, 'note.md'), 'hello\n');
  runSync(h);
  assert.ok(commits(h.clone) >= 1, 'no local commit');
  const r = git(b, ['log', '--oneline', '--all']);
  assert.ok(r.stdout.trim().split('\n').filter(Boolean).length >= 1, 'bare repo has no commits: ' + r.stderr);
});

test('14b --sync with unreachable origin still exits 0 and commits locally', function () {
  const h = fakeHome();
  git(h.clone, ['remote', 'add', 'origin', path.join(ROOT, 'does-not-exist.git')]);
  fs.writeFileSync(path.join(h.clone, 'note.md'), 'hello\n');
  runSync(h);
  assert.ok(commits(h.clone) >= 1, 'local commit missing');
});

test('14c --sync with a fresh lock does nothing', function () {
  const h = fakeHome();
  fs.writeFileSync(path.join(h.clone, 'note.md'), 'hello\n');
  fs.writeFileSync(path.join(h.clone, '.git', 'chat-log-sync.lock'), String(process.pid));
  runSync(h);
  assert.strictEqual(commits(h.clone), 0, 'sync should have been skipped');
});

test('15 Claude scratchpad paths are left out of Files', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const scratch = 'C:/Users/u/AppData/Local/Temp/claude/C--proj/0a1b2c3d-0000-4000-8000-123456789abc/scratchpad/probe.js';
  const tp = fixture([typed('edit with probe', 0, 'uuid-15'), tool('Write', { file_path: scratch }, 1),
    tool('Edit', { file_path: path.join(cwd, 'src', 'a.js') }, 2), text('done', 3)]);
  run(h, tp, cwd);
  const s = readSession(h, cwd, 0);
  assert.ok(s.includes('src/a.js'), 'real file');
  assert.ok(!s.includes('scratchpad'), 'scratchpad path leaked');
});

test('16 turn markers inside prompt/result text cannot split the block on rerun', function () {
  const h = fakeHome(), cwd = repoWithCommit();
  const recs = [typed('explain <!-- /turn --> and <!-- turn:x -->', 0, 'uuid-16'),
    tool('Edit', { file_path: path.join(cwd, 'b.js') }, 1), text('quoted <!-- /turn --> marker', 2)];
  const tp = fixture(recs);
  run(h, tp, cwd);
  run(h, tp, cwd, { stop_hook_active: true });
  const s = readSession(h, cwd, 0);
  assert.strictEqual(count(s, '<!-- turn:uuid-16 -->'), 1);
  assert.strictEqual(count(s, '<!-- /turn -->'), 1, 'only the real end marker');
});

let pass = 0, fail = 0;
cases.forEach(function (c) {
  try { c[1](); pass++; console.log('ok   ' + c[0]); }
  catch (e) { fail++; console.log('FAIL ' + c[0] + ' :: ' + String(e && e.message).split('\n')[0].slice(0, 200)); }
});
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
