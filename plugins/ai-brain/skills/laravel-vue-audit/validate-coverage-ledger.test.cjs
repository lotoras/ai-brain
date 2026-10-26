#!/usr/bin/env node
// Run: node validate-coverage-ledger.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const { validateLedger, canonicalCoverageId } = require("./validate-coverage-ledger.cjs");

const clone = (v) => JSON.parse(JSON.stringify(v));

function unit(subsystemRef, dimension, overrides = {}) {
  const u = {
    coverage_id: "",
    subsystem: subsystemRef,
    subsystem_ref: subsystemRef,
    dimension,
    companions: ["PERF-BACKEND.md"],
    starting_paths: ["app/Http/Controllers"],
    prior_status: "none",
    wave: 1,
    status: "planned",
    agent_id: null,
    reviewed_paths: [],
    checks: [],
    result_fingerprints: [],
    unresolved: [],
    ...overrides,
  };
  u.coverage_id = canonicalCoverageId(u);
  return u;
}

const check = (paths, method = "source") => ({
  agent_id: "h-payroll",
  pattern: "PERF-BACKEND.md#N+1 in loops",
  method,
  reviewed_paths: paths,
  result: "eager loads present",
});

function ledger() {
  const covered = unit("app/Http/Controllers/Payroll", "D2", {
    status: "covered", agent_id: "h-payroll",
    reviewed_paths: ["app/Http/Controllers/Payroll/PayrollController.php"],
    checks: [check(["app/Http/Controllers/Payroll/PayrollController.php"])],
  });
  const candidate = unit("app/Http/Controllers/Payroll", "D6", {
    companions: ["INTEGRITY-AND-CORRECTNESS.md"],
    status: "candidate", agent_id: "h-payroll",
    reviewed_paths: ["routes/web.php"],
    checks: [{ ...check(["routes/web.php"]), pattern: "INTEGRITY-AND-CORRECTNESS.md#Routes → missing controller methods" }],
    result_fingerprints: ["D6:missing-controller-method:WageTypeController@search"],
  });
  const na = unit("routes:api.*", "D12", { companions: ["TYPES-TESTS-A11Y-I18N.md"], status: "not_applicable", unresolved: ["API-only, no UI"] });
  const planned = unit("profile/quick/all", "D3", { companions: ["PERF-FRONTEND.md"] });
  return [covered, candidate, na, planned].sort((a, b) => (a.coverage_id < b.coverage_id ? -1 : 1));
}

const find = (l, dim) => l.find((u) => u.dimension === dim);
const expectError = (l, needle, findings) => {
  const errors = validateLedger(l, findings);
  assert.ok(errors.some((e) => e.includes(needle)), `expected ${JSON.stringify(needle)}, got:\n${errors.join("\n")}`);
};

test("valid ledger passes", () => assert.deepStrictEqual(validateLedger(ledger()), []));
test("coverage_id is deterministic and encoded", () => {
  assert.strictEqual(canonicalCoverageId({ subsystem_ref: "routes:payroll.*", dimension: "D2" }), "routes%3Apayroll.%2A::D2");
  const l = ledger();
  find(l, "D2").coverage_id = "wrong";
  expectError(l, "coverage_id: expected");
});
test("unsorted ledger fails", () => expectError(ledger().reverse(), "sorted"));
test("duplicate unit fails", () => {
  const l = ledger();
  l.splice(1, 0, clone(l[0]));
  expectError(l, "duplicate");
});
test("covered without checks fails", () => {
  const l = ledger();
  Object.assign(find(l, "D2"), { checks: [] });
  expectError(l, "requires reviewed_paths and checks");
});
test("tool-only checks cannot close a unit", () => {
  const l = ledger();
  find(l, "D2").checks[0].method = "tool";
  expectError(l, "tool hits alone");
});
test("reviewed_paths must equal union of check paths", () => {
  const l = ledger();
  find(l, "D2").reviewed_paths.push("app/Other.php");
  expectError(l, "union");
});
test("not_applicable needs a reason", () => {
  const l = ledger();
  find(l, "D12").unresolved = [];
  expectError(l, "requires a reason");
});
test("planned must have no owner", () => {
  const l = ledger();
  find(l, "D3").agent_id = "h-x";
  expectError(l, "agent_id null");
});
test("bad agent ids fail", () => {
  const l = ledger();
  find(l, "D2").agent_id = "Con";
  expectError(l, "canonical lowercase");
  const l2 = ledger();
  find(l2, "D2").agent_id = "con";
  find(l2, "D2").checks[0].agent_id = "con";
  expectError(l2, "canonical lowercase");
});
test("pattern must reference a known companion", () => {
  const l = ledger();
  find(l, "D2").checks[0].pattern = "ATTACK-CLASSES.md#Access control";
  expectError(l, "unknown companion");
});
test("fingerprint dimension must match unit", () => {
  const l = ledger();
  find(l, "D6").result_fingerprints = ["D2:n-plus-one:X"];
  expectError(l, "differs from unit dimension");
});
test("absolute reviewed paths fail", () => {
  const l = ledger();
  find(l, "D2").reviewed_paths = ["C:/x.php"];
  find(l, "D2").checks[0].reviewed_paths = ["C:/x.php"];
  expectError(l, "repository-relative");
});
test("--findings cross-check", () => {
  const record = { fingerprint: "D6:missing-controller-method:WageTypeController@search" };
  assert.deepStrictEqual(validateLedger(ledger(), [record]), []);
  expectError(ledger(), "has no record", []);
  expectError(ledger(), "not linked", [record, { fingerprint: "D2:n-plus-one:Y" }]);
});
test("unknown fields fail", () => {
  const l = ledger();
  find(l, "D2").severity = "high";
  expectError(l, "unexpected field");
});
