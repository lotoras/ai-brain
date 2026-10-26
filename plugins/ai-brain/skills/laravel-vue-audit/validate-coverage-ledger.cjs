#!/usr/bin/env node

/**
 * Validates coverage-ledger.json (unit = subsystem x dimension).
 * Usage: node validate-coverage-ledger.cjs <coverage-ledger.json> [--findings <findings.json>]
 *
 * State-table design adapted from cloudflare/security-audit-skill (MIT, see NOTICE.md).
 */

const core = require("./lib/schema-core.cjs");

const { hasOwn, safeQuote, hasVisibleProse, isSafeRelativeSourcePath, createErrorList, LIMITS } = core;

const DIMENSIONS = new Set(["D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12"]);
const COMPANIONS = new Set([
  "PERF-BACKEND.md", "PERF-FRONTEND.md", "DUPLICATION.md", "LARAVEL-CONFORMANCE.md", "VUE-CONFORMANCE.md",
  "INTEGRITY-AND-CORRECTNESS.md", "DATA-MODEL.md", "OPS-AND-DEPS.md", "TYPES-TESTS-A11Y-I18N.md",
]);
const STATUSES = new Set(["planned", "in_progress", "covered", "candidate", "blocked", "deferred", "out_of_scope", "not_applicable"]);
const PRIOR_STATUSES = new Set([
  "none", "new", "prior_confirmed_same_source", "prior_confirmed_changed_source", "prior_needs_validation",
  "prior_deferred", "prior_blocked", "prior_covered_same_source", "prior_covered_changed_source",
]);
const REQUIRED = [
  "coverage_id", "subsystem", "subsystem_ref", "dimension", "companions", "starting_paths", "prior_status",
  "wave", "status", "agent_id", "reviewed_paths", "checks", "result_fingerprints", "unresolved",
];
const OPTIONAL = new Set(["tool_candidates", "observations", "notes", "attempts", "priority_rank"]);
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const FINGERPRINT = /^D(?:[2-9]|1[0-2]):[a-z0-9]+(?:-[a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9._:/@+-]*$/;
const PATTERN_REF = /^[A-Z0-9-]+\.md#.+$/;

function encodeRef(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalCoverageId(unit) {
  return `${encodeRef(unit.subsystem_ref)}::${unit.dimension}`;
}

function isAgentId(value) {
  return typeof value === "string" && AGENT_ID.test(value) && !WINDOWS_DEVICE.test(value);
}

function isRepoPath(value) {
  // Subsystem refs may also be route-name globs or the quick-profile identifier.
  return isSafeRelativeSourcePath(value);
}

function checkStringArray(value, where, errors, { nonEmpty = false, paths = false, visible = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${where}: expected array`);
    return;
  }
  if (nonEmpty && value.length === 0) errors.push(`${where}: must not be empty`);
  if (value.length > LIMITS.arrayItems) errors.push(`${where}: exceeds ${LIMITS.arrayItems} items`);
  const seen = new Set();
  value.forEach((item, i) => {
    if (typeof item !== "string" || item.length === 0) {
      errors.push(`${where}[${i}]: expected non-empty string`);
      return;
    }
    if (seen.has(item)) errors.push(`${where}[${i}]: duplicate ${safeQuote(item)}`);
    seen.add(item);
    if (paths && !isRepoPath(item)) errors.push(`${where}[${i}]: must be a safe repository-relative path`);
    if (visible && !hasVisibleProse(item)) errors.push(`${where}[${i}]: must contain visible text`);
  });
}

function checkChecks(unit, base, errors) {
  if (!Array.isArray(unit.checks)) {
    errors.push(`${base}.checks: expected array`);
    return;
  }
  const union = new Set();
  let sourceRead = false;
  unit.checks.forEach((check, i) => {
    const where = `${base}.checks[${i}]`;
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      errors.push(`${where}: expected object`);
      return;
    }
    for (const key of Object.keys(check)) {
      if (!["agent_id", "pattern", "method", "reviewed_paths", "result", "artifact"].includes(key)) {
        errors.push(`${where}: unexpected field ${safeQuote(key)}`);
      }
    }
    if (!isAgentId(check.agent_id)) errors.push(`${where}.agent_id: must be a canonical lowercase agent id`);
    if (typeof check.pattern !== "string" || !PATTERN_REF.test(check.pattern)) {
      errors.push(`${where}.pattern: must reference a companion catalog entry like "PERF-BACKEND.md#N+1 in loops"`);
    } else if (!COMPANIONS.has(check.pattern.split("#")[0])) {
      errors.push(`${where}.pattern: unknown companion ${safeQuote(check.pattern.split("#")[0])}`);
    }
    if (!["source", "tool", "local"].includes(check.method)) errors.push(`${where}.method: must be source|tool|local`);
    if (check.method === "source" || check.method === "local") sourceRead = true;
    if (check.method === "local" && !(typeof check.artifact === "string" && check.artifact.startsWith(`agents/${check.agent_id}/`))) {
      errors.push(`${where}.artifact: local checks need an artifact under agents/<agent_id>/`);
    }
    if (check.method !== "local" && hasOwn(check, "artifact") && check.artifact !== null) {
      errors.push(`${where}.artifact: only local checks carry an artifact`);
    }
    if (typeof check.result !== "string" || !hasVisibleProse(check.result)) errors.push(`${where}.result: must contain visible text`);
    checkStringArray(check.reviewed_paths, `${where}.reviewed_paths`, errors, { nonEmpty: true, paths: true });
    if (Array.isArray(check.reviewed_paths)) check.reviewed_paths.forEach((p) => union.add(p));
  });
  if (Array.isArray(unit.reviewed_paths) && unit.checks.length > 0) {
    const unitSet = new Set(unit.reviewed_paths);
    const same = unitSet.size === union.size && [...union].every((p) => unitSet.has(p));
    if (!same) errors.push(`${base}.reviewed_paths: must equal the union of checks[].reviewed_paths`);
  }
  if (["covered", "candidate"].includes(unit.status) && unit.checks.length > 0 && !sourceRead) {
    errors.push(`${base}.checks: a ${unit.status} unit needs at least one source or local check (tool hits alone never close a unit)`);
  }
}

function checkState(unit, base, errors) {
  const empty = (field) => Array.isArray(unit[field]) && unit[field].length === 0;
  const nonEmpty = (field) => Array.isArray(unit[field]) && unit[field].length > 0;
  const need = (cond, msg) => { if (!cond) errors.push(`${base}: status ${safeQuote(unit.status)} ${msg}`); };
  const owner = isAgentId(unit.agent_id);
  switch (unit.status) {
    case "planned":
      need(unit.agent_id === null, "requires agent_id null");
      need(empty("reviewed_paths") && empty("checks") && empty("result_fingerprints") && empty("unresolved"), "requires empty evidence, fingerprints, and unresolved");
      break;
    case "deferred":
    case "out_of_scope":
    case "not_applicable":
      need(unit.agent_id === null, "requires agent_id null");
      need(empty("reviewed_paths") && empty("checks") && empty("result_fingerprints"), "requires empty evidence and fingerprints");
      need(nonEmpty("unresolved"), "requires a reason in unresolved");
      break;
    case "in_progress":
      need(owner, "requires a canonical agent_id");
      need(empty("reviewed_paths") && empty("checks") && empty("result_fingerprints") && empty("unresolved"), "requires empty live evidence");
      break;
    case "blocked":
      need(owner, "requires a canonical agent_id");
      need(nonEmpty("reviewed_paths") && nonEmpty("checks"), "requires owned partial evidence");
      need(empty("result_fingerprints"), "must not carry fingerprints");
      need(nonEmpty("unresolved"), "requires a blocker in unresolved");
      break;
    case "covered":
      need(owner, "requires a canonical agent_id");
      need(nonEmpty("reviewed_paths") && nonEmpty("checks"), "requires reviewed_paths and checks");
      need(empty("result_fingerprints") && empty("unresolved"), "requires no fingerprints and no unresolved");
      break;
    case "candidate":
      need(owner, "requires a canonical agent_id");
      need(nonEmpty("reviewed_paths") && nonEmpty("checks"), "requires reviewed_paths and checks");
      need(nonEmpty("result_fingerprints"), "requires result_fingerprints");
      break;
    default:
      break;
  }
}

function collectUnitErrors(unit, index, errors) {
  const base = `$[${index}]`;
  if (!unit || typeof unit !== "object" || Array.isArray(unit)) {
    errors.push(`${base}: expected object`);
    return;
  }
  for (const key of REQUIRED) if (!hasOwn(unit, key)) errors.push(`${base}: missing required field ${safeQuote(key)}`);
  for (const key of Object.keys(unit)) {
    if (!REQUIRED.includes(key) && !OPTIONAL.has(key)) errors.push(`${base}: unexpected field ${safeQuote(key)}`);
  }
  if (typeof unit.subsystem !== "string" || !hasVisibleProse(unit.subsystem)) errors.push(`${base}.subsystem: must contain visible text`);
  if (typeof unit.subsystem_ref !== "string" || unit.subsystem_ref.length === 0 || unit.subsystem_ref.trim() !== unit.subsystem_ref) {
    errors.push(`${base}.subsystem_ref: must be a non-empty trimmed string`);
  }
  if (!DIMENSIONS.has(unit.dimension)) errors.push(`${base}.dimension: must be one of D2..D12`);
  if (typeof unit.coverage_id === "string" && typeof unit.subsystem_ref === "string" && DIMENSIONS.has(unit.dimension)) {
    const expected = canonicalCoverageId(unit);
    if (unit.coverage_id !== expected) errors.push(`${base}.coverage_id: expected ${safeQuote(expected)}`);
  }
  checkStringArray(unit.companions, `${base}.companions`, errors, { nonEmpty: true });
  if (Array.isArray(unit.companions)) {
    unit.companions.forEach((c, i) => { if (!COMPANIONS.has(c)) errors.push(`${base}.companions[${i}]: unknown companion ${safeQuote(c)}`); });
  }
  checkStringArray(unit.starting_paths, `${base}.starting_paths`, errors, { paths: true });
  if (!PRIOR_STATUSES.has(unit.prior_status)) errors.push(`${base}.prior_status: invalid value ${safeQuote(unit.prior_status)}`);
  if (!Number.isInteger(unit.wave) || unit.wave < 1) errors.push(`${base}.wave: must be a positive integer`);
  if (!STATUSES.has(unit.status)) errors.push(`${base}.status: invalid value ${safeQuote(unit.status)}`);
  if (unit.agent_id !== null && !isAgentId(unit.agent_id)) errors.push(`${base}.agent_id: must be null or a canonical lowercase agent id`);
  checkStringArray(unit.reviewed_paths, `${base}.reviewed_paths`, errors, { paths: true });
  checkStringArray(unit.result_fingerprints, `${base}.result_fingerprints`, errors);
  if (Array.isArray(unit.result_fingerprints)) {
    unit.result_fingerprints.forEach((f, i) => {
      if (typeof f === "string" && !FINGERPRINT.test(f)) errors.push(`${base}.result_fingerprints[${i}]: invalid fingerprint ${safeQuote(f)}`);
      else if (typeof f === "string" && !f.startsWith(`${unit.dimension}:`)) {
        errors.push(`${base}.result_fingerprints[${i}]: fingerprint dimension differs from unit dimension ${unit.dimension}; link it from the matching dimension unit`);
      }
    });
  }
  checkStringArray(unit.unresolved, `${base}.unresolved`, errors, { visible: true });
  if (hasOwn(unit, "observations")) checkStringArray(unit.observations, `${base}.observations`, errors, { visible: true });
  if (hasOwn(unit, "tool_candidates") && !(Number.isInteger(unit.tool_candidates) && unit.tool_candidates >= 0)) {
    errors.push(`${base}.tool_candidates: must be a non-negative integer`);
  }
  checkChecks(unit, base, errors);
  checkState(unit, base, errors);
}

function validateLedger(ledger, findings) {
  const errors = createErrorList();
  if (!Array.isArray(ledger)) {
    errors.push("$: ledger must be a top-level array");
    return errors;
  }
  const limitErrors = core.collectDataLimitErrors(ledger, "$");
  if (limitErrors.length > 0) return limitErrors;

  const ids = new Map();
  let previous = null;
  ledger.forEach((unit, index) => {
    if (errors.length >= LIMITS.validationErrors) return;
    collectUnitErrors(unit, index, errors);
    if (unit && typeof unit.coverage_id === "string") {
      if (ids.has(unit.coverage_id)) errors.push(`$[${index}].coverage_id: duplicate of $[${ids.get(unit.coverage_id)}]`);
      else ids.set(unit.coverage_id, index);
      if (previous !== null && previous > unit.coverage_id) errors.push(`$[${index}].coverage_id: units must be sorted by coverage_id`);
      previous = unit.coverage_id;
    }
  });

  if (findings !== undefined) {
    if (!Array.isArray(findings)) {
      errors.push("--findings: must be a top-level array");
      return errors;
    }
    const recorded = new Map(findings.filter((f) => f && typeof f.fingerprint === "string").map((f) => [f.fingerprint, f]));
    const linked = new Set();
    ledger.forEach((unit, index) => {
      if (!unit || !Array.isArray(unit.result_fingerprints)) return;
      unit.result_fingerprints.forEach((f) => {
        linked.add(f);
        if (!recorded.has(f)) errors.push(`$[${index}].result_fingerprints: ${safeQuote(f)} has no record in findings.json (unvalidated candidate → run is incomplete)`);
      });
    });
    for (const fingerprint of recorded.keys()) {
      if (!linked.has(fingerprint)) errors.push(`findings.json: ${safeQuote(fingerprint)} is not linked from any ledger unit`);
    }
  }
  return errors;
}

function run(argv) {
  const file = argv[0];
  const findingsIndex = argv.indexOf("--findings");
  const findingsFile = findingsIndex >= 0 ? argv[findingsIndex + 1] : undefined;
  if (!file || file.startsWith("--") || (findingsIndex >= 0 && !findingsFile)) {
    console.error("Usage: node validate-coverage-ledger.cjs <coverage-ledger.json> [--findings <findings.json>]");
    return 1;
  }
  const loaded = core.loadJsonFile(file, "coverage ledger");
  if (loaded.error) {
    console.error(loaded.error);
    return 1;
  }
  let findings;
  if (findingsFile) {
    const loadedFindings = core.loadJsonFile(findingsFile, "findings JSON");
    if (loadedFindings.error) {
      console.error(loadedFindings.error);
      return 1;
    }
    findings = loadedFindings.value;
  }
  const errors = validateLedger(loaded.value, findings);
  for (const message of errors) console.error("ERROR:", core.escapeUnsafeDiagnosticCharacters(message));
  if (errors.length > 0) {
    console.error(`FAIL: ${errors.length} ledger error(s)`);
    return 1;
  }
  const counts = loaded.value.reduce((acc, u) => ((acc[u.status] = (acc[u.status] || 0) + 1), acc), {});
  console.log(`PASS: ${loaded.value.length} units valid ${JSON.stringify(counts)}`);
  return 0;
}

module.exports = { canonicalCoverageId, encodeRef, validateLedger };

if (require.main === module) process.exit(run(process.argv.slice(2)));
