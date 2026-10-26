#!/usr/bin/env node
/**
 * Filters larastan/phpstan JSON (`--error-format=json`) down to the high-signal classes that
 * often indicate real runtime defects (D6/D7/D11 candidates), dropping generic-Model typing noise
 * such as "Access to an undefined property Illuminate\Database\Eloquent\Model::$name".
 *
 * Usage: node phpstan-signal.cjs <phpstan.json> [<target-root>]
 * Output: JSON { totals, kept, by_class: {class: count}, items: [{file, line, class, message}] }
 */
const fs = require("fs");
const path = require("path");

const [file, target] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node phpstan-signal.cjs <phpstan.json> [<target-root>]");
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));

const CLASSES = [
  ["undefined-variable", /^Undefined variable/],
  ["undefined-app-method", /Call to an undefined (?:static )?method App\\/],
  ["undefined-relation-method", /Call to an undefined method Illuminate\\Database\\Eloquent\\Relations\\\w+(?:<[^>]*>)?::(?!visible\(|active\()/],
  ["undefined-app-property", /Access to an undefined property App\\Models\\\w+::\$/],
  ["undefined-constant", /undefined constant|Class constant .* not found/i],
  ["class-not-found", /(?:Instantiated class|Class) [\w\\]+ not found|unknown class/i],
  ["wrong-arg-count", /invoked with \d+ parameters?, \d+(?:-\d+)? required/],
  ["call-on-nullable", /Cannot call method \w+\(\) on [\w\\|]*null/],
  ["call-on-string", /Cannot call method (?:format|toIso8601String|isFuture|isPast|diff\w*|add\w*|sub\w*)\(\) on string/],
  ["always-true-false", /will always evaluate to (?:true|false)|is always (?:true|false)/],
  ["unreachable", /Unreachable statement/],
];

const rel = (f) => {
  const p = target ? path.relative(target, f) : f;
  return p.split(path.sep).join("/").replace(/\\/g, "/");
};
const items = [];
const byClass = {};
let total = 0;
for (const [f, v] of Object.entries(report.files || {})) {
  for (const m of v.messages || []) {
    total++;
    const hit = CLASSES.find(([, re]) => re.test(m.message));
    if (!hit) continue;
    byClass[hit[0]] = (byClass[hit[0]] || 0) + 1;
    items.push({ file: rel(f), line: m.line, class: hit[0], message: m.message });
  }
}
process.stdout.write(JSON.stringify({ totals: { ...report.totals, scanned: total }, kept: items.length, by_class: byClass, items }, null, 2) + "\n");
