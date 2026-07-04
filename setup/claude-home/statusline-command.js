#!/usr/bin/env node

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// Read one JSON file from disk; return null on any error.
function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw);
  } catch (_) { return null; }
}

// Walk the four-file settings cascade and return the first effortLevel found.
function resolveEffortLevel(cwd) {
  try {
    const home = os.homedir();
    const files = [
      path.join(cwd,  '.claude', 'settings.local.json'),
      path.join(cwd,  '.claude', 'settings.json'),
      path.join(home, '.claude', 'settings.local.json'),
      path.join(home, '.claude', 'settings.json'),
    ];
    for (const f of files) {
      const data = readJson(f);
      if (data && typeof data === 'object' && 'effortLevel' in data) {
        return data.effortLevel;
      }
    }
  } catch (_) { /* intentional */ }
  return null;
}

// Abbreviate effort for display: medium→med, others unchanged.
function effortAbbrev(e) {
  const s = String(e || '').toLowerCase();
  if (s === 'medium') return 'med';
  return s || null;
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const ANSI = {
    reset:   '\x1b[0m',
    dim:     '\x1b[2;90m',
    cyan:    '\x1b[36m',
    magenta: '\x1b[35m',
    yellow:  '\x1b[33m',
    red:     '\x1b[31m',
    green:   '\x1b[32m',
  };

  const paint = (color, text) => `${color}${text}${ANSI.reset}`;

  const formatTokens = (n) => {
    if (!Number.isFinite(n) || n < 0) return '--';
    if (n < 1000) return `${n}`;
    if (n < 100_000) {
      const v = (n / 1000).toFixed(1);
      return `${v.endsWith('.0') ? v.slice(0, -2) : v}k`;
    }
    if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
  };

  try {
    const data = JSON.parse(input);

    const cwd = (data.workspace && data.workspace.current_dir) || data.cwd || process.cwd();
    const model = (data.model && data.model.display_name)
      || (data.model && data.model.id)
      || data.display_name
      || data.id
      || '--';

    const ctx = data.context_window || {};
    const cu = ctx.current_usage;
    let tokens = null;
    if (cu) {
      tokens = (cu.input_tokens || 0)
        + (cu.output_tokens || 0)
        + (cu.cache_creation_input_tokens || 0)
        + (cu.cache_read_input_tokens || 0);
    } else if (ctx.used_percentage != null && ctx.context_window_size) {
      tokens = Math.round(ctx.context_window_size * ctx.used_percentage / 100);
    }
    const tokenStr = tokens == null ? '--' : formatTokens(tokens);

    const sid = data.session_id || '--';
    const sep = paint(ANSI.dim, ' · ');

    // Resolve effort and build optional suffix next to the model.
    let modelSegment = `🤖 ${paint(ANSI.magenta, model)}`;
    try {
      const effortLevel = resolveEffortLevel(cwd);
      const abbrev = effortAbbrev(effortLevel);
      if (abbrev) {
        const isFable = String(model).toLowerCase().includes('fable');
        const effortLow = String(effortLevel || '').toLowerCase();
        let effortStr;
        if (isFable && (effortLow === 'high' || effortLow === 'xhigh')) {
          // High-effort Fable: colour the abbreviation (yellow for high, red for xhigh).
          const effortColor = effortLow === 'xhigh' ? ANSI.red : ANSI.yellow;
          effortStr = paint(ANSI.dim, ' · ') + paint(effortColor, abbrev);
        } else {
          effortStr = paint(ANSI.dim, ' · ') + paint(ANSI.dim, abbrev);
        }
        modelSegment += effortStr;
      }
    } catch (_) { /* if effort resolution fails, render model as-is */ }

    // Cost segment — only when data.cost.total_cost_usd is a finite number.
    let costSegment = null;
    try {
      const totalCost = data.cost && data.cost.total_cost_usd;
      if (Number.isFinite(totalCost)) {
        const costColor = totalCost < 5 ? ANSI.green : totalCost < 20 ? ANSI.yellow : ANSI.red;
        costSegment = `💰 ${paint(costColor, `$${totalCost.toFixed(2)}`)}`;
      }
    } catch (_) { /* cost resolution failure is non-fatal */ }

    const segments = [
      `📂 ${paint(ANSI.cyan, cwd)}`,
      modelSegment,
      `🧠 ${paint(ANSI.yellow, tokenStr)}`,
    ];
    if (costSegment !== null) segments.push(costSegment);
    segments.push(paint(ANSI.dim, `#${sid}`));

    process.stdout.write(segments.join(sep));
  } catch (e) {
    process.stdout.write('statusline error');
  }
});
