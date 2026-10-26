#!/usr/bin/env node

/**
 * Validates findings.json against report-schema.json plus semantic rules.
 * Usage: node validate-findings.cjs <path-to-findings.json>
 *
 * Structure adapted from cloudflare/security-audit-skill (MIT, see NOTICE.md).
 */

const path = require("path");
const core = require("./lib/schema-core.cjs");

const { hasOwn, safeQuote, hasVisibleProse, isSafeRelativeSourcePath, createErrorList, LIMITS } = core;

const IMPACT_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
const LIKELIHOOD_RANK = { low: 1, medium: 2, high: 3 };
const SCALE_DIMENSIONS = new Set(["D2", "D3"]);

function expectedPriority(impact, likelihood) {
  const product = IMPACT_RANK[impact] * LIKELIHOOD_RANK[likelihood];
  if (!Number.isFinite(product)) return null;
  if (product >= 9) return "P1";
  if (product >= 6) return "P2";
  if (product >= 3) return "P3";
  return "P4";
}

function idNumber(id) {
  const match = /^LVA-([0-9]+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

function collectFindingSemanticErrors(findings) {
  const errors = createErrorList();
  if (!Array.isArray(findings)) return errors;

  const fingerprints = new Map();
  const ids = new Map();
  let previousFingerprint = null;

  findings.forEach((finding, index) => {
    if (errors.length >= LIMITS.validationErrors) return;
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) return;
    const base = `$[${index}]`;

    if (typeof finding.fingerprint === "string") {
      if (fingerprints.has(finding.fingerprint)) {
        errors.push(`${base}.fingerprint: duplicate of $[${fingerprints.get(finding.fingerprint)}].fingerprint`);
      } else {
        fingerprints.set(finding.fingerprint, index);
      }
      if (previousFingerprint !== null && previousFingerprint > finding.fingerprint) {
        errors.push(`${base}.fingerprint: findings must be sorted lexicographically by fingerprint`);
      }
      previousFingerprint = finding.fingerprint;
      if (typeof finding.dimension === "string" && !finding.fingerprint.startsWith(`${finding.dimension}:`)) {
        errors.push(`${base}.fingerprint: must start with its dimension ${safeQuote(finding.dimension + ":")}`);
      }
      if (typeof finding.category === "string" && typeof finding.dimension === "string" &&
          !finding.fingerprint.startsWith(`${finding.dimension}:${finding.category}:`)) {
        errors.push(`${base}.fingerprint: must be ${safeQuote(`${finding.dimension}:${finding.category}:<symbol>`)}`);
      }
    }

    if (typeof finding.id === "string") {
      if (ids.has(finding.id)) errors.push(`${base}.id: duplicate of $[${ids.get(finding.id)}].id`);
      else ids.set(finding.id, index);
    }

    for (const field of ["locations", "evidence"]) {
      if (!Array.isArray(finding[field])) continue;
      finding[field].forEach((entry, entryIndex) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
        const where = `${base}.${field}[${entryIndex}]`;
        if (hasOwn(entry, "file") && !isSafeRelativeSourcePath(entry.file)) {
          errors.push(`${where}.file: must be a safe repository-relative path (forward slashes, no drive, no ..)`);
        }
        if (field === "evidence") {
          const cites = hasOwn(entry, "file") && hasOwn(entry, "line");
          if (hasOwn(entry, "file") !== hasOwn(entry, "line")) {
            errors.push(`${where}: file and line must be given together`);
          } else if (!cites && !hasOwn(entry, "lookup")) {
            errors.push(`${where}: needs file+line or a lookup`);
          }
        }
      });
    }
    if (finding.remediation && Array.isArray(finding.remediation.code_changes)) {
      finding.remediation.code_changes.forEach((change, changeIndex) => {
        if (change && hasOwn(change, "file_name") && !isSafeRelativeSourcePath(change.file_name)) {
          errors.push(`${base}.remediation.code_changes[${changeIndex}].file_name: must be a safe repository-relative path`);
        }
      });
    }

    const verdict = finding.verdict;
    const locations = Array.isArray(finding.locations) ? finding.locations : [];

    if (verdict === "confirmed") {
      for (const forbidden of ["claimed_root_cause", "blockers", "validation_plan", "reason"]) {
        if (hasOwn(finding, forbidden)) errors.push(`${base}: confirmed finding must not contain ${safeQuote(forbidden)}`);
      }
      const impact = finding.impact && finding.impact.score;
      const likelihood = finding.likelihood && finding.likelihood.score;
      const expected = expectedPriority(impact, likelihood);
      if (expected && finding.priority !== expected) {
        errors.push(`${base}.priority: impact ${safeQuote(impact)} x likelihood ${safeQuote(likelihood)} requires ${expected}, got ${safeQuote(finding.priority)}`);
      }
      if (SCALE_DIMENSIONS.has(finding.dimension) && !(typeof finding.scale === "string" && hasVisibleProse(finding.scale))) {
        errors.push(`${base}.scale: required for ${finding.dimension} performance findings`);
      }
      if (finding.dimension === "D4") {
        if (new Set(locations.map((l) => l && `${l.file}:${l.line}`)).size < 2) {
          errors.push(`${base}.locations: D4 duplication requires at least 2 distinct locations`);
        }
        if (!hasOwn(finding, "extraction_target")) errors.push(`${base}.extraction_target: required for D4`);
        if (!hasOwn(finding, "divergence")) errors.push(`${base}.divergence: required for D4`);
      } else {
        if (hasOwn(finding, "extraction_target") || hasOwn(finding, "divergence")) {
          errors.push(`${base}: extraction_target/divergence are only for D4 findings`);
        }
      }
      // "Target is missing" claims must show the empty lookup; other D6 wiring categories (escaping, drift) need not.
      const absenceClaim = /^(missing|unused|dead|orphan|unresolved|undefined)-/.test(String(finding.category));
      if (finding.dimension === "D6" && absenceClaim && Array.isArray(finding.evidence) && !finding.evidence.some((e) => e && hasOwn(e, "lookup"))) {
        errors.push(`${base}.evidence: D6 absence claims (missing-/unused-/dead-…) require a lookup proving the target is missing`);
      }
    } else if (verdict === "needs_validation") {
      for (const forbidden of ["root_cause", "consequence", "impact", "likelihood", "priority", "effort", "confidence", "remediation", "reason", "scale", "local_check"]) {
        if (hasOwn(finding, forbidden)) errors.push(`${base}: needs_validation finding must not contain ${safeQuote(forbidden)}`);
      }
      const plan = finding.validation_plan;
      const hasLocal = plan && typeof plan.local === "string" && hasVisibleProse(plan.local);
      const hasOwner = plan && typeof plan.owner === "string" && hasVisibleProse(plan.owner);
      if (!hasLocal && !hasOwner) errors.push(`${base}.validation_plan: requires a visible local or owner plan`);
    } else if (verdict === "rejected") {
      for (const forbidden of ["root_cause", "consequence", "impact", "likelihood", "priority", "effort", "confidence", "remediation", "blockers", "validation_plan"]) {
        if (hasOwn(finding, forbidden)) errors.push(`${base}: rejected finding must not contain ${safeQuote(forbidden)}`);
      }
    }
  });

  return errors;
}

function validateDocument(findings, schema) {
  const schemaErrors = core.collectSchemaErrors(schema);
  if (schemaErrors.length > 0) return schemaErrors;
  const limitErrors = core.collectDataLimitErrors(findings, "$");
  if (limitErrors.length > 0) return limitErrors;
  const errors = core.collectUnchecked(findings, schema, "$");
  if (errors.length < LIMITS.validationErrors) errors.push(...collectFindingSemanticErrors(findings));
  return errors;
}

function run(file) {
  if (!file) {
    console.error("Usage: node validate-findings.cjs <path-to-findings.json>");
    return 1;
  }
  let schema;
  try {
    schema = core.loadSchema(path.join(__dirname, "report-schema.json"));
  } catch (error) {
    console.error("Failed to load report-schema.json:", error.message);
    return 1;
  }
  const loaded = core.loadJsonFile(file, "findings JSON");
  if (loaded.error) {
    console.error(loaded.error);
    return 1;
  }
  let errors;
  try {
    errors = validateDocument(loaded.value, schema);
  } catch {
    console.error("Failed to validate findings JSON: unexpected validation error");
    return 1;
  }
  for (const message of errors) console.error("ERROR:", core.escapeUnsafeDiagnosticCharacters(message));
  if (errors.length > 0) {
    const cap = errors.length === LIMITS.validationErrors ? `; output capped at ${LIMITS.validationErrors}` : "";
    console.error(`FAIL: ${errors.length} validation error(s)${cap}`);
    return 1;
  }
  const counts = loaded.value.reduce((acc, f) => ((acc[f.verdict] = (acc[f.verdict] || 0) + 1), acc), {});
  console.log(`PASS: ${loaded.value.length} findings valid ${JSON.stringify(counts)}`);
  return 0;
}

module.exports = { collectFindingSemanticErrors, expectedPriority, idNumber, validateDocument };

if (require.main === module) process.exit(run(process.argv[2]));
