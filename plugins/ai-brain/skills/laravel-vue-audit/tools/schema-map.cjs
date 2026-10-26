#!/usr/bin/env node
/**
 * Replays Laravel migrations (and a squashed schema dump, if present) into a table map.
 * Read-only, dependency-free, heuristic: anything it cannot parse is listed in `warnings`.
 *
 * Usage: node schema-map.cjs <target-root> [--table <name>]
 * Output (stdout, JSON): { tables: { <name>: { columns: {<col>: {type, nullable, file}}, indexes: [...],
 *                          foreign_keys: [...], created_in, altered_in: [] } }, dropped: [], warnings: [] }
 */
const fs = require("fs");
const path = require("path");

const target = process.argv[2];
const tableFilter = process.argv.includes("--table") ? process.argv[process.argv.indexOf("--table") + 1] : null;
if (!target) {
  console.error("Usage: node schema-map.cjs <target-root> [--table <name>]");
  process.exit(1);
}

const tables = {};
const dropped = [];
const warnings = [];

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const plural = (s) => (s.endsWith("y") && !/[aeiou]y$/.test(s) ? s.slice(0, -1) + "ies" : s.endsWith("s") ? s + "es" : s + "s");

function table(name, file) {
  if (!tables[name]) tables[name] = { columns: {}, indexes: [], foreign_keys: [], created_in: null, altered_in: [] };
  if (file && tables[name].created_in !== file && !tables[name].altered_in.includes(file)) tables[name].altered_in.push(file);
  return tables[name];
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1").replace(/^\s*#[^\n]*/gm, "");
}

function args(str) {
  // Returns string literals and [...] arrays of literals found in a call's argument text.
  const out = [];
  const re = /\[([^\]]*)\]|'([^']*)'|"([^"]*)"|([A-Za-z_\\]+)::class/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[1] !== undefined) out.push([...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]));
    else if (m[4] !== undefined) out.push({ cls: m[4].split("\\").pop() });
    else out.push(m[2] ?? m[3]);
  }
  return out;
}

const COLUMN_TYPES = new Set([
  "bigIncrements", "bigInteger", "binary", "boolean", "char", "date", "dateTime", "dateTimeTz", "decimal", "double",
  "enum", "float", "foreignId", "foreignUlid", "foreignUuid", "geometry", "increments", "integer", "ipAddress", "json",
  "jsonb", "longText", "macAddress", "mediumIncrements", "mediumInteger", "mediumText", "set", "smallIncrements",
  "smallInteger", "string", "text", "time", "timeTz", "timestamp", "timestampTz", "tinyIncrements", "tinyInteger",
  "tinyText", "unsignedBigInteger", "unsignedDecimal", "unsignedInteger", "unsignedMediumInteger",
  "unsignedSmallInteger", "unsignedTinyInteger", "ulid", "uuid", "year", "vector",
]);

const SPECIAL = ["id", "timestamps", "timestampsTz", "nullableTimestamps", "softDeletes", "softDeletesTz", "rememberToken",
  "morphs", "nullableMorphs", "uuidMorphs", "nullableUuidMorphs", "ulidMorphs", "nullableUlidMorphs", "foreignIdFor", "index", "unique",
  "primary", "fullText", "spatialIndex", "foreign", "dropColumn", "dropColumns", "dropTimestamps", "dropSoftDeletes", "dropMorphs",
  "renameColumn", "dropIndex", "dropUnique", "dropPrimary", "dropFullText", "dropForeign", "dropConstrainedForeignId", "dropForeignIdFor"];
const CANONICAL = new Map([...COLUMN_TYPES, ...SPECIAL].map((m) => [m.toLowerCase(), m]));

function addColumn(t, name, type, stmt, file) {
  const nullable = /->nullable\(\s*\)/.test(stmt) || /->nullable\(\s*true\s*\)/.test(stmt);
  const change = /->change\(\s*\)/.test(stmt);
  const prev = t.columns[name];
  t.columns[name] = { type, nullable, file, ...(change && prev ? { changed_from: prev.type } : {}) };
  if (/->unique\(\s*\)/.test(stmt)) t.indexes.push({ columns: [name], unique: true, file });
  else if (/->index\(\s*\)/.test(stmt)) t.indexes.push({ columns: [name], unique: false, file });
  if (/->primary\(\s*\)/.test(stmt)) t.indexes.push({ columns: [name], unique: true, primary: true, file });
  const constrained = /->constrained\(([^)]*)\)/.exec(stmt);
  if (constrained) {
    const a = args(constrained[1]);
    const refTable = typeof a[0] === "string" ? a[0] : plural(name.replace(/_id$/, ""));
    const onDelete = /cascadeOnDelete\(\)/.test(stmt) ? "cascade" : /nullOnDelete\(\)/.test(stmt) ? "set null" : /restrictOnDelete\(\)/.test(stmt) ? "restrict" : (/->onDelete\(\s*'([^']+)'/.exec(stmt) || [])[1] || null;
    t.foreign_keys.push({ column: name, references: "id", on: refTable, onDelete, file });
    t.indexes.push({ columns: [name], unique: false, implicit: "fk", file });
  }
}

function applyStatement(t, stmt, file, tableName) {
  const first = /^\s*\$table->(\w+)\(([^)]*(?:\([^)]*\)[^)]*)*)\)/.exec(stmt);
  if (!first) return;
  const [, rawMethod, rawArgs] = first;
  // PHP method names are case-insensitive ($table->String('x') is valid).
  const method = CANONICAL.get(rawMethod.toLowerCase()) || rawMethod;
  const a = args(rawArgs);
  const col = typeof a[0] === "string" ? a[0] : null;
  switch (method) {
    case "id": addColumn(t, col || "id", "bigIncrements", stmt + "->primary()", file); return;
    case "timestamps": case "timestampsTz": case "nullableTimestamps":
      addColumn(t, "created_at", "timestamp", "->nullable()", file); addColumn(t, "updated_at", "timestamp", "->nullable()", file); return;
    case "softDeletes": case "softDeletesTz": addColumn(t, col || "deleted_at", "timestamp", "->nullable()", file); return;
    case "rememberToken": addColumn(t, "remember_token", "string", "->nullable()", file); return;
    case "morphs": case "nullableMorphs": case "uuidMorphs": case "nullableUuidMorphs": case "ulidMorphs": case "nullableUlidMorphs":
      if (!col) break;
      addColumn(t, `${col}_id`, /uuid/i.test(method) ? "uuid" : /ulid/i.test(method) ? "ulid" : "unsignedBigInteger", method.startsWith("nullable") ? "->nullable()" : "", file);
      addColumn(t, `${col}_type`, "string", method.startsWith("nullable") ? "->nullable()" : "", file);
      t.indexes.push({ columns: [`${col}_type`, `${col}_id`], unique: false, file });
      return;
    case "foreignIdFor": {
      const cls = a[0] && a[0].cls;
      const name = typeof a[1] === "string" ? a[1] : cls ? `${snake(cls)}_id` : null;
      if (!name) break;
      const s = stmt.replace(/->constrained\(\s*\)/, `->constrained('${cls ? plural(snake(cls)) : ""}')`);
      addColumn(t, name, "foreignId", s, file);
      return;
    }
    case "index": case "unique": case "primary": case "fullText": case "spatialIndex": {
      const cols = Array.isArray(a[0]) ? a[0] : col ? [col] : [];
      if (cols.length) t.indexes.push({ columns: cols, unique: method !== "index" && method !== "fullText" && method !== "spatialIndex", ...(method === "primary" ? { primary: true } : {}), ...(method === "fullText" ? { fulltext: true } : {}), file });
      return;
    }
    case "foreign": {
      const cols = Array.isArray(a[0]) ? a[0] : [col];
      const ref = /->references\(\s*'([^']+)'\s*\)\s*->on\(\s*'([^']+)'/.exec(stmt) || /->on\(\s*'([^']+)'\s*\)\s*->references\(\s*'([^']+)'/.exec(stmt);
      const onDelete = (/->onDelete\(\s*'([^']+)'/.exec(stmt) || [])[1] || (/cascadeOnDelete\(\)/.test(stmt) ? "cascade" : /nullOnDelete\(\)/.test(stmt) ? "set null" : null);
      for (const c of cols) t.foreign_keys.push({ column: c, references: ref ? (stmt.indexOf("->references") < stmt.indexOf("->on(") ? ref[1] : ref[2]) : null, on: ref ? (stmt.indexOf("->references") < stmt.indexOf("->on(") ? ref[2] : ref[1]) : null, onDelete, file });
      return;
    }
    case "dropColumn": case "dropColumns": {
      const cols = a.flat().filter((x) => typeof x === "string");
      for (const c of cols) delete t.columns[c];
      t.indexes = t.indexes.filter((i) => !i.columns.some((c) => cols.includes(c)));
      return;
    }
    case "dropTimestamps": delete t.columns.created_at; delete t.columns.updated_at; return;
    case "dropSoftDeletes": delete t.columns.deleted_at; return;
    case "dropMorphs": if (col) { delete t.columns[`${col}_id`]; delete t.columns[`${col}_type`]; } return;
    case "renameColumn": {
      const [from, to] = a;
      if (typeof from === "string" && typeof to === "string" && t.columns[from]) {
        t.columns[to] = { ...t.columns[from], file, renamed_from: from };
        delete t.columns[from];
        for (const i of t.indexes) i.columns = i.columns.map((c) => (c === from ? to : c));
      }
      return;
    }
    case "dropIndex": case "dropUnique": case "dropPrimary": case "dropFullText": {
      if (Array.isArray(a[0])) t.indexes = t.indexes.filter((i) => i.columns.join(",") !== a[0].join(","));
      else if (col) {
        const before = t.indexes.length;
        t.indexes = t.indexes.filter((i) => `${tableName}_${i.columns.join("_")}_${method === "dropUnique" ? "unique" : method === "dropPrimary" ? "primary" : "index"}` !== col);
        if (before === t.indexes.length) warnings.push({ file, message: `could not resolve ${method}('${col}') on ${tableName}` });
      }
      return;
    }
    case "dropForeign": {
      const c = Array.isArray(a[0]) ? a[0][0] : col && col.replace(new RegExp(`^${tableName}_`), "").replace(/_foreign$/, "");
      t.foreign_keys = t.foreign_keys.filter((f) => f.column !== c);
      return;
    }
    case "dropConstrainedForeignId": case "dropForeignIdFor":
      if (col) { delete t.columns[col]; t.foreign_keys = t.foreign_keys.filter((f) => f.column !== col); }
      return;
    default:
      if (COLUMN_TYPES.has(method) && col) { addColumn(t, col, method, stmt, file); return; }
      if (/^(engine|charset|collation|comment|temporary)$/.test(method)) return;
  }
  warnings.push({ file, message: `unparsed $table->${method}(...) on ${tableName}` });
}

function upSection(src) {
  const up = src.search(/function\s+up\s*\(/);
  if (up < 0) return src;
  const down = src.search(/function\s+down\s*\(/);
  return down > up ? src.slice(up, down) : src.slice(up);
}

function parseMigration(file, rel) {
  const src = upSection(stripComments(fs.readFileSync(file, "utf8")));
  const re = /Schema::(?:connection\([^)]*\)->)?(create|table|rename|drop|dropIfExists|dropColumns)\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/g;
  let m;
  let found = false;
  while ((m = re.exec(src))) {
    found = true;
    const [, op, name, second] = m;
    if (op === "rename") {
      if (tables[name]) { tables[second] = tables[name]; delete tables[name]; table(second, rel); }
      continue;
    }
    if (op === "drop" || op === "dropIfExists") {
      if (tables[name]) { delete tables[name]; dropped.push({ table: name, file: rel }); }
      continue;
    }
    const t = table(name, op === "create" ? null : rel);
    if (op === "create") t.created_in = rel;
    // Body: from the closure's "{" to its matching "}".
    const open = src.indexOf("{", m.index);
    if (open < 0) continue;
    let depth = 0, end = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) { end = i; break; }
    }
    const body = src.slice(open + 1, end);
    for (const stmt of body.split(/;\s*(?:\n|$)/)) {
      const s = stmt.replace(/\s+/g, " ").trim();
      if (!s) continue;
      if (s.startsWith("$table->")) applyStatement(t, s, rel, name);
      else if (/\$table->/.test(s) && /^(if|foreach)\b/.test(s)) warnings.push({ file: rel, message: `conditional schema change on ${name}; read manually` });
    }
    re.lastIndex = end;
  }
  if (!found && /DB::(statement|unprepared)\(/.test(src)) warnings.push({ file: rel, message: "raw SQL migration; read manually" });
}

function parseDump(file, rel) {
  const sql = fs.readFileSync(file, "utf8");
  for (const m of sql.matchAll(/CREATE TABLE [`"]?(\w+)[`"]?\s*\(([\s\S]*?)\)\s*(?:ENGINE|;)/gi)) {
    const t = table(m[1], null);
    t.created_in = rel;
    for (const line of m[2].split(/,\n/)) {
      const l = line.trim();
      let c;
      if ((c = /^[`"](\w+)[`"]\s+(\w+)/.exec(l))) t.columns[c[1]] = { type: c[2].toLowerCase(), nullable: !/NOT NULL/i.test(l), file: rel };
      else if ((c = /^(UNIQUE |PRIMARY )?KEY\s*(?:[`"]\w+[`"])?\s*\(([^)]+)\)/i.exec(l))) t.indexes.push({ columns: c[2].replace(/[`"]/g, "").split(/\s*,\s*/).map((x) => x.replace(/\(\d+\)$/, "")), unique: !!c[1], ...(c[1] && /PRIMARY/i.test(c[1]) ? { primary: true } : {}), file: rel });
      else if ((c = /FOREIGN KEY \([`"](\w+)[`"]\) REFERENCES [`"](\w+)[`"] \([`"](\w+)[`"]\)(?: ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION))?/i.exec(l))) t.foreign_keys.push({ column: c[1], on: c[2], references: c[3], onDelete: c[4] ? c[4].toLowerCase() : null, file: rel });
    }
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".php") ? [p] : [];
  });
}

const rel = (p) => path.relative(target, p).split(path.sep).join("/");
const schemaDir = path.join(target, "database", "schema");
if (fs.existsSync(schemaDir)) for (const f of fs.readdirSync(schemaDir).filter((f) => f.endsWith(".sql"))) parseDump(path.join(schemaDir, f), rel(path.join(schemaDir, f)));

const migrationsDir = path.join(target, "database", "migrations");
const files = walk(migrationsDir).sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
if (files.some((f) => path.dirname(f) !== migrationsDir)) warnings.push({ file: "database/migrations", message: "migrations in subdirectories: verify they are loaded (loadMigrationsFrom)" });
for (const f of files) {
  try { parseMigration(f, rel(f)); } catch (e) { warnings.push({ file: rel(f), message: `parse error: ${e.message}` }); }
}

const out = tableFilter ? { tables: { [tableFilter]: tables[tableFilter] || null }, dropped, warnings: warnings.filter((w) => w.message.includes(tableFilter)) } : { migrations: files.length, tables, dropped, warnings };
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
