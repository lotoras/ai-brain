#!/usr/bin/env node
/**
 * Phase 6: derive REPORT.md, QUICK-WINS.md, NEEDS-VALIDATION.md from the FINAL JSON, so prose can never
 * disagree with findings.json. The parent supplies narrative sections in <run>/report-notes.json:
 *   { "summary": "...", "risk_register": ["..."], "observations": ["..."], "owner_checks": ["..."],
 *     "coverage_notes": ["..."], "partial_reasons": ["..."] }
 * Usage: node render-report.cjs <run-dir>
 */
const fs = require("fs");
const path = require("path");

const runDir = process.argv[2];
if (!runDir) {
  console.error("Usage: node render-report.cjs <run-dir>");
  process.exit(1);
}
const read = (f, d) => (fs.existsSync(path.join(runDir, f)) ? JSON.parse(fs.readFileSync(path.join(runDir, f), "utf8")) : d);
const findings = read("findings.json", []);
const ledger = read("coverage-ledger.json", []);
const meta = read("run-metadata.json", {});
const notes = read("report-notes.json", {});

const P = { P1: 1, P2: 2, P3: 3, P4: 4 };
const I = { critical: 1, high: 2, medium: 3, low: 4 };
const E = { S: 1, M: 2, L: 3 };
const confirmed = findings.filter((f) => f.verdict === "confirmed")
  .sort((a, b) => P[a.priority] - P[b.priority] || I[a.impact.score] - I[b.impact.score] || E[a.effort] - E[b.effort] || (a.id < b.id ? -1 : 1));
const needs = findings.filter((f) => f.verdict === "needs_validation").sort((a, b) => (a.id < b.id ? -1 : 1));
const rejected = findings.filter((f) => f.verdict === "rejected");
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
const loc = (l) => `\`${l.file}:${l.line}\``;
const list = (arr) => (arr && arr.length ? arr.map((x) => `- ${x}`).join("\n") : "- (none)");

const partial = meta.profile === "quick" || (meta.scope_paths && meta.scope_paths.join(",") !== ".") || meta.diff_base || meta.run_status !== "complete";
const header = [
  `# Code-health audit: ${meta.repo}${meta.branch ? `@${meta.branch}` : ""}`,
  "",
  `| | |`, `|---|---|`,
  `| Source ref | \`${meta.source_ref || "?"}\`${meta.dirty ? " (dirty working tree)" : ""} |`,
  `| Profile | ${meta.profile}${meta.scope_paths ? ` · scope: ${meta.scope_paths.join(", ")}` : ""}${meta.diff_base ? ` · diff vs ${meta.diff_base}` : ""} |`,
  `| Stack | ${meta.stack ? Object.entries(meta.stack).map(([k, v]) => `${k}: ${v}`).join(", ") : "?"} |`,
  `| Tools | ${meta.tools_available ? Object.entries(meta.tools_available).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`).join("; ") : "?"} |`,
  `| Prior runs | ${meta.prior_runs && meta.prior_runs.length ? meta.prior_runs.join(", ") : "none"} |`,
  `| Status | ${meta.run_status}${meta.incomplete_reason ? ` (${meta.incomplete_reason})` : ""} |`,
  `| Result | ${confirmed.length} confirmed · ${needs.length} needs validation · ${rejected.length} rejected |`,
  "",
  partial ? `> **Partial pass.** ${[...(notes.partial_reasons || [])].join(" ") || "Quick, scoped, diff, or incomplete run: absence of findings outside the covered units means nothing."}\n` : "",
].join("\n");

const table = [
  "## Findings", "",
  "| ID | P | Dim | Title | Impact | Effort | Tags |", "|---|---|---|---|---|---|---|",
  ...confirmed.map((f) => `| ${f.id} | ${f.priority} | ${f.dimension} | ${esc(f.title)} | ${f.impact.score} | ${f.effort} | ${esc((f.tags || []).join(", "))} |`),
  confirmed.length ? "" : "_No confirmed findings._\n",
].join("\n");

const detail = confirmed.map((f) => [
  `### ${f.id} · ${f.priority} · ${esc(f.title)}`,
  "",
  `**Dimension** ${f.dimension} (${f.category}) · **Impact** ${f.impact.score}: ${f.impact.reason} · **Likelihood** ${f.likelihood.score}: ${f.likelihood.reason} · **Effort** ${f.effort} · **Confidence** ${f.confidence.score}`,
  "",
  `**Where:** ${f.locations.map(loc).join(", ")}`,
  "",
  f.description,
  "",
  `**Consequence:** ${f.consequence}`,
  f.scale ? `\n**Scale:** ${f.scale}` : "",
  f.extraction_target ? `\n**Extract into:** ${f.extraction_target} · **Divergence:** ${f.divergence.verdict}: ${f.divergence.note}` : "",
  "",
  `**Counter-evidence checked:** ${f.counter_evidence_checked.join("; ")}`,
  "",
  `**Fix:** ${f.remediation.strategy}`,
  "",
  `**Regression check:** ${f.remediation.regression_check}`,
  f.local_check ? `\n**Local check:** \`${f.local_check.command}\` → ${f.local_check.observed_result}` : "",
  (f.tags || []).includes("security-adjacent") ? "\n> Security-adjacent: run the `security-audit` skill for depth." : "",
  "",
].join("\n")).join("\n");

const nvTable = [
  "## Needs validation (no priority: decisive fact not visible in source)", "",
  "| ID | Dim | Title | Blocker | Next step |", "|---|---|---|---|---|",
  ...needs.map((f) => `| ${f.id} | ${f.dimension} | ${esc(f.title)} | ${esc(f.blockers[0])}${f.blockers.length > 1 ? ` (+${f.blockers.length - 1})` : ""} | ${esc(f.validation_plan.owner || f.validation_plan.local)} |`),
  needs.length ? "" : "_None._\n",
].join("\n");

const counts = {};
for (const u of ledger) {
  counts[u.dimension] = counts[u.dimension] || {};
  counts[u.dimension][u.status] = (counts[u.dimension][u.status] || 0) + 1;
}
const statuses = ["covered", "candidate", "blocked", "deferred", "out_of_scope", "not_applicable", "planned", "in_progress"];
const coverage = [
  "## Coverage", "",
  `| Dim | ${statuses.join(" | ")} |`, `|---|${statuses.map(() => "---").join("|")}|`,
  ...Object.keys(counts).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((d) => `| ${d} | ${statuses.map((s) => counts[d][s] || "").join(" | ")} |`),
  "",
  "Deferred / out of scope:",
  list(ledger.filter((u) => ["deferred", "out_of_scope", "not_applicable"].includes(u.status)).map((u) => `${u.subsystem} × ${u.dimension}: ${u.status} (${u.unresolved.join("; ")})`)),
  "",
  list(notes.coverage_notes),
  "",
  rejected.length ? `Rejected during validation (kept in findings.json so later runs do not repeat them): ${rejected.map((r) => `${r.id} ${r.fingerprint}`).join(", ")}` : "",
].join("\n");

const report = [
  header,
  "## Summary", "", notes.summary || "_(parent: add report-notes.json → summary)_", "",
  table, detail,
  nvTable,
  "## Risk register (D11: risks, not defects)", "", list(notes.risk_register), "",
  "## Observations (style / pre-existing / not findings)", "", list(notes.observations), "",
  "## Owner-run checks (network or production access)", "", list(notes.owner_checks), "",
  coverage, "",
].join("\n");

const qw = confirmed.filter((f) => ["P1", "P2"].includes(f.priority)).sort((a, b) => E[a.effort] - E[b.effort] || P[a.priority] - P[b.priority]);
const quick = [
  `# Quick wins: ${meta.repo}`, "",
  "P1/P2 findings, cheapest first.", "",
  ...qw.map((f) => [
    `## ${f.id} · ${f.priority} · effort ${f.effort}: ${esc(f.title)}`,
    `- **Why:** ${f.consequence}`,
    `- **Where:** ${f.locations.slice(0, 3).map(loc).join(", ")}`,
    `- **Change:** ${f.remediation.strategy}`,
    ...(f.remediation.code_changes || []).map((c) => `\n\`${c.file_name}\`\n\`\`\`php\n${c.fixed_code}\n\`\`\``),
    `- **Test:** ${f.remediation.regression_check}`,
    "",
  ].join("\n")),
  qw.length ? `To apply: ask for \`fix ${qw.filter((f) => f.effort === "S").map((f) => f.id).join(", ")}\` (see FIXING.md).` : "_No P1/P2 findings._",
  "",
].join("\n");

const nvDoc = [
  `# Needs validation: ${meta.repo}`, "",
  "These are source-grounded leads whose decisive fact is outside source. They are not defects and have no priority.", "",
  ...needs.map((f) => [
    `## ${f.id}: ${esc(f.title)}`, "",
    f.description, "",
    `**Claimed root cause:** ${f.claimed_root_cause}`, "",
    `**Where:** ${f.locations.map(loc).join(", ")}`, "",
    "**Evidence:**", ...f.evidence.map((e) => `- ${e.file ? `${loc(e)}: ` : ""}${e.lookup ? `\`${e.lookup}\`: ` : ""}${e.description}`), "",
    "**Blockers:**", ...f.blockers.map((b) => `- ${b}`), "",
    f.validation_plan.local ? `**Local check:** ${f.validation_plan.local}\n` : "",
    f.validation_plan.owner ? `**Owner check:** ${f.validation_plan.owner}\n` : "",
  ].join("\n")),
].join("\n");

fs.writeFileSync(path.join(runDir, "REPORT.md"), report);
fs.writeFileSync(path.join(runDir, "QUICK-WINS.md"), quick);
fs.writeFileSync(path.join(runDir, "NEEDS-VALIDATION.md"), nvDoc);
console.log(`REPORT.md (${confirmed.length} confirmed), QUICK-WINS.md (${qw.length}), NEEDS-VALIDATION.md (${needs.length})`);
