#!/usr/bin/env node
'use strict';
/*
 * session-model-guard.js — Claude Code "SessionStart" hook.
 *
 * Fires on every session start (startup, resume, clear, compact) and injects
 * model-specific orchestration policy into the session's additionalContext.
 * For Fable 5 sessions at effort above "medium" on startup/clear, also injects
 * a one-time WARN block prompting the user to confirm the effort level.
 * Sonnet and Haiku sessions: exits 0 with no output (no context overhead).
 *
 * Wired in ~/.claude/settings.json:
 *   "hooks": { "SessionStart": [ { "matcher": "startup|resume|clear|compact",
 *     "hooks": [{ "type": "command",
 *                 "command": "node ~/.claude/hooks/session-model-guard.js" }]
 *   } ] }
 *
 * Contract (SessionStart hook):
 *   stdin  = JSON { hook_event_name, source, cwd, session_id, model?, ... }
 *             source is one of "startup"|"resume"|"clear"|"compact"
 *             model  is optional (string model-id, or object with .id/.display_name;
 *                    may be absent after /clear or session recovery)
 *   stdout = JSON { hookSpecificOutput: { hookEventName: "SessionStart",
 *                                         additionalContext: "..." } }
 *   exit 0 always — never exit nonzero, never crash the session.
 *
 * Model resolution order (first source that yields a non-empty value wins):
 *   (a) stdin `model` field — String-coerced; if it is an object, tries .id then
 *       .display_name; falls through if both are absent/empty.
 *   (b) Settings cascade (first file that defines "model" wins):
 *         1. <cwd>/.claude/settings.local.json
 *         2. <cwd>/.claude/settings.json
 *         3. <homedir>/.claude/settings.local.json
 *         4. <homedir>/.claude/settings.json
 *   (c) Unknown — policy block notes that model could not be determined.
 *
 * Effort resolution order (first source that yields a non-empty value wins):
 *   (a) env var CLAUDE_CODE_EFFORT_LEVEL — read at startup; if non-empty, used as-is.
 *   (b) Settings cascade (same four files, "effortLevel" key).
 *   (c) Unset — treated as rank -1; the WARN block is never emitted.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

// Read and parse one JSON file; return null if unreadable or malformed.
function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw);
  } catch (_) { return null; }
}

// Walk the four-file cascade and return the first value found for each key.
function resolveCascade(cwd) {
  const home = os.homedir();
  const files = [
    path.join(cwd,  '.claude', 'settings.local.json'),
    path.join(cwd,  '.claude', 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
    path.join(home, '.claude', 'settings.json'),
  ];
  let model, effortLevel;
  let modelFound = false, effortFound = false;
  for (const f of files) {
    if (modelFound && effortFound) break;
    const data = readJson(f);
    if (!data || typeof data !== 'object') continue;
    if (!modelFound && 'model' in data) { model = data.model; modelFound = true; }
    if (!effortFound && 'effortLevel' in data) { effortLevel = data.effortLevel; effortFound = true; }
  }
  return { model, effortLevel };
}

// fable / opus / sonnet / haiku / unknown
function classifyModel(model) {
  const s = String(model || '').toLowerCase();
  if (s.includes('fable'))  return 'fable';
  if (s.includes('opus'))   return 'opus';
  if (s.includes('sonnet')) return 'sonnet';
  if (s.includes('haiku'))  return 'haiku';
  return 'unknown';
}

// low→0  medium→1  high→2  xhigh→3  anything-else→-1 (never warns)
function effortRank(effortLevel) {
  const map = { low: 0, medium: 1, high: 2, xhigh: 3 };
  return map[String(effortLevel || '').toLowerCase()] ?? -1;
}

// ── main ─────────────────────────────────────────────────────────────────────
try {
  const raw = readStdin().replace(/^﻿/, '').trim();
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch (_) { input = {}; }

  const cwd    = (input && input.cwd) || process.cwd();
  const source = (input && input.source) || '';

  // ── Model resolution: (a) stdin → (b) cascade → (c) unknown ─────────────────
  let stdinModel = null;
  if (input && input.model != null) {
    const m = input.model;
    if (typeof m === 'object' && m !== null) {
      const v = m.id || m.display_name;
      if (v) stdinModel = String(v);
    } else {
      const v = String(m).trim();
      if (v) stdinModel = v;
    }
  }

  // ── Effort resolution: (a) env var → (b) cascade → (c) unset ────────────────
  const envEffort = (process.env.CLAUDE_CODE_EFFORT_LEVEL || '').trim() || null;

  // Only read cascade for values still missing.
  let cascadeModel, cascadeEffort;
  if (stdinModel === null || envEffort === null) {
    const cascade = resolveCascade(cwd);
    cascadeModel  = cascade.model;
    cascadeEffort = cascade.effortLevel;
  }

  const model       = stdinModel !== null ? stdinModel : cascadeModel;
  const effortLevel = envEffort  !== null ? envEffort  : cascadeEffort;

  const modelClass = classifyModel(model);
  const rank       = effortRank(effortLevel);

  // ── Persistent session state ───────────────────────────────────────────────
  // Write a state file so other hooks (e.g. fable-edit-guard) can read the
  // model class for this session without re-resolving settings.
  try {
    const stateDir = path.join(os.tmpdir(), 'claude-model-guard');
    fs.mkdirSync(stateDir, { recursive: true });

    const rawSid = (input && input.session_id) != null ? String(input.session_id) : 'unknown';
    const sid    = rawSid.replace(/[^A-Za-z0-9_-]/g, '_');
    const stateFile = path.join(stateDir, `${sid}.state.json`);
    const stateData = JSON.stringify({
      session_id:  rawSid,
      model_class: modelClass,
      effort:      effortLevel != null ? String(effortLevel) : null,
      cwd,
      written_at:  Date.now(),
    });
    const tmpFile = stateFile + '.tmp';
    fs.writeFileSync(tmpFile, stateData, 'utf8');
    fs.renameSync(tmpFile, stateFile);

    // Prune state files older than 48 h.
    try {
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      for (const entry of fs.readdirSync(stateDir)) {
        if (!entry.endsWith('.state.json')) continue;
        const fp = path.join(stateDir, entry);
        try {
          const st = fs.statSync(fp);
          if (st.mtimeMs < cutoff) fs.unlinkSync(fp);
        } catch (_) { /* skip unreadable/already-gone entries */ }
      }
    } catch (_) { /* prune failure is non-fatal */ }
  } catch (_) { /* state write failure must never affect hook output */ }

  // Sonnet / Haiku sessions: silent — no policy overhead for worker models.
  if (modelClass === 'sonnet' || modelClass === 'haiku') {
    process.exit(0);
  }

  const parts = [];

  // ── WARN block ─────────────────────────────────────────────────────────────
  // Only on startup / clear so resume / compact don't repeat it.
  if (modelClass === 'fable' && rank > 1 && (source === 'startup' || source === 'clear')) {
    const eff = String(effortLevel);
    parts.push(
      `SESSION_MODEL_GUARD: This session runs on Fable 5 with effortLevel "${eff}" — above the` +
      ` intended "medium" default for Fable orchestrator sessions. Before doing anything else,` +
      ` ask the user with AskUserQuestion (header "Effort", question "Fable 5 is running at` +
      ` effort ${eff} — keep it?") with options: "Keep ${eff}" and "Switch to medium"` +
      ` (if chosen, tell the user to run /effort medium, then continue at their chosen setting).` +
      ` Ask exactly once this session; if AskUserQuestion is unavailable (non-interactive),` +
      ` state the warning once and proceed.`
    );
  }

  // ── POLICY block ───────────────────────────────────────────────────────────
  // Injected on ALL sources (compact/resume lose context and need re-anchoring).
  if (modelClass === 'fable') {
    parts.push(
      `SESSION_MODEL_GUARD policy — Fable 5 session: You are the orchestrator, not the worker.` +
      ` Never Edit/Write from the main thread — even one-line changes go to a coder subagent.` +
      ` Delegate: planning/architecture → the project's Opus architect agents; implementation →` +
      ` Sonnet coders; exploration/mapping/multi-file reading → Haiku (Explore, model: "haiku").` +
      ` Read at most 1–3 targeted files per task yourself (use offset/limit ranges when known;` +
      ` Grep with head_limit); never pull large tool outputs into the main thread. Every dispatch` +
      ` brief must be self-contained — subagents never see this chat: objective, exact paths,` +
      ` findings already gathered, constraints, required output format. Prefer continuing an` +
      ` existing agent (SendMessage) over respawning a new one. If the session model changes` +
      ` mid-session, adopt the policy matching the new model. Your value is judgment per token.`
    );
  } else if (modelClass === 'opus') {
    parts.push(
      `SESSION_MODEL_GUARD policy — Opus session: Keep planning and architecture in the main` +
      ` thread. Delegate implementation to Sonnet coders and broad exploration to Haiku.` +
      ` Exception: trivial micro-edits (one file, a few lines, location already known) may be` +
      ` done directly — dispatch overhead would exceed the savings; anything larger goes through` +
      ` a named coder. Briefs self-contained (objective, exact paths, gathered findings, output` +
      ` format); compact returns; Grep head_limit; ranged reads; continue agents over respawning.` +
      ` If the session model changes mid-session, adopt the matching policy.`
    );
  } else {
    // unknown — model set via CLI flag or fresh install
    parts.push(
      `SESSION_MODEL_GUARD: The session model could not be read from settings (started via CLI` +
      ` flag or fresh install). Identify your model from your system prompt and apply the` +
      ` matching policy: Fable 5 → strict orchestrator (never edit directly; delegate planning` +
      ` to Opus architects, code to Sonnet, exploration to Haiku; 1–3 targeted reads max).` +
      ` Opus → plan in the main thread, delegate implementation to Sonnet and exploration to` +
      ` Haiku (micro-edit exception for tiny known-location changes). If you are Fable 5 and` +
      ` effort appears above medium, mention it to the user once.`
    );
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName:    'SessionStart',
      additionalContext: parts.join('\n\n'),
    }
  }));
  process.exit(0);

} catch (_) {
  // Any unexpected error: silent exit — never crash the session.
  process.exit(0);
}
