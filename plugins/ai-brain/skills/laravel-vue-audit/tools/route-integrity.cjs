#!/usr/bin/env node
/**
 * Checks that route actions resolve to controller methods that exist in source.
 * Read-only, dependency-free. Output is a CANDIDATE list: "missing" still needs a hunter
 * to rule out macros, vendor parents, and __call before it becomes a finding.
 *
 * Usage: node route-integrity.cjs <target-root> [route-list.json]
 *   route-list.json = output of `php artisan route:list --json` (preferred; resource routes expanded).
 *   Without it, routes/*.php are parsed best-effort (array syntax, resource/apiResource, controller groups).
 */
const fs = require("fs");
const path = require("path");

const target = process.argv[2];
const routeJson = process.argv[3];
if (!target) {
  console.error("Usage: node route-integrity.cjs <target-root> [route-list.json]");
  process.exit(1);
}
const rel = (p) => path.relative(target, p).split(path.sep).join("/");

// PSR-4 map from composer.json (App\ -> app/ etc.)
const composer = JSON.parse(fs.readFileSync(path.join(target, "composer.json"), "utf8"));
const psr4 = Object.entries({ ...(composer.autoload && composer.autoload["psr-4"]) }).map(([ns, dir]) => [ns, Array.isArray(dir) ? dir[0] : dir]);

// Vendor PSR-4 map (read-only) so framework parents/traits can be checked too.
const vendorPsr4 = [];
const autoloadPsr4 = path.join(target, "vendor", "composer", "autoload_psr4.php");
if (fs.existsSync(autoloadPsr4)) {
  for (const m of fs.readFileSync(autoloadPsr4, "utf8").matchAll(/'((?:[^'\\]|\\.)+)'\s*=>\s*array\(([^)]*)\)/g)) {
    const ns = m[1].replace(/\\\\/g, "\\");
    for (const d of m[2].matchAll(/\$(vendorDir|baseDir)\s*\.\s*'([^']+)'/g)) {
      vendorPsr4.push([ns, d[1] === "vendorDir" ? path.join(target, "vendor", d[2]) : path.join(target, d[2])]);
    }
  }
}
const roots = [...psr4.map(([ns, dir]) => [ns, path.join(target, dir)]), ...vendorPsr4].sort((a, b) => b[0].length - a[0].length);

function classFile(fqcn) {
  const name = fqcn.replace(/^\\/, "");
  for (const [ns, dir] of roots) {
    if (name.startsWith(ns)) {
      const file = path.join(dir, name.slice(ns.length).split("\\").join("/") + ".php");
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}
const isAppClass = (fqcn) => psr4.some(([ns]) => fqcn.replace(/^\\/, "").startsWith(ns));

const sourceCache = new Map();
function source(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, stripPhpComments(fs.readFileSync(file, "utf8")));
  return sourceCache.get(file);
}

// String-aware comment stripper (docblock examples like "class X extends Controller" must not count;
// '//' inside 'https://...' strings must survive). Newlines are kept so line numbers stay valid.
function stripPhpComments(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const start = i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      out += src.slice(start, i + 1);
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else if ((c === "/" && src[i + 1] === "/") || (c === "#" && src[i + 1] !== "[")) {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else {
      out += c;
    }
  }
  return out;
}

function imports(src) {
  const map = {};
  const nsMatch = /^namespace\s+([^;]+);/m.exec(src);
  for (const m of src.matchAll(/^use\s+([^;{]+?)(?:\s+as\s+(\w+))?;/gm)) map[m[2] || m[1].split("\\").pop()] = m[1].trim();
  return { map, ns: nsMatch ? nsMatch[1].trim() : "" };
}

function resolveName(name, src) {
  if (name.startsWith("\\")) return name.slice(1);
  const { map, ns } = imports(src);
  const head = name.split("\\")[0];
  if (map[head]) return map[head] + name.slice(head.length);
  return ns ? `${ns}\\${name}` : name;
}

// Does class `fqcn` (or its traits/parents inside the app) declare `method`?
// Returns { status: "found"|"missing"|"unresolved", where?, reason? }
function hasMethod(fqcn, method, seen = new Set()) {
  if (seen.has(fqcn)) return { status: "missing" };
  seen.add(fqcn);
  const file = classFile(fqcn);
  if (!file) return { status: "unresolved", reason: `class ${fqcn} not found in PSR-4 source (vendor or missing)` };
  const src = source(file);
  const fnRe = new RegExp(`^[ \\t]*(?:(?:public|protected|private|static|final|abstract)\\s+)*function\\s+&?${method}\\s*\\(`, "im");
  if (fnRe.test(src)) {
    const line = src.slice(0, src.search(fnRe)).split("\n").length;
    return { status: "found", where: `${rel(file)}` , line };
  }
  // Illuminate\Routing\Controller::__call only throws BadMethodCallException; it is not a dispatcher.
  const baseController = /Illuminate[\\/]Routing[\\/]Controller\.php$/.test(file);
  if (!baseController && /^[ \t]*(?:public\s+)?function\s+__call\s*\(/m.test(src)) return { status: "unresolved", reason: `${rel(file)} defines __call` };
  const classBody = src.slice(src.search(/\b(class|trait)\s+\w+/));
  const traitUses = [...classBody.matchAll(/^\s*use\s+([\w\\,\s]+?)\s*(?:;|\{)/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
  for (const t of traitUses) {
    const r = hasMethod(resolveName(t, src), method, seen);
    if (r.status !== "missing") return r.status === "unresolved" ? { ...r, reason: `via trait ${t}: ${r.reason}` } : r;
  }
  const ext = /\bclass\s+\w+\s+extends\s+([\w\\]+)/.exec(src);
  if (ext) {
    const parent = resolveName(ext[1], src);
    const r = hasMethod(parent, method, seen);
    return r;
  }
  return { status: "missing", file: rel(file) };
}

const RESOURCE = ["index", "create", "store", "show", "edit", "update", "destroy"];
const API_RESOURCE = ["index", "store", "show", "update", "destroy"];

// RouteServiceProvider::$namespace (L≤10 apps) prefixes string controller references.
const rsp = path.join(target, "app", "Providers", "RouteServiceProvider.php");
const legacyNamespace = (fs.existsSync(rsp) && (/protected\s+\$namespace\s*=\s*'([^']+)'/.exec(fs.readFileSync(rsp, "utf8")) || [])[1]) || "App\\Http\\Controllers";

function routesFromFiles() {
  const routesDir = path.join(target, "routes");
  const out = [];
  const files = fs.readdirSync(routesDir, { recursive: true }).filter((f) => String(f).endsWith(".php")).map((f) => path.join(routesDir, String(f)));
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const src = stripPhpComments(raw);
    const lineOf = (idx) => src.slice(0, idx).split("\n").length;
    for (const m of src.matchAll(/\[\s*([\w\\]+)::class\s*,\s*['"](\w+)['"]\s*\]/g)) {
      out.push({ action: `${resolveName(m[1], src)}@${m[2]}`, file: rel(file), line: lineOf(m.index), source: "array" });
    }
    // Legacy string syntax (L≤7 style, still common on L10 with RouteServiceProvider::$namespace):
    // 'Controller@method' or '\App\Http\Controllers\X@method'
    for (const m of src.matchAll(/['"](\\?[A-Z][\w\\]*)@(\w+)['"]/g)) {
      const cls = m[1].startsWith("\\") ? m[1].slice(1) : `${legacyNamespace}\\${m[1]}`;
      out.push({ action: `${cls}@${m[2]}`, file: rel(file), line: lineOf(m.index), source: "string" });
    }
    for (const m of src.matchAll(/Route::(resource|apiResource)\(\s*['"]([^'"]+)['"]\s*,\s*(?:([\w\\]+)::class|['"]([\w\\]+)['"])\s*\)([^;]*)/g)) {
      const [, kind, uri, classRef, stringRef, chain] = m;
      const ctrl = classRef ? resolveName(classRef, src) : stringRef.startsWith("\\") ? stringRef.slice(1) : `${legacyNamespace}\\${stringRef}`;
      let methods = kind === "resource" ? RESOURCE : API_RESOURCE;
      // ->only([...]) / ->except([...]) or a single string ->except('show')
      const only = /->only\(\s*(\[[^\]]*\]|['"]\w+['"])/.exec(chain);
      const except = /->except\(\s*(\[[^\]]*\]|['"]\w+['"])/.exec(chain);
      const list = (s) => [...s.matchAll(/['"](\w+)['"]/g)].map((x) => x[1]);
      if (only) methods = methods.filter((x) => list(only[1]).includes(x));
      if (except) methods = methods.filter((x) => !list(except[1]).includes(x));
      for (const meth of methods) out.push({ action: `${ctrl}@${meth}`, file: rel(file), line: lineOf(m.index), source: kind, uri });
    }
    for (const m of src.matchAll(/Route::(?:[\w]+\([^)]*\)->)*controller\(\s*([\w\\]+)::class\s*\)/g)) {
      // Controller group: Route::controller(X::class)->group(function () { Route::get('/a', 'method'); })
      const start = src.indexOf("{", m.index);
      let depth = 0, end = start;
      for (let i = start; i < src.length && start >= 0; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) { end = i; break; }
      }
      const body = src.slice(start, end);
      for (const r of body.matchAll(/Route::\w+\(\s*['"][^'"]*['"]\s*,\s*['"](\w+)['"]\s*\)/g)) {
        out.push({ action: `${resolveName(m[1], src)}@${r[1]}`, file: rel(file), line: lineOf(start + r.index), source: "controller-group" });
      }
    }
    for (const m of src.matchAll(/Route::(?:get|post|put|patch|delete|options|any)\(\s*['"][^'"]*['"]\s*,\s*([\w\\]+)::class\s*\)/g)) {
      out.push({ action: `${resolveName(m[1], src)}@__invoke`, file: rel(file), line: lineOf(m.index), source: "invokable" });
    }
  }
  return out;
}

function routesFromJson(file) {
  const list = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  return list.map((r) => {
    let action = r.action;
    if (action && !action.includes("@") && action !== "Closure" && /\\/.test(action)) action = `${action}@__invoke`;
    return { action, name: r.name || null, uri: r.uri, methods: r.method, source: "route:list" };
  });
}

const routes = routeJson ? routesFromJson(routeJson) : routesFromFiles();
const result = { mode: routeJson ? "route:list" : "parsed", checked: 0, closures: 0, vendor: 0, missing: [], unresolved: [] };
const seenActions = new Map();
for (const r of routes) {
  if (!r.action || r.action === "Closure") { result.closures++; continue; }
  const [cls, method] = r.action.split("@");
  if (!isAppClass(cls)) { result.vendor++; continue; }
  result.checked++;
  if (!seenActions.has(r.action)) seenActions.set(r.action, hasMethod(cls, method));
  const res = seenActions.get(r.action);
  if (res.status === "missing") result.missing.push({ ...r, controller_file: classFile(cls) ? rel(classFile(cls)) : null });
  else if (res.status === "unresolved") result.unresolved.push({ ...r, reason: res.reason });
}
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
