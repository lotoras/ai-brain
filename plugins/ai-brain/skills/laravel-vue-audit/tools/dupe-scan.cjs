#!/usr/bin/env node
/**
 * Token-window clone detector for PHP / Blade / Vue / JS / TS (a dependency-free jscpd fallback).
 * Read-only. Output clone pairs are CANDIDATES: a hunter must read both copies (DUPLICATION.md).
 *
 * Usage: node dupe-scan.cjs <target-root> [--min-tokens 70] [--paths app,resources/js] [--include-tests]
 *                           [--normalize-ids] [--max 200] [--include-vendored]
 *   --normalize-ids  also normalize identifiers (Type-2 clones: same shape, renamed variables/methods).
 *                    Noisier; use for semantic-clone hunting, not for the default pass.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const target = argv[0];
const opt = (name, def) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : def);
if (!target) {
  console.error("Usage: node dupe-scan.cjs <target-root> [--min-tokens 70] [--paths a,b] [--include-tests] [--normalize-ids] [--max 200]");
  process.exit(1);
}
const MIN = Number(opt("--min-tokens", 70));
const MAX = Number(opt("--max", 200));
const NORMALIZE_IDS = argv.includes("--normalize-ids");
const INCLUDE_TESTS = argv.includes("--include-tests");
const ROOTS = opt("--paths", "app,resources/js,resources/views,routes,src").split(",").map((p) => p.trim()).filter(Boolean);
const EXT = /\.(php|vue|js|ts|jsx|tsx|mjs)$/;
const SKIP_DIR = new Set(["vendor", "node_modules", "public", "storage", "bootstrap", "dist", "build", ".git", "lang", "trash"]);
const SKIP_FILE = /\.(min|d)\.(js|ts)$|_ide_helper/;

const KEYWORDS = new Set(("abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty " +
  "enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include " +
  "instanceof insteadof interface isset list match namespace new or print private protected public readonly require return static switch " +
  "throw trait try unset use var while yield null true false self parent this await async let typeof void delete in of export import from " +
  "template script style setup props emit computed ref reactive watch v-if v-for v-else v-model").split(" "));

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name) || (!INCLUDE_TESTS && /^(tests?|__tests__)$/i.test(e.name))) continue;
      walk(path.join(dir, e.name), out);
    } else if (EXT.test(e.name) && !SKIP_FILE.test(e.name)) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

// Tokenizer: strips comments, collapses literals; tokens carry their line number.
function tokenize(src) {
  const tokens = [];
  let line = 1;
  let i = 0;
  const n = src.length;
  const push = (v) => tokens.push({ v, line });
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const s = e < 0 ? n : e + 2; line += (src.slice(i, s).match(/\n/g) || []).length; i = s; continue; }
    if (c === "<" && src.startsWith("<!--", i)) { const e = src.indexOf("-->", i + 4); const s = e < 0 ? n : e + 3; line += (src.slice(i, s).match(/\n/g) || []).length; i = s; continue; }
    if ((c === "/" && src[i + 1] === "/") || (c === "#" && src[i + 1] !== "[")) { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const start = i++;
      while (i < n && src[i] !== c) { if (src[i] === "\\") i++; if (src[i] === "\n") line++; i++; }
      i++;
      push(src.slice(start, i).length > 2 ? "S" : "S0");
      continue;
    }
    if (/[0-9]/.test(c)) { while (i < n && /[0-9._xXa-fA-F]/.test(src[i])) i++; push("N"); continue; }
    if (c === "$" && /[A-Za-z_]/.test(src[i + 1] || "")) { i++; while (i < n && /\w/.test(src[i])) i++; push("$V"); continue; }
    if (/[A-Za-z_\\]/.test(c)) {
      const start = i;
      while (i < n && /[\w\\-]/.test(src[i]) && !(src[i] === "-" && src[i + 1] === ">")) i++;
      const word = src.slice(start, i);
      push(NORMALIZE_IDS && !KEYWORDS.has(word.toLowerCase()) ? "I" : word);
      continue;
    }
    // operators / punctuation: group common multi-char operators
    const three = src.substr(i, 3);
    const two = src.substr(i, 2);
    if (["===", "!==", "<=>", "...", "??="].includes(three)) { push(three); i += 3; continue; }
    if (["->", "=>", "::", "==", "!=", "<=", ">=", "&&", "||", "??", "++", "--", "+=", "-=", "?.", "</", "/>"].includes(two)) { push(two); i += 2; continue; }
    push(c);
    i++;
  }
  return tokens;
}

const rel = (p) => path.relative(target, p).split(path.sep).join("/");
// Vendored/minified third-party files (license banners, very long lines) are not app duplication.
const INCLUDE_VENDORED = argv.includes("--include-vendored");
function isVendored(src) {
  const head = src.slice(0, 3000);
  if (/^\s*\/\*!|@license\b|Licensed under the (?:MIT|Apache)|\(c\)\s*(?:19|20)\d\d|Copyright\s*(?:\(c\)|©)?\s*(?:19|20)\d\d/im.test(head) && !/^<\?php/.test(head)) return true;
  if (/define\.amd|typeof exports === .object. && typeof module/.test(head)) return true; // UMD bundle
  const lines = src.split("\n");
  return src.length > 2000 && src.length / lines.length > 250;
}
const files = ROOTS.flatMap((r) => walk(path.join(target, r), []));
const skippedVendored = [];
const docs = files
  .map((f) => ({ f, src: fs.readFileSync(f, "utf8") }))
  .filter(({ f, src }) => INCLUDE_VENDORED || !isVendored(src) || (skippedVendored.push(rel(f)), false))
  .map(({ f, src }) => ({ file: rel(f), tokens: tokenize(src) }))
  .filter((d) => d.tokens.length >= MIN);

// Hash every MIN-token window (two 32-bit FNV-style hashes over token strings).
const ids = new Map();
const tokId = (v) => { let x = ids.get(v); if (x === undefined) { x = ids.size + 1; ids.set(v, x); } return x; };
for (const d of docs) d.ids = Int32Array.from(d.tokens, (t) => tokId(t.v));

const buckets = new Map();
const B = 1000003;
let pow = 1;
for (let k = 1; k < MIN; k++) pow = (pow * B) % 2147483647;
docs.forEach((d, di) => {
  let h = 0;
  for (let k = 0; k < d.ids.length; k++) {
    if (k >= MIN) h = (h - ((d.ids[k - MIN] * pow) % 2147483647) + 2147483647) % 2147483647;
    h = (h * B + d.ids[k]) % 2147483647;
    if (k >= MIN - 1) {
      const pos = k - MIN + 1;
      const list = buckets.get(h);
      if (list) { if (list.length < 50) list.push(di, pos); } else buckets.set(h, [di, pos]);
    }
  }
});

const covered = new Map(); // diagonal key -> [[start, end), ...] ranges in doc A already reported
const clones = [];
function equalWindow(a, ia, b, ib) {
  for (let k = 0; k < MIN; k++) if (a.ids[ia + k] !== b.ids[ib + k]) return false;
  return true;
}
for (const list of buckets.values()) {
  if (list.length < 4) continue;
  for (let x = 0; x < list.length; x += 2) {
    for (let y = x + 2; y < list.length; y += 2) {
      let [da, ia, db, ib] = [list[x], list[x + 1], list[y], list[y + 1]];
      if (da > db || (da === db && ia > ib)) [da, ia, db, ib] = [db, ib, da, ia];
      const A = docs[da], Bd = docs[db];
      if (da === db && ib < ia + MIN) continue; // overlapping self-match
      const diag = `${da}:${db}:${ib - ia}`;
      if ((covered.get(diag) || []).some(([cs, ce]) => ia >= cs && ia < ce)) continue;
      if (!equalWindow(A, ia, Bd, ib)) continue;
      // Extend backwards and forwards to the maximal match.
      let s = 0;
      while (ia - s > 0 && ib - s > 0 && A.ids[ia - s - 1] === Bd.ids[ib - s - 1] && !(da === db && ib - s - 1 < ia + MIN)) s++;
      let len = MIN;
      while (ia + len < A.ids.length && ib + len < Bd.ids.length && A.ids[ia + len] === Bd.ids[ib + len] && !(da === db && ia + len >= ib - s)) len++;
      const sa = ia - s, sb = ib - s, total = len + s;
      covered.set(diag, [...(covered.get(diag) || []), [sa, sa + total]]);
      clones.push({
        tokens: total,
        lines: A.tokens[sa + total - 1].line - A.tokens[sa].line + 1,
        a: { file: A.file, start_line: A.tokens[sa].line, end_line: A.tokens[sa + total - 1].line },
        b: { file: Bd.file, start_line: Bd.tokens[sb].line, end_line: Bd.tokens[sb + total - 1].line },
      });
    }
  }
}

// Group pairs that share a location (A-B, A-C → one group of 3).
clones.sort((p, q) => q.tokens - p.tokens);
const groups = [];
const keyOf = (loc) => `${loc.file}:${loc.start_line}`;
const groupByLoc = new Map();
for (const c of clones) {
  const g = groupByLoc.get(keyOf(c.a)) || groupByLoc.get(keyOf(c.b));
  if (g) {
    for (const loc of [c.a, c.b]) if (!g.locations.some((l) => keyOf(l) === keyOf(loc))) { g.locations.push(loc); groupByLoc.set(keyOf(loc), g); }
  } else {
    const ng = { tokens: c.tokens, lines: c.lines, locations: [c.a, c.b] };
    groups.push(ng);
    groupByLoc.set(keyOf(c.a), ng);
    groupByLoc.set(keyOf(c.b), ng);
  }
}
const totalTokens = docs.reduce((s, d) => s + d.tokens.length, 0);
process.stdout.write(JSON.stringify({
  files_scanned: docs.length,
  skipped_vendored: skippedVendored,
  tokens: totalTokens,
  min_tokens: MIN,
  normalize_ids: NORMALIZE_IDS,
  groups: groups.length,
  truncated: groups.length > MAX,
  clones: groups.slice(0, MAX),
}, null, 2) + "\n");
