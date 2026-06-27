#!/usr/bin/env node
'use strict';
/*
 * merge-settings.js — deep-merge a snapshot settings.json INTO an existing one.
 *
 *   node merge-settings.js <snapshot.json> <target.json>
 *
 * Used by setup.ps1 / setup.sh so "update my system" applies the curated config
 * without clobbering machine-local keys (notably permissions.allow).
 *
 * Merge rules:
 *   - objects  -> recurse key-by-key
 *   - arrays   -> union, de-duplicated by JSON value (preserves local entries,
 *                 adds snapshot entries once -> idempotent on re-runs)
 *   - scalars  -> snapshot wins (keeps curated values, e.g. effortLevel)
 * Local-only keys absent from the snapshot are preserved.
 */

const fs = require('fs');

const [, , snapPath, dstPath] = process.argv;
if (!snapPath || !dstPath) {
  console.error('usage: node merge-settings.js <snapshot.json> <target.json>');
  process.exit(2);
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_) { return fallback; }
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, over) {
  if (Array.isArray(base) && Array.isArray(over)) {
    const seen = new Set(base.map((x) => JSON.stringify(x)));
    const out = base.slice();
    for (const x of over) {
      const k = JSON.stringify(x);
      if (!seen.has(k)) { seen.add(k); out.push(x); }
    }
    return out;
  }
  if (isObject(base) && isObject(over)) {
    const out = Object.assign({}, base);
    for (const key of Object.keys(over)) {
      out[key] = (key in base) ? merge(base[key], over[key]) : over[key];
    }
    return out;
  }
  return over; // scalar (or type mismatch): snapshot wins
}

const snapshot = readJson(snapPath, null);
if (snapshot === null) {
  console.error('merge-settings: cannot read snapshot ' + snapPath);
  process.exit(1);
}
const target = readJson(dstPath, {});

const merged = merge(target, snapshot);
fs.writeFileSync(dstPath, JSON.stringify(merged, null, 2) + '\n');
