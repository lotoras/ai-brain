#!/usr/bin/env node
/**
 * Phase 5 (parent): apply final-record verifier results to findings.json.
 *  reads <run>/agents/p5-* /scratch/decision.json:
 *    {"decisions":[{"decision":"verified","fingerprint":"…"} | {"decision":"replace","reason":"…","record":{…}}]}
 *  - verified: nothing changes
 *  - replace, NON-material (same verdict, priority, impact, likelihood, root cause, dimension): applied directly
 *  - replace, MATERIAL: NOT applied; written to <run>/phase5-material.json for another fresh verifier
 *    (SKILL/VALIDATION rule: material replacements need independent re-verification before they count)
 * Every confirmed/needs_validation record must be covered by exactly one p5 decision, or the run stays incomplete.
 * Usage: node apply-phase5.cjs <run-dir> [--accept-material <phase5-material-verified.json>]
 */
const fs = require("fs");
const path = require("path");

const runDir = process.argv[2];
if (!runDir) {
  console.error("Usage: node apply-phase5.cjs <run-dir> [--accept-material <file>]");
  process.exit(1);
}
const { validateDocument } = require("../validate-findings.cjs");
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "report-schema.json"), "utf8"));
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "").replace(/^```(?:json)?\s*|\s*```\s*$/g, ""));
const findingsFile = path.join(runDir, "findings.json");
const findings = readJson(findingsFile);
const byFp = new Map(findings.map((f) => [f.fingerprint, f]));
const problems = [];
const seen = new Map();
const material = [];
let applied = 0;

const rootOf = (r) => r.root_cause || r.claimed_root_cause || "";
const isMaterial = (a, b) =>
  a.verdict !== b.verdict || a.dimension !== b.dimension || (a.priority || "") !== (b.priority || "") ||
  ((a.impact || {}).score || "") !== ((b.impact || {}).score || "") ||
  ((a.likelihood || {}).score || "") !== ((b.likelihood || {}).score || "") || rootOf(a) !== rootOf(b);

const agentsDir = path.join(runDir, "agents");
for (const agent of fs.readdirSync(agentsDir).filter((a) => a.startsWith("p5-")).sort()) {
  const f = path.join(agentsDir, agent, "scratch", "decision.json");
  if (!fs.existsSync(f)) { problems.push(`${agent}: no decision.json`); continue; }
  let j;
  try { j = readJson(f); } catch (e) { problems.push(`${agent}: invalid JSON (${e.message})`); continue; }
  for (const d of j.decisions || [j]) {
    const fp = d.fingerprint || (d.record && d.record.fingerprint);
    if (!byFp.has(fp)) { problems.push(`${agent}: unknown fingerprint ${fp}`); continue; }
    if (seen.has(fp)) { problems.push(`${agent}: duplicate decision for ${fp} (also ${seen.get(fp)})`); continue; }
    seen.set(fp, agent);
    if (d.decision === "verified") continue;
    if (d.decision !== "replace" || !d.record) { problems.push(`${agent}: malformed decision for ${fp}`); continue; }
    const current = byFp.get(fp);
    const { id, proposed_verdict, ...rec } = d.record;
    const next = { id: current.id, ...rec, verdict: rec.verdict || current.verdict, fingerprint: fp };
    // A replacement must itself be schema-valid; otherwise keep the verified record and send it back.
    const errs = validateDocument([next], schema);
    if (errs.length) { problems.push(`${agent}: replacement for ${fp} is invalid (${errs[0]}); kept the current record, ask the agent to fix it`); continue; }
    if (isMaterial(current, next)) material.push({ agent, fingerprint: fp, reason: d.reason, from: current, to: next });
    else { byFp.set(fp, next); applied++; }
  }
}

const accept = process.argv.includes("--accept-material") ? readJson(process.argv[process.argv.indexOf("--accept-material") + 1]) : [];
for (const r of accept) { // records a second fresh verifier confirmed
  if (byFp.has(r.fingerprint)) { const { proposed_verdict, ...rec } = r; byFp.set(r.fingerprint, { ...rec, id: byFp.get(r.fingerprint).id }); applied++; }
}

for (const f of findings) {
  if (f.verdict !== "rejected" && !seen.has(f.fingerprint)) problems.push(`${f.fingerprint}: no Phase 5 decision (run incomplete)`);
}
const out = findings.map((f) => byFp.get(f.fingerprint));
fs.writeFileSync(findingsFile, JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(runDir, "phase5-material.json"), JSON.stringify(material.filter((m) => !accept.some((a) => a.fingerprint === m.fingerprint)), null, 2));
console.log(`phase5: ${seen.size} decided, ${applied} replacement(s) applied, ${material.length} material pending re-verification`);
for (const m of material) console.log(`MATERIAL: ${m.fingerprint}: ${m.from.verdict}/${m.from.priority || "-"} -> ${m.to.verdict}/${m.to.priority || "-"} (${m.reason})`);
for (const p of problems) console.log(`PROBLEM: ${p}`);
