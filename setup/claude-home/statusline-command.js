#!/usr/bin/env node
// Claude Code statusline: the "Club" look from the Neon Console design
// (C:\laragon\www\claude-designs, branch design/neon-console, project/src/neon-statusline.js).
// Five lines: VU meters for context and both rate limits, a now-playing line, session info,
// and a disco floor where Clawd dances while the session is busy (prompt-board's blue); otherwise he
// sleeps on an unlit, still floor. One frame per second (settings.json refreshInterval: 1).
// Glyphs are limited to what prompt-board renders (Consolas + Segoe UI Symbol). Respects NO_COLOR.
// Test hooks: COLUMNS, CLAWD_FRAME, STATUSLINE_NOW (epoch ms); stdin JSON may pin _git and _status.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ── Palette ──────────────────────────────────────────────────────────────
const HEX = {
  pink: [255, 42, 109], magenta: [211, 0, 197], purple: [185, 103, 255], cyan: [5, 217, 232],
  yellow: [249, 248, 113], mint: [1, 255, 195], text: [224, 215, 255], gray: [169, 155, 209],
  dim: [90, 74, 120], clawd: [217, 119, 87],
  hot: [255, 238, 250],   // white-hot core of a lit tube
  unlit: [44, 32, 72],    // glass with the power off
};
const OUTRUN = [HEX.pink, HEX.purple, HEX.cyan];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, f) => a.map((v, k) => Math.round(v + (b[k] - v) * f));
const shade = (c, f) => c.map((v) => Math.round(v * f));
function ramp(stops, t) {
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return lerp(stops[i], stops[i + 1], x - i);
}

// ── ANSI pen and cell lines (one cell per terminal column) ─────────────────
function makePen(noColor) {
  const on = !noColor;
  const fg = (c) => (on && c ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m` : '');
  const bg = (c) => (on && c ? `\x1b[48;2;${c[0]};${c[1]};${c[2]}m` : '');
  return { on, fg, bg, reset: on ? '\x1b[0m' : '', bold: on ? '\x1b[1m' : '' };
}

const cells = (text, fg, bg, b) => Array.from(String(text), (ch) => ({ ch, fg, bg, b: !!b }));
const gap = (n) => cells(' '.repeat(Math.max(0, n)));
const join = (...parts) => [].concat(...parts.filter(Boolean));

function emit(line, pen) {
  let end = line.length;
  while (end > 0 && line[end - 1].ch === ' ' && !line[end - 1].bg) end--;
  let out = '', key = null;
  for (let i = 0; i < end; i++) {
    const c = line[i];
    const k = `${c.fg}|${c.bg}|${c.b}`;
    if (k !== key) {
      if (key !== null) out += pen.reset;
      out += (c.b ? pen.bold : '') + pen.bg(c.bg) + pen.fg(c.fg);
      key = k;
    }
    out += c.ch;
  }
  return key !== null ? out + pen.reset : out;
}

const visWidth = (s) => {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  return Array.from(plain).length + (plain.match(/⚡/g) || []).length;
};

// A segment is {cells, drop}: drop 0 = always kept, higher = dropped first when a row is too wide.
const seg = (c, drop = 0) => (c && c.length ? { cells: c, drop } : null);
function row(segs, width, sep = 2) {
  const list = segs.filter(Boolean);
  const total = () => list.reduce((n, s) => n + s.cells.length, 0) + sep * Math.max(0, list.length - 1);
  while (total() > width) {
    let pick = -1;
    list.forEach((s, i) => { if (s.drop > 0 && (pick < 0 || s.drop >= list[pick].drop)) pick = i; });
    if (pick < 0) break;
    list.splice(pick, 1);
  }
  const out = [];
  list.forEach((s, i) => { if (i) out.push(...gap(sep)); out.push(...s.cells); });
  return out.slice(0, width);
}
// Left content, right-aligned tail; the tail wins when space runs out.
function spread(left, right, width) {
  const r = right || [];
  const l = left.slice(0, Math.max(0, width - r.length - (r.length ? 2 : 0)));
  return l.concat(gap(width - l.length - r.length), r).slice(0, width);
}
const fill = (line, width) => line.concat(gap(width - line.length)).slice(0, width);

// ── Data: Claude Code statusline JSON → display values ─────────────────────
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_COLOR = { low: HEX.dim, medium: HEX.cyan, high: HEX.purple, xhigh: HEX.magenta, max: HEX.pink };

function modelColor(model) {
  const s = `${model.id || ''} ${model.display_name || ''}`.toLowerCase();
  if (s.includes('fable')) return HEX.purple;
  if (s.includes('opus')) return HEX.pink;
  if (s.includes('sonnet')) return HEX.cyan;
  if (s.includes('haiku')) return HEX.mint;
  return HEX.text;
}

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return `${Math.floor(ms / 1000)}s`;
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  return `${h}h${String(totalMin % 60).padStart(2, '0')}`;
}

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

function read(data, now) {
  const ws = data.workspace || {};
  const cur = norm(ws.current_dir || data.cwd || '');
  const root = norm(ws.project_dir || cur);
  const base = root.split('/').filter(Boolean).pop() || '~';
  const sub = root && cur.toLowerCase().startsWith(root.toLowerCase() + '/') ? cur.slice(root.length) : '';

  const g = data._git || null;
  const branch = (data.worktree && data.worktree.branch) || (g && g.branch) || null;
  const c = data.cost || {};
  const add = c.total_lines_added || 0;
  const rem = c.total_lines_removed || 0;
  const tags = [];
  if (data.agent && data.agent.name) tags.push(data.agent.name);
  if (data.worktree && data.worktree.name) tags.push(`wt:${data.worktree.name}`);

  const model = data.model || {};
  const lv = data.effort && data.effort.level ? String(data.effort.level).toLowerCase() : null;

  const cw = data.context_window || {};
  let ctx = Number.isFinite(cw.used_percentage) ? cw.used_percentage : null;
  if (ctx == null && cw.current_usage && cw.context_window_size) {
    const u = cw.current_usage;
    const used = (u.input_tokens || 0) + (u.output_tokens || 0)
      + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    ctx = (used / cw.context_window_size) * 100;
  }

  const rl = data.rate_limits || {};
  const limits = [];
  for (const [key, label] of [['five_hour', '5H'], ['seven_day', '7D']]) {
    const p = rl[key] && rl[key].used_percentage;
    if (!Number.isFinite(p)) continue;
    const at = rl[key].resets_at;
    const reset = Number.isFinite(at) && at * 1000 > now ? `T-${formatDuration(at * 1000 - now)}` : null;
    limits.push({ label, pct: p, reset });
  }

  return {
    title: base.toUpperCase().replace(/[-_ ]+/g, '·'),
    sub,
    git: branch ? { branch, dirty: !!(g && g.dirty) } : null,
    diff: add > 0 || rem > 0 ? { add, rem } : null,
    time: Number.isFinite(c.total_duration_ms) && c.total_duration_ms > 0 ? formatDuration(c.total_duration_ms) : null,
    tags,
    model: { name: String(model.display_name || model.id || '--').toUpperCase(), color: modelColor(model) },
    effort: lv ? { level: lv, idx: EFFORT_LEVELS.indexOf(lv) + 1, color: EFFORT_COLOR[lv] || HEX.text } : null,
    fast: data.fast_mode === true,
    ctx,
    cost: Number.isFinite(c.total_cost_usd) ? c.total_cost_usd : null,
    limits,
  };
}

// Branch + dirty state from one git call, cached per cwd for a few seconds.
function gitInfo(cwd) {
  const key = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);
  const cacheFile = path.join(os.tmpdir(), `cc-statusline-git-${key}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (Date.now() - cached.at < 5000) return cached.info;
  } catch (_) { /* no cache yet */ }

  let info = null;
  try {
    const out = execFileSync('git', ['status', '--porcelain=v2', '--branch'], {
      cwd, timeout: 400, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    let head = null, oid = null, dirty = false;
    for (const line of out.split('\n')) {
      if (line.startsWith('# branch.head ')) head = line.slice(14).trim();
      else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim();
      else if (line && !line.startsWith('#')) dirty = true;
    }
    if (head === '(detached)') head = oid ? oid.slice(0, 7) : 'detached';
    if (head) info = { branch: head, dirty };
  } catch (_) { /* not a repo / git missing */ }

  try { fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), info })); } catch (_) { /* ignore */ }
  return info;
}

// This session's busy | idle | waiting from Claude Code's live registry (sessions/<pid>.json),
// the same field prompt-board colours its cards by. null when unknown.
function sessionStatus(sessionId) {
  if (!sessionId) return null;
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
  let best = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (r.sessionId === sessionId && (!best || (r.updatedAt || 0) > (best.updatedAt || 0))) best = r;
      } catch (_) { /* unreadable entry */ }
    }
  } catch (_) { /* no registry */ }
  return best && typeof best.status === 'string' ? best.status : null;
}

// ── Shared pieces ──────────────────────────────────────────────────────────
const WARN = { ctx: [60, 85], limit: [50, 85] };
const severity = (p, [warn, crit]) => (p > crit ? 2 : p > warn ? 1 : 0);
// Critical values strobe pink / white-hot on alternate ticks.
const sevColor = (p, th, tick) => {
  const s = severity(p, th);
  return s === 2 ? (tick % 2 ? HEX.hot : HEX.pink) : s === 1 ? HEX.yellow : HEX.gray;
};
const costColor = (v) => (v < 5 ? HEX.mint : v < 20 ? HEX.yellow : HEX.pink);

const pct = (p, th, tick, pad = 4) =>
  cells(`${Math.round(p)}%`.padStart(pad), sevColor(p, th, tick), null, true);
const gitCells = (d) => d.git && join(cells(`⎇ ${d.git.branch}`, HEX.cyan), d.git.dirty && cells('*', HEX.yellow));
const timeCells = (d) => d.time && cells(`◷ ${d.time}`, HEX.gray);
const diffCells = (d) => d.diff && join(cells(`+${d.diff.add}`, HEX.mint), gap(1), cells(`−${d.diff.rem}`, HEX.pink));
const tagCells = (d) => d.tags.length > 0 && cells(`[${d.tags.join(' · ')}]`, HEX.dim);
const costCells = (d) => d.cost != null && cells(`$${d.cost.toFixed(2)}`, costColor(d.cost), null, true);
const effortMeter = (d, on = '▸', off = '▹') => d.effort && d.effort.idx > 0
  && join(cells(on.repeat(d.effort.idx), d.effort.color), cells(off.repeat(5 - d.effort.idx), HEX.dim));
const effortLabel = (d) => d.effort && cells(d.effort.level.toUpperCase(), d.effort.color, null, true);

// ── Clawd, dancing (11 cols × 3 rows per frame; one frame per refresh tick) ──
const CLAWD_W = 11;
const IDLE = ['  ▐▛███▜▌  ', ' ▝▜█████▛▘ ', '   ▘▘ ▝▝   '];
const CLAWD = [
  IDLE,
  [' ▐▛███▜▌   ', '▝▜█████▛▘  ', '  ▘▘ ▝▝    '],
  IDLE,
  ['   ▐▛███▜▌ ', '  ▝▜█████▛▘', '    ▘▘ ▝▝  '],
  [' ▗▐▛███▜▌▖ ', '  ▜█████▛  ', '   ▘▘ ▝▝   '],
  ['  ▐▛███▜▌  ', ' ▝▜█████▛▘ ', '  ▘▘   ▝▝  '],
];
// [column offset over the head, glyph, colour] — CP437 notes render in any terminal font.
const NOTES = [[3, '♪', 'pink'], [1, '♫', 'cyan'], [7, '♪', 'pink'], [9, '♫', 'cyan'], [5, '♫', 'pink'], [2, '♪', 'cyan']];
const BEAT = 4;   // "arms up" frame: the header flashes on it
// Not busy: eyes shut, a still "z Z" over the head.
const CLAWD_SLEEP = ['  ▐▀███▀▌  ', ' ▝▜█████▛▘ ', '   ▘▘ ▝▝   '];
const SNORE = [6, 'z Z', 'purple'];

// Columns kept free on the right: Claude Code indents the statusline 2 columns and prompt-board's
// scrollbar covers the last 2–3, so every line stops 6 columns short of COLUMNS.
const RIGHT_MARGIN = 6;

// Where the mascot sits and how wide the content may grow.
function layout(cols) {
  if (!Number.isFinite(cols)) return { col: 56, avail: 52, full: 52 };
  const full = cols - RIGHT_MARGIN;
  if (cols < 70) return { col: null, avail: full, full };
  const col = full - CLAWD_W;
  return { col, avail: col - 2, full };
}

function withMascot(lines, col, frame, pen, asleep) {
  if (col == null) return lines;
  const paint = (c, s) => (pen.on ? `${pen.fg(c)}${s}${pen.reset}` : s);
  const [noteOff, note, noteColor] = asleep ? SNORE : NOTES[frame];
  const targets = [[0, ' '.repeat(noteOff) + paint(HEX[noteColor], note)]]
    .concat((asleep ? CLAWD_SLEEP : CLAWD[frame]).map((r, i) => [i + 1, paint(HEX.clawd, r)]));
  if (targets.some(([i]) => lines[i] == null || visWidth(lines[i]) > col - 2)) return lines;
  const out = lines.slice();
  for (const [i, art] of targets) out[i] += ' '.repeat(col - visWidth(out[i])) + art;
  return out;
}

// ── Club: VU meters, a now-playing line, and a disco floor for Clawd ───────
function club(d, L, t) {
  const W = L.avail;
  const F = L.full;
  const RACK = 16;                       // " ███  ███  ███  "
  const C = W - RACK;
  const beat = !t.asleep && t.frame === BEAT;
  const meters = [
    { label: 'CTX', p: d.ctx, th: WARN.ctx },
    ...d.limits.map((l) => ({ label: l.label, p: l.pct, th: WARN.limit })),
  ];
  while (meters.length < 3) meters.push({ label: '', p: null, th: WARN.limit });

  // Row 0: meter labels, then ░▒▓ AI·BRAIN ▓▒░ ──── /sub ──── (flashes on the beat)
  let labels = gap(1);
  meters.forEach((m) => { labels = join(labels, cells(m.label.padEnd(3), HEX.gray), gap(2)); });
  const glow = (c) => (beat ? lerp(c, HEX.hot, 0.5) : c);
  const head = Array.from(`░▒▓ ${d.title} ▓▒░`);
  let header = head.map((ch, i) => ({ ch, fg: glow(ramp(OUTRUN, i / C)), b: i > 3 && i < head.length - 4 }));
  const subCells = d.sub ? cells(` ${d.sub} `, HEX.gray) : [];
  const ruleTo = (n) => {
    while (header.length < n) header.push({ ch: '─', fg: glow(shade(ramp(OUTRUN, header.length / C), 0.7)) });
  };
  if (subCells.length && header.length + 3 + subCells.length <= C) {
    ruleTo(header.length + 2);
    header = header.concat(subCells);
  }
  ruleTo(C);
  const top = join(labels, header.slice(0, C));

  // Rows 1–3: VU meters. Bottom row cyan, middle purple, top pink; unlit glass behind.
  const per = t.fine ? 8 : 2;
  const STEP = t.fine ? ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] : ['', '▄', '█'];
  const ZONES = [HEX.cyan, HEX.purple, HEX.pink];
  const rackRow = (k) => {   // k = 0 bottom … 2 top
    let out = gap(1);
    for (const m of meters) {
      const lit = m.p == null ? 0 : m.p > 0 ? Math.max(1, Math.round((clamp(m.p, 0, 100) / 100) * per * 3)) : 0;
      const v = clamp(lit - k * per, 0, per);
      // Critical meters strobe their top (pink) zone only, so the zones stay readable.
      const strobe = k === 2 && m.p != null && severity(m.p, m.th) === 2 && t.tick % 2;
      const fg = strobe ? HEX.hot : ZONES[k];
      out = join(out, Array.from({ length: 3 }, () => ({ ch: v ? STEP[v] : ' ', fg, bg: HEX.unlit })), gap(2));
    }
    return out;
  };

  // Row 1 · ► NOW PLAYING ◆ MODEL ▸▸▹▹▹ EFFORT FAST … cost
  const cost = costCells(d) || [];
  const playing = (label) => [seg(join(cells('►', HEX.pink), label && cells(' NOW PLAYING', HEX.dim))),
    seg(cells(`◆ ${d.model.name}`, d.model.color, null, true)),
    seg(d.effort && join(effortMeter(d), effortMeter(d) && gap(1), effortLabel(d))),
    seg(d.fast && cells('FAST', HEX.yellow, null, true), 1)].filter(Boolean);
  const room = C - cost.length - 2;
  const wide = playing(true);
  const play = row(wide.reduce((n, s) => n + s.cells.length + 2, -2) <= room ? wide : playing(false), room, 2);
  const r1 = spread(play, cost, C);
  // Row 2 · git, time, diff, tags
  const r2 = fill(row([seg(gitCells(d)), seg(timeCells(d)), seg(diffCells(d), 2), seg(tagCells(d), 3)], C, 3), C);
  // Row 3 · readouts that name the meters
  const readouts = [];
  if (d.ctx != null) readouts.push(seg(join(cells('CTX', HEX.purple), pct(d.ctx, WARN.ctx, t.tick))));
  for (const l of d.limits) {
    readouts.push(seg(join(cells(l.label, HEX.cyan), pct(l.pct, WARN.limit, t.tick), l.reset && cells(` ${l.reset}`, HEX.dim))));
  }
  const r3 = fill(row(readouts, C, 3), C);

  // Row 4 · disco floor: ▀ tiles with two colours each, swapping on every beat; lit under Clawd.
  // Asleep: no spotlight and the tiles hold still.
  const TILE = [HEX.pink, HEX.purple, HEX.cyan];
  const phase = t.asleep ? 0 : t.tick;
  const floor = [];
  for (let x = 0; x < F; x++) {
    const tile = Math.floor(x / 2);
    const spot = !t.asleep && L.col != null && x >= L.col - 1 && x <= L.col + CLAWD_W;
    const k = spot ? 0.95 : 0.3;
    const a = shade(TILE[(tile + phase) % 3], k);
    const b = shade(TILE[(tile + phase + 1) % 3], k * 0.75);
    const flip = (tile + phase) % 2 === 1;
    floor.push({ ch: '▀', fg: flip ? b : a, bg: flip ? a : b });
  }

  return [top, join(rackRow(2), r1), join(rackRow(1), r2), join(rackRow(0), r3), floor];
}

function render(data, o) {
  const tick = Math.floor(o.now / 1000);
  const frame = Number.isFinite(o.frame) ? ((o.frame % CLAWD.length) + CLAWD.length) % CLAWD.length : tick % CLAWD.length;
  const pen = makePen(o.noColor);
  const L = layout(o.cols);
  const asleep = data._status != null && data._status !== 'busy';
  const lines = club(read(data, o.now), L, { tick, frame, fine: true, asleep }).map((l) => emit(l, pen));
  return withMascot(lines, L.col, frame, pen, asleep).join('\n');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const ws = data.workspace || {};
    if (!data._git) data._git = gitInfo(ws.current_dir || data.cwd || process.cwd());   // tests may pin _git
    if (data._status === undefined) data._status = sessionStatus(data.session_id);       // and _status
    const forcedNow = parseInt(process.env.STATUSLINE_NOW, 10);
    process.stdout.write(render(data, {
      cols: parseInt(process.env.COLUMNS, 10),
      now: Number.isFinite(forcedNow) ? forcedNow : Date.now(),
      frame: parseInt(process.env.CLAWD_FRAME, 10),
      noColor: !!process.env.NO_COLOR,
    }));
  } catch (e) {
    process.stdout.write('statusline error');
  }
});
