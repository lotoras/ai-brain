#!/usr/bin/env node
/**
 * Static column-existence check for Eloquent chains (D6 candidates).
 * For every statement that starts a static chain on an app model (`User::where(...)->...->get([...])`,
 * `Invoice::forceCreate([...])`, `Model::query()->...`), collect literal column names used in the chain's
 * own top-level calls (closures are skipped: they target related models) and compare them with the
 * migration-derived schema (schema-map.cjs). Multi-line chains are handled (statement = up to `;`).
 *
 * Usage: node column-check.cjs <target-root> [--paths app] [--schema schema-map.json]
 * Output: JSON { checked_statements, models, misses: [{file, line, model, table, column, call}] }
 * Misses are CANDIDATES: check accessors, $appends, selectRaw aliases and JSON paths before reporting.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const argv = process.argv.slice(2);
const target = argv[0];
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
if (!target) {
  console.error("Usage: node column-check.cjs <target-root> [--paths app] [--schema schema-map.json]");
  process.exit(1);
}
const schemaFile = opt("--schema", null);
const schema = schemaFile
  ? JSON.parse(fs.readFileSync(schemaFile, "utf8"))
  : JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "schema-map.cjs"), target], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
const tables = schema.tables || {};
const rel = (p) => path.relative(target, p).split(path.sep).join("/");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  if (fs.statSync(dir).isFile()) return dir.endsWith(".php") ? [...out, dir] : out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".php")) out.push(p);
  }
  return out;
}

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
function plural(s) {
  if (/(s|x|z|ch|sh)$/.test(s)) return s + "es";
  if (/[^aeiou]y$/.test(s)) return s.slice(0, -1) + "ies";
  return s + "s";
}

// Model short name -> { table, appends, accessors }
const models = {};
for (const f of walk(path.join(target, "app", "Models"))) {
  const src = fs.readFileSync(f, "utf8");
  const cls = /\bclass\s+(\w+)\s+extends\s+([\w\\]+)/.exec(src);
  if (!cls) continue;
  const table = (/protected\s+\$table\s*=\s*['"]([^'"]+)['"]/.exec(src) || [])[1] || plural(snake(cls[1]));
  const accessors = new Set();
  for (const m of src.matchAll(/function\s+get(\w+)Attribute\s*\(/g)) accessors.add(snake(m[1]));
  for (const m of src.matchAll(/function\s+(\w+)\s*\(\s*\)\s*:\s*(?:\\?Illuminate\\Database\\Eloquent\\Casts\\)?Attribute/g)) accessors.add(snake(m[1]));
  models[cls[1]] = { table, accessors, file: rel(f) };
}

// String-aware: blank out comments, keep strings, keep newlines.
function stripComments(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const s = i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      out += src.slice(s, i + 1);
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const stop = e < 0 ? src.length : e + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else if ((c === "/" && src[i + 1] === "/") || (c === "#" && src[i + 1] !== "[")) {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else out += c;
  }
  return out;
}

// Replace closure bodies/args (function (...) use (...) { ... } and fn (...) => expr) inside a chain with blanks.
function blankClosures(stmt) {
  let s = stmt;
  for (;;) {
    const m = /\b(function\s*\([^)]*\)(?:\s*use\s*\([^)]*\))?\s*(?::\s*[\w\\?|]+\s*)?\{|fn\s*\([^)]*\)\s*(?::\s*[\w\\?|]+\s*)?=>)/.exec(s);
    if (!m) return s;
    let i = m.index + m[0].length;
    if (m[0].endsWith("{")) {
      let depth = 1;
      while (i < s.length && depth > 0) { if (s[i] === "{") depth++; else if (s[i] === "}") depth--; i++; }
    } else {
      // arrow fn: until the matching close paren / comma at depth 0
      let depth = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") { if (depth === 0) break; depth--; }
        else if (c === "," && depth === 0) break;
        i++;
      }
    }
    s = s.slice(0, m.index) + s.slice(m.index, i).replace(/[^\n]/g, " ") + s.slice(i);
  }
}

// Bodies of `function (...) use (...) {...}` closures inside a statement (relative start offsets).
function closureBodies(stmt) {
  const out = [];
  const re = /\bfunction\s*\([^)]*\)(?:\s*use\s*\([^)]*\))?\s*(?::\s*[\w\\?|]+\s*)?\{/g;
  let m;
  while ((m = re.exec(stmt))) {
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    for (; i < stmt.length && depth > 0; i++) {
      const c = stmt[i];
      if (c === "'" || c === '"') { i++; while (i < stmt.length && stmt[i] !== c) i += stmt[i] === "\\" ? 2 : 1; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    out.push({ start, text: stmt.slice(start, i - 1) });
    re.lastIndex = i; // nested closures are found by the recursive call
  }
  return out;
}

// Split into top-level statements by ';' outside strings/parens.
function statements(src) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') { i++; while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1; continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if ((c === ";" || c === "{" || c === "}") && depth === 0) { out.push({ text: src.slice(start, i), offset: start }); start = i + 1; }
  }
  return out;
}

const COLUMN_FIRST_ARG = new Set(["where", "orWhere", "whereIn", "whereNotIn", "orWhereIn", "whereNull", "whereNotNull", "orWhereNull",
  "orWhereNotNull", "whereBetween", "whereNotBetween", "whereDate", "whereMonth", "whereYear", "whereDay", "whereTime", "orderBy",
  "orderByDesc", "latest", "oldest", "groupBy", "pluck", "value", "sum", "avg", "max", "min", "increment", "decrement", "whereColumn",
  "firstWhere", "keyBy", "distinct"]);
const COLUMN_LIST = new Set(["select", "addSelect", "get", "first", "firstOrFail", "paginate", "simplePaginate", "find", "findOrFail"]);
const KEY_ARRAY = new Set(["create", "forceCreate", "update", "insert", "firstOrCreate", "updateOrCreate", "firstOrNew", "upsert", "fill", "forceFill"]);

const literal = (s) => [...s.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*)"/g)].map((m) => m[1] ?? m[2]);
function topArgs(s, openIdx) {
  // returns text inside the parentheses that start at openIdx
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "'" || s[i] === '"') { const q = s[i]; i++; while (i < s.length && s[i] !== q) i += s[i] === "\\" ? 2 : 1; continue; }
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return s.slice(openIdx + 1, i);
  }
  return s.slice(openIdx + 1);
}
function firstArg(args) {
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "'" || c === '"') { const q = c; i++; while (i < args.length && args[i] !== q) i += args[i] === "\\" ? 2 : 1; continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) return args.slice(0, i);
  }
  return args;
}
function arrayKeys(arr) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (c === "'" || c === '"') {
      const q = c, s = i; i++;
      while (i < arr.length && arr[i] !== q) i += arr[i] === "\\" ? 2 : 1;
      if (depth === 1 && /^\s*=>/.test(arr.slice(i + 1))) keys.push(arr.slice(s + 1, i));
      continue;
    }
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
  }
  return keys;
}

const misses = [];
let checked = 0;
const roots = (opt("--paths", "app")).split(",").map((p) => path.join(target, p.trim()));
for (const file of roots.flatMap((r) => walk(r))) {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const lineAt = (idx) => src.slice(0, idx).split("\n").length;
  // Recursive: closure bodies (DB::transaction(function () { ... }), ->each(fn ...) etc.) hold their own statements.
  const analyze = (text, base) => {
  for (const st of statements(text)) {
    for (const body of closureBodies(st.text)) analyze(body.text, base + st.offset + body.start);
    // Anchor at the statement head: `Model::`, `return Model::`, `$x = Model::`, `$x ??= Model::` (not a nested Model:: argument).
    const m = /^\s*(?:return\s+|\$[\w>-]+(?:\[[^\]]*\])?\s*(?:\?\?)?=\s*|yield\s+)?\\?(?:[A-Z]\w*\\)*([A-Z]\w+)::(query|where\w*|select|create|forceCreate|firstOrCreate|updateOrCreate|insert|upsert|orderBy\w*|latest|oldest|with\w*|whereHas|doesntHave|has|pluck|whereIn|whereNotNull|whereNull)\s*\(/.exec(st.text);
    if (!m || !models[m[1]]) continue;
    const model = models[m[1]];
    const table = tables[model.table];
    if (!table) continue;
    checked++;
    const chainStart = m.index + m[0].length - m[2].length - 1;
    const chain = blankClosures(st.text.slice(chainStart));
    // Stop at a chain that switches to a relation of another model: ->relation()->... is ambiguous; we keep only calls
    // before the first `->xxx()` that is not a known builder method.
    const known = new Set([...COLUMN_FIRST_ARG, ...COLUMN_LIST, ...KEY_ARRAY, "query", "with", "withCount", "withSum", "withAvg",
      "withMax", "withMin", "withExists", "without", "withTrashed", "onlyTrashed", "withoutTrashed", "whereHas", "orWhereHas",
      "whereDoesntHave", "doesntHave", "has", "whereRelation", "limit", "take", "skip", "offset", "count", "exists", "doesntExist",
      "chunk", "chunkById", "cursor", "lazy", "lazyById", "each", "toArray", "toBase", "all", "lockForUpdate", "sharedLock",
      "when", "unless", "tap", "forPage", "inRandomOrder", "reorder", "selectRaw", "whereRaw", "orderByRaw", "havingRaw",
      "groupByRaw", "join", "leftJoin", "rightJoin", "crossJoin", "having", "delete", "forceDelete", "restore", "touch",
      "whereKey", "whereKeyNot", "findMany", "sole", "firstOr", "cursorPaginate", "toSql", "dd", "dump", "whereAny", "whereAll",
      "whereJsonContains", "whereJsonLength", "whereLike", "orWhereLike", "whereNot", "orWhereNot", "map", "filter", "values",
      "keys", "unique", "sortBy", "sortByDesc", "mapWithKeys", "flatMap", "groupBy", "implode", "isEmpty", "isNotEmpty",
      "withoutGlobalScope", "withoutGlobalScopes", "withGlobalScope", "orWhereBetween", "orWhereDate", "whereNotNull",
      "updateQuietly", "saveQuietly", "make", "newQuery", "scopes", "latestOfMany", "oldestOfMany", "orWhereColumn"]);
    if (/->(join|leftJoin|rightJoin|crossJoin)\s*\(/.test(chain)) continue; // joined queries: column ownership is ambiguous
    // Aliases from selectRaw('count(*) as c'), select(DB::raw('... as x')), withCount('x as y'), withSum(..., 'col') → x_sum_col
    const aliases = new Set([...chain.matchAll(/\bas\s+[`'"]?(\w+)/gi)].map((a) => a[1]));
    for (const w of chain.matchAll(/->with(Count|Sum|Avg|Max|Min|Exists)\(\s*['"](\w+)['"](?:\s*,\s*['"](\w+)['"])?/g)) {
      aliases.add(w[3] ? `${w[2]}_${w[1].toLowerCase()}_${w[3]}` : `${w[2]}_${w[1] === "Exists" ? "exists" : "count"}`);
    }
    // Paren depth per offset (strings skipped): only top-level calls belong to this chain;
    // nested ones (`whereIn('id', collect($x)->where('kind', ...))`) operate on something else.
    const depthAt = new Int32Array(chain.length + 1);
    for (let i = 0, d = 0; i < chain.length; i++) {
      const ch = chain[i];
      if (ch === "'" || ch === '"') { const q = ch; const s = i; i++; while (i < chain.length && chain[i] !== q) i += chain[i] === "\\" ? 2 : 1; for (let k = s; k <= i && k < chain.length; k++) depthAt[k] = d; continue; }
      if (ch === "(" || ch === "[") d++;
      else if (ch === ")" || ch === "]") d--;
      depthAt[i + 1] = d;
    }
    const calls = [...chain.matchAll(/(?:^|->|::)\s*(\w+)\s*\(/g)].filter((c) => depthAt[c.index] === 0);
    for (const c of calls) {
      const name = c[1];
      if (!known.has(name)) {
        if (/^[a-z]/.test(name) && !/^(where|orWhere)[A-Z]/.test(name)) break; // local scope or relation: stop, unknown semantics
        if (/^(where|orWhere)[A-Z]/.test(name)) continue; // dynamic where / scope-like; skip
      }
      const open = c.index + c[0].length - 1;
      const args = topArgs(chain, open);
      let cols = [];
      if (COLUMN_FIRST_ARG.has(name)) {
        const a = firstArg(args).trim();
        if (/^['"]/.test(a) && literal(a).length === 1 && /^['"][^'"]*['"]$/.test(a)) cols = literal(a);
        else if (/^\[/.test(a) && name.startsWith("where")) cols = arrayKeys(a).length ? arrayKeys(a) : [];
      } else if (COLUMN_LIST.has(name)) {
        const a = (name === "find" || name === "findOrFail") ? args.split(",").slice(1).join(",") : (name === "paginate" || name === "simplePaginate") ? args.split(",").slice(1, 2).join(",") : args;
        if (/^\s*\[/.test(a) || name === "select" || name === "addSelect") cols = literal(a);
      } else if (KEY_ARRAY.has(name)) {
        const a = firstArg(args).trim();
        if (/^\[/.test(a)) cols = arrayKeys(a);
      }
      for (let col of cols) {
        col = col.trim();
        if (!col || col === "*" || /\s+as\s+/i.test(col) || /[()\s${}]/.test(col) || col.includes("->")) continue;
        let tbl = table, tname = model.table;
        if (col.includes(".")) {
          const [t, cc] = col.split(".");
          if (t !== model.table) continue;
          col = cc;
          if (col === "*") continue;
        }
        if (tbl.columns[col] || model.accessors.has(col) || aliases.has(col)) continue;
        misses.push({ file: rel(file), line: lineAt(base + st.offset + chainStart + c.index), model: m[1], table: tname, column: col, call: name });
      }
    }
  }
  };
  analyze(src, 0);
}
process.stdout.write(JSON.stringify({ checked_statements: checked, models: Object.keys(models).length, misses }, null, 2) + "\n");
