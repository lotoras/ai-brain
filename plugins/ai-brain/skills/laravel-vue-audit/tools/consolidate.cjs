#!/usr/bin/env node
/**
 * Parent-side consolidation of hunter results (Phase 2 → Phase 3 input).
 * Reads <run>/agents/<agent>/scratch/result.json for every agent (or the files given),
 * checks the structured-result shape, merges candidates by fingerprint, flags likely
 * same-root-cause duplicates across fingerprints (same primary file:line), and writes
 * <run>/candidates.json. Does not modify the ledger (the parent applies unit results).
 *
 * Usage: node consolidate.cjs <run-dir> [--alias OLD_FP=NEW_FP ...]
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const runDir = argv[0];
if (!runDir) {
  console.error("Usage: node consolidate.cjs <run-dir> [--alias OLD_FP=NEW_FP ...]");
  process.exit(1);
}
const aliases = new Map();
argv.forEach((a, i) => { if (a === "--alias" && argv[i + 1]) { const [o, n] = argv[i + 1].split("="); aliases.set(o, n); } });

const agentsDir = path.join(runDir, "agents");
const results = [];
const problems = [];
for (const agent of fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir) : []) {
  const file = path.join(agentsDir, agent, "scratch", "result.json");
  if (!fs.existsSync(file)) continue;
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/^```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch (e) {
    problems.push(`${agent}: result.json is not valid JSON (${e.message}); re-run the hunter, do not repair`);
    continue;
  }
  for (const key of ["units", "candidates"]) if (!Array.isArray(json[key])) problems.push(`${agent}: missing array "${key}"`);
  results.push({ agent, json });
}

const byFp = new Map();
const unitResults = [];
const observations = [];
const uncovered = [];
for (const { agent, json } of results) {
  for (const u of json.units || []) {
    unitResults.push({ agent, ...u });
    if (!["covered", "candidate", "blocked"].includes(u.disposition)) problems.push(`${agent}: unit ${u.coverage_id} has invalid disposition ${u.disposition}`);
    // Catch contract drift here (Phase 2), not at the Phase 4 validators.
    for (const c of u.checks || []) {
      if (!/^[A-Z0-9-]+\.md#.+$/.test(String(c.pattern || ""))) problems.push(`${agent}: check pattern ${JSON.stringify(c.pattern)} is not "COMPANION.md#Heading"; ask the hunter to fix it`);
    }
    for (const fp of u.candidate_fingerprints || []) {
      if (!(json.candidates || []).some((c) => c.fingerprint === fp)) problems.push(`${agent}: unit lists fingerprint ${fp} with no candidate record`);
    }
  }
  for (const c of json.candidates || []) {
    const fp = aliases.get(c.fingerprint) || c.fingerprint;
    const rec = { ...c, fingerprint: fp, _agents: [agent] };
    if (aliases.has(c.fingerprint)) {
      rec._aliased_from = c.fingerprint;
      // dimension/category follow the target fingerprint (<dim>:<category>:<symbol>)
      const [dim, cat] = fp.split(":");
      rec.dimension = dim;
      rec.category = cat;
    }
    if (!["confirmed", "needs_validation"].includes(c.proposed_verdict)) problems.push(`${agent}: ${c.fingerprint} has proposed_verdict ${c.proposed_verdict}`);
    if (!/^D(?:[2-9]|1[0-2]):[a-z0-9]+(?:-[a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9._:/@+-]*$/.test(String(c.fingerprint))) problems.push(`${agent}: fingerprint ${JSON.stringify(c.fingerprint)} does not match the schema pattern`);
    if (byFp.has(fp)) {
      let prev = byFp.get(fp);
      // Prefer the record that natively carries this fingerprint as primary.
      if (prev._aliased_from && !rec._aliased_from) {
        const { _duplicates = [], _agents } = prev;
        delete prev._duplicates;
        rec._duplicates = [..._duplicates, prev];
        rec._agents = [..._agents, agent];
        byFp.set(fp, rec);
      } else {
        prev._agents.push(agent);
        prev._duplicates = [...(prev._duplicates || []), rec];
      }
    } else byFp.set(fp, rec);
  }
  for (const o of json.observations || []) observations.push({ agent, text: o });
  for (const u of json.uncovered || []) uncovered.push({ agent, ...u });
}

// Same-root-cause hints: different fingerprints sharing a primary location (first location file:line).
const byLoc = new Map();
for (const c of byFp.values()) {
  const l = (c.locations || [])[0];
  if (!l) continue;
  const k = `${l.file}:${l.line}`;
  byLoc.set(k, [...(byLoc.get(k) || []), c.fingerprint]);
}
const sameRootHints = [...byLoc.entries()].filter(([, fps]) => fps.length > 1).map(([loc, fps]) => ({ location: loc, fingerprints: fps }));

const candidates = [...byFp.values()].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
const out = { generated_from: results.map((r) => r.agent), candidates, same_root_cause_hints: sameRootHints, unit_results: unitResults, observations, uncovered, problems };
fs.writeFileSync(path.join(runDir, "candidates.json"), JSON.stringify(out, null, 2));
console.log(`agents: ${results.length}  candidates: ${candidates.length}  (confirmed proposals: ${candidates.filter((c) => c.proposed_verdict === "confirmed").length})`);
for (const h of sameRootHints) console.log(`same-root-cause? ${h.location}: ${h.fingerprints.join(" | ")}`);
for (const p of problems) console.log(`PROBLEM: ${p}`);
