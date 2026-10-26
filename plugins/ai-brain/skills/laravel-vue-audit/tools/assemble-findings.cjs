#!/usr/bin/env node
/**
 * Phase 4 (parent): assemble findings.json from verifier decisions and apply hunter unit results to the ledger.
 *  - reads <run>/agents/v-* /scratch/decision.json  ({"decisions":[{decision, record}]} or {decision, record})
 *  - assigns ids: prior-run ids by fingerprint are kept (--prior <findings.json>), new ones get the next LVA-NNN
 *  - writes <run>/findings.json sorted by fingerprint
 *  - applies <run>/candidates.json unit_results to <run>/coverage-ledger.json (owner, checks, paths) and links every
 *    final fingerprint to the unit of its dimension (subsystem from --subsystem-ref, default: the only unit per dimension)
 * Then run validate-findings.cjs and validate-coverage-ledger.cjs --findings.
 *
 * Usage: node assemble-findings.cjs <run-dir> [--prior <findings.json>] [--subsystem-ref <ref>]
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const runDir = argv[0];
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
if (!runDir) {
  console.error("Usage: node assemble-findings.cjs <run-dir> [--prior <findings.json>] [--subsystem-ref <ref>]");
  process.exit(1);
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "").replace(/^```(?:json)?\s*|\s*```\s*$/g, ""));

// 1. decisions
const decisions = [];
const problems = [];
const agentsDir = path.join(runDir, "agents");
for (const agent of fs.readdirSync(agentsDir).filter((a) => a.startsWith("v-")).sort()) {
  const f = path.join(agentsDir, agent, "scratch", "decision.json");
  if (!fs.existsSync(f)) { problems.push(`${agent}: no decision.json (unvalidated batch → run incomplete)`); continue; }
  let j;
  try { j = readJson(f); } catch (e) { problems.push(`${agent}: invalid JSON (${e.message})`); continue; }
  const list = Array.isArray(j.decisions) ? j.decisions : [j];
  for (const d of list) {
    if (!d || !d.record || !["confirmed", "needs_validation", "rejected"].includes(d.decision)) { problems.push(`${agent}: malformed decision`); continue; }
    const { id, proposed_verdict, ...rec } = d.record;
    decisions.push({ agent, record: { ...rec, verdict: d.decision } });
  }
}

// 2. ids (stable across runs)
const prior = opt("--prior") ? readJson(opt("--prior")) : [];
const priorIds = new Map(prior.map((f) => [f.fingerprint, f.id]));
let next = Math.max(0, ...prior.map((f) => Number(String(f.id).replace("LVA-", "")) || 0)) + 1;
const seen = new Set();
const findings = [];
for (const { agent, record } of decisions.sort((a, b) => (a.record.fingerprint < b.record.fingerprint ? -1 : 1))) {
  if (seen.has(record.fingerprint)) { problems.push(`${agent}: duplicate decision for ${record.fingerprint} (kept the first)`); continue; }
  seen.add(record.fingerprint);
  const id = priorIds.get(record.fingerprint) || `LVA-${String(next++).padStart(3, "0")}`;
  // Key order: id first for readability.
  findings.push({ id, ...record });
}
fs.writeFileSync(path.join(runDir, "findings.json"), JSON.stringify(findings, null, 2));

// 3. ledger
const ledgerFile = path.join(runDir, "coverage-ledger.json");
const ledger = readJson(ledgerFile);
const cand = fs.existsSync(path.join(runDir, "candidates.json")) ? readJson(path.join(runDir, "candidates.json")) : { unit_results: [] };
const normMethod = (m) => (/local/.test(m) ? "local" : /source/.test(m) ? "source" : "tool");
// Alias map: every fingerprint a hunter used → the final fingerprint (consolidate --alias merges).
const finalFp = new Map();
for (const c of cand.candidates || []) {
  finalFp.set(c.fingerprint, c.fingerprint);
  if (c._aliased_from) finalFp.set(c._aliased_from, c.fingerprint);
  for (const d of c._duplicates || []) if (d._aliased_from) finalFp.set(d._aliased_from, c.fingerprint);
}
const touched = new Set((cand.unit_results || []).map((ur) => ur.coverage_id));
for (const unit of ledger) if (touched.has(unit.coverage_id)) { unit.checks = []; unit.result_fingerprints = []; } // idempotent re-runs
const linked = new Map(); // coverage_id -> Set(final fp)
for (const ur of cand.unit_results || []) {
  const unit = ledger.find((u) => u.coverage_id === ur.coverage_id);
  if (!unit) { problems.push(`${ur.agent}: unit ${ur.coverage_id} not in ledger`); continue; }
  unit.agent_id = unit.agent_id || ur.agent;
  for (const c of ur.checks || []) {
    unit.checks.push({ agent_id: c.agent_id || ur.agent, pattern: c.pattern, method: normMethod(String(c.method || "")), reviewed_paths: c.reviewed_paths || [], result: c.result });
  }
  const obs = (cand.observations || []).filter((o) => o.agent === ur.agent).map((o) => o.text);
  if (obs.length) unit.observations = [...new Set([...(unit.observations || []), ...obs])];
  for (const fp of ur.candidate_fingerprints || []) {
    const f = finalFp.get(fp) || fp;
    if (!findings.some((x) => x.fingerprint === f)) continue; // not (yet) decided
    // A cross-dimension alias (D7 → D5) links to the same-subsystem unit of the final dimension.
    const dim = f.split(":")[0];
    const target = dim === unit.dimension ? unit
      : ledger.find((u) => u.subsystem_ref === unit.subsystem_ref && u.dimension === dim && touched.has(u.coverage_id))
      || ledger.find((u) => u.dimension === dim && touched.has(u.coverage_id));
    if (!target) { problems.push(`${f}: no hunted unit with dimension ${dim} to link to`); continue; }
    if (!linked.has(target.coverage_id)) linked.set(target.coverage_id, new Set());
    linked.get(target.coverage_id).add(f);
  }
}
const subRef = opt("--subsystem-ref");
for (const f of findings) {
  if ([...linked.values()].some((s) => s.has(f.fingerprint))) continue;
  // Not listed by any unit result (e.g. a verifier-introduced root cause): fall back to the dimension's unit.
  const unit = ledger.find((u) => u.dimension === f.dimension && touched.has(u.coverage_id) && (!subRef || u.subsystem_ref === subRef));
  if (!unit) { problems.push(`${f.fingerprint}: no unit to link to`); continue; }
  if (!linked.has(unit.coverage_id)) linked.set(unit.coverage_id, new Set());
  linked.get(unit.coverage_id).add(f.fingerprint);
}
for (const unit of ledger) {
  if (!touched.has(unit.coverage_id)) continue;
  const paths = new Set();
  for (const c of unit.checks) for (const p of c.reviewed_paths) paths.add(p);
  unit.reviewed_paths = [...paths];
  const fps = [...(linked.get(unit.coverage_id) || [])].sort();
  unit.result_fingerprints = fps;
  unit.status = fps.length ? "candidate" : "covered";
  if (unit.status === "covered") unit.unresolved = [];
}
fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));

const counts = findings.reduce((a, f) => ((a[f.verdict] = (a[f.verdict] || 0) + 1), a), {});
console.log(`findings: ${findings.length} ${JSON.stringify(counts)}  next id: LVA-${String(next).padStart(3, "0")}`);
for (const p of problems) console.log(`PROBLEM: ${p}`);
