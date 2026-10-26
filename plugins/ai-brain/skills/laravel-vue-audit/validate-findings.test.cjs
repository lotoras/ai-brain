#!/usr/bin/env node
// Run: node validate-findings.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { validateDocument, expectedPriority } = require("./validate-findings.cjs");

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "report-schema.json"), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));

const confirmedD6 = {
  id: "LVA-001",
  verdict: "confirmed",
  fingerprint: "D6:missing-controller-method:WageTypeController@search",
  dimension: "D6",
  category: "missing-controller-method",
  tags: [],
  title: "Route wage-types.search points at a missing controller method",
  description: "GET /wage-types/search resolves to WageTypeController@search, which does not exist.",
  locations: [{ file: "routes/web.php", line: 3103, scope: "wage-types route group", description: "Route::get('/search', [WageTypeController::class, 'search'])" }],
  evidence: [
    { file: "app/Http/Controllers/WageTypeController.php", line: 1, description: "Controller declares index/store/update/destroy only" },
    { lookup: "rg -n \"function search\" app/Http/Controllers/WageTypeController.php app/Http/Controllers/Concerns → no match", description: "No trait or parent supplies search()" },
  ],
  root_cause: "Route added without its controller action.",
  consequence: "Any request to the route throws BadMethodCallException (HTTP 500).",
  counter_evidence_checked: ["traits used by the controller", "parent Controller class", "__call"],
  impact: { score: "critical", reason: "SearchSelect in the payroll UI calls this route" },
  likelihood: { score: "high", reason: "Used on every wage type lookup" },
  priority: "P1",
  effort: "S",
  confidence: { score: "high", reason: "Lookup is exhaustive" },
  remediation: { strategy: "Implement search() returning id/name matches, or remove the route and its caller.", regression_check: "Feature test GET route('wage-types.search', ['q' => 'x']) asserts 200 JSON." },
};

const confirmedD2 = {
  id: "LVA-002",
  verdict: "confirmed",
  fingerprint: "D2:n-plus-one:ShiftController@index",
  dimension: "D2",
  category: "n-plus-one",
  tags: [],
  title: "N+1 on shift list",
  description: "Each shift row lazy-loads employee.",
  locations: [{ file: "app/Http/Controllers/ShiftController.php", line: 40, scope: "index", description: "->map(fn ($s) => $s->employee->name)" }],
  evidence: [{ file: "app/Http/Controllers/ShiftController.php", line: 35, description: "query has no with('employee')" }],
  root_cause: "Missing eager load.",
  consequence: "One extra query per shift row on the index page.",
  counter_evidence_checked: ["$with on Shift", "preventLazyLoading"],
  scale: "shifts table: ~200 rows per page per week view",
  impact: { score: "high", reason: "visible latency" },
  likelihood: { score: "medium", reason: "weekly planners" },
  priority: "P2",
  effort: "S",
  confidence: { score: "high", reason: "traced" },
  remediation: { strategy: "with('employee:id,name')", regression_check: "query-count assertion for 1 vs 20 shifts" },
};

const confirmedD4 = {
  id: "LVA-003",
  verdict: "confirmed",
  fingerprint: "D4:duplicated-business-rule:working-days",
  dimension: "D4",
  category: "duplicated-business-rule",
  tags: ["money"],
  title: "Working-day calculation implemented twice",
  description: "Two services compute working days; one ignores holidays.",
  locations: [
    { file: "app/Services/LeaveRequestService.php", line: 120, scope: "workingDays", description: "excludes holidays" },
    { file: "app/Services/PayrollService.php", line: 88, scope: "countWorkdays", description: "does not exclude holidays" },
  ],
  evidence: [{ file: "app/Services/PayrollService.php", line: 90, description: "no Holiday lookup" }],
  root_cause: "Copy-paste drift.",
  consequence: "Leave and payroll disagree on day counts in holiday weeks.",
  counter_evidence_checked: ["shared helper"],
  extraction_target: "app/Actions/Calendar/CountWorkingDays.php",
  divergence: { verdict: "diverged", note: "Payroll copy omits holidays" },
  impact: { score: "high", reason: "wrong pay" },
  likelihood: { score: "medium", reason: "holiday weeks" },
  priority: "P2",
  effort: "M",
  confidence: { score: "high", reason: "diffed" },
  remediation: { strategy: "Extract one Action and use it in both", regression_check: "unit test across a holiday week" },
};

const needs = {
  id: "LVA-004",
  verdict: "needs_validation",
  fingerprint: "D2:missing-index:time_entries.user_id-date",
  dimension: "D2",
  category: "missing-index",
  tags: [],
  title: "Possible missing composite index on time_entries",
  description: "Queries filter by user_id and date range.",
  locations: [{ file: "app/Services/TimeService.php", line: 12, scope: "forPeriod", description: "where user_id, whereBetween date" }],
  evidence: [{ lookup: "schema-map.cjs time_entries.indexes → only primary", description: "no index found" }],
  claimed_root_cause: "No index on (user_id, date).",
  blockers: ["Production row count unknown"],
  validation_plan: { owner: "SELECT COUNT(*) FROM time_entries on prod" },
};

const rejected = {
  id: "LVA-005",
  verdict: "rejected",
  fingerprint: "D5:env-outside-config:app/Foo.php",
  dimension: "D5",
  category: "env-outside-config",
  tags: [],
  title: "env() outside config",
  description: "Claimed env() call.",
  locations: [{ file: "config/foo.php", line: 3, scope: "config", description: "env call" }],
  evidence: [{ file: "config/foo.php", line: 3, description: "inside config/ — allowed" }],
  claimed_root_cause: "env() at runtime",
  reason: "The call is inside config/, which is correct.",
};

const sorted = (records) => clone(records).sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
const valid = () => sorted([confirmedD6, confirmedD2, confirmedD4, needs, rejected]);
const errorsFor = (doc) => validateDocument(doc, schema);
const expectError = (doc, needle) => {
  const errors = errorsFor(doc);
  assert.ok(errors.some((e) => e.includes(needle)), `expected error containing ${JSON.stringify(needle)}, got:\n${errors.join("\n")}`);
};
const withRecord = (fingerprint, mutate) => {
  const doc = valid();
  mutate(doc.find((r) => r.fingerprint === fingerprint));
  return doc;
};

test("valid document passes", () => assert.deepStrictEqual(errorsFor(valid()), []));
test("empty document passes", () => assert.deepStrictEqual(errorsFor([]), []));

test("priority matrix", () => {
  assert.strictEqual(expectedPriority("critical", "high"), "P1");
  assert.strictEqual(expectedPriority("high", "high"), "P1");
  assert.strictEqual(expectedPriority("high", "medium"), "P2");
  assert.strictEqual(expectedPriority("critical", "low"), "P3");
  assert.strictEqual(expectedPriority("medium", "medium"), "P3");
  assert.strictEqual(expectedPriority("low", "medium"), "P4");
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.priority = "P1"; }), "requires P2");
});

test("unsorted fingerprints fail", () => expectError(valid().reverse(), "sorted"));
test("duplicate ids fail", () => expectError(withRecord(confirmedD2.fingerprint, (r) => { r.id = "LVA-001"; }), "duplicate"));
test("fingerprint must match dimension and category", () => {
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.dimension = "D3"; }), "must start with its dimension");
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.category = "unbounded-read"; }), "D2:unbounded-read:");
});
test("absolute or backslash paths fail", () => {
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.locations[0].file = "C:/laragon/www/x.php"; }), "repository-relative");
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.locations[0].file = "app\\X.php"; }), "repository-relative");
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.locations[0].file = "../x.php"; }), "repository-relative");
});
test("perf findings require scale", () => expectError(withRecord(confirmedD2.fingerprint, (r) => { delete r.scale; }), "scale: required"));
test("D4 requires two distinct locations, target, and divergence", () => {
  expectError(withRecord(confirmedD4.fingerprint, (r) => { r.locations = [r.locations[0]]; }), "at least 2 distinct");
  expectError(withRecord(confirmedD4.fingerprint, (r) => { delete r.extraction_target; }), "extraction_target: required");
  expectError(withRecord(confirmedD4.fingerprint, (r) => { delete r.divergence; }), "divergence: required");
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.extraction_target = "x"; }), "only for D4");
});
test("D6 requires a lookup", () => expectError(withRecord(confirmedD6.fingerprint, (r) => { r.evidence = [r.evidence[0]]; }), "require a lookup proving"));
test("evidence needs a citation or a lookup", () => {
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.evidence = [{ description: "trust me" }]; }), "file+line or a lookup");
  expectError(withRecord(confirmedD2.fingerprint, (r) => { r.evidence = [{ file: "a.php", description: "no line" }]; }), "together");
});
test("confirmed needs counter-evidence", () => expectError(withRecord(confirmedD2.fingerprint, (r) => { r.counter_evidence_checked = []; }), "at least 1"));
test("confirmed needs regression check", () => expectError(withRecord(confirmedD2.fingerprint, (r) => { delete r.remediation.regression_check; }), "regression_check"));
test("needs_validation has no priority and needs a plan", () => {
  expectError(withRecord(needs.fingerprint, (r) => { r.priority = "P1"; }), "oneOf");
  expectError(withRecord(needs.fingerprint, (r) => { r.validation_plan = {}; }), "local or owner plan");
});
test("rejected needs a reason", () => expectError(withRecord(rejected.fingerprint, (r) => { delete r.reason; }), "reason"));
test("invisible text fails", () => expectError(withRecord(confirmedD2.fingerprint, (r) => { r.title = " \u200b "; }), "visible"));
test("bad id pattern fails", () => expectError(withRecord(confirmedD2.fingerprint, (r) => { r.id = "LVA-1"; }), "pattern"));

test("CLI passes valid file and rejects symlink-free bad JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lva-"));
  const good = path.join(dir, "findings.json");
  fs.writeFileSync(good, JSON.stringify(valid()));
  const out = execFileSync(process.execPath, [path.join(__dirname, "validate-findings.cjs"), good], { encoding: "utf8" });
  assert.match(out, /PASS: 5 findings valid/);
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{not json");
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, "validate-findings.cjs"), bad], { stdio: "pipe" }));
  fs.rmSync(dir, { recursive: true, force: true });
});
test("D6 lookup is required only for absence-claim categories", () => {
  const doc = valid().map((r) => r.fingerprint === confirmedD6.fingerprint ? { ...r, evidence: [r.evidence[0]] } : r);
  expectError(doc, "absence claims");
  const wiring = clone(confirmedD6);
  Object.assign(wiring, { fingerprint: "D6:json-ld-html-escaping:_business.blade.php", category: "json-ld-html-escaping", evidence: [confirmedD6.evidence[0]] });
  const doc2 = sorted([wiring, confirmedD2]);
  assert.deepStrictEqual(errorsFor(doc2), []);
});
