'use strict';
/*
 * lib/transcript.js — transcript helpers shared by the Stop hooks
 * (threebrain-after-task.js, chat-log.js). Node built-ins only; every helper is
 * fail-silent (a missing or unreadable file reads as "nothing found").
 *
 * "Changed code" means a mutating tool_use (Edit / Write / MultiEdit / NotebookEdit) with at
 * least one target path outside Claude's per-session scratchpad
 * (<tmp>/claude/<project>/<session uuid>/scratchpad/...): scratchpad files are throwaway
 * (explainer pages, probes), so a scratchpad-only write is not a code change.
 *
 * Subagent turns are NOT in the main transcript. They live in
 *   <dir of transcript_path>/<transcript basename without .jsonl>/subagents/agent-<agentId>.jsonl
 * next to an agent-<agentId>.meta.json (background Bash tasks have no meta file).
 */

const fs = require('fs');
const path = require('path');

const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Claude's per-session scratchpad (<tmp>/claude/<project>/<session uuid>/scratchpad/...).
const SCRATCHPAD = /\/claude\/[^/]+\/[0-9a-f-]{36}\/scratchpad\//i;
// Agent ids end up in a file name: accept only plain id characters (no path separators).
const SAFE_AGENT_ID = /^[A-Za-z0-9_.-]+$/;

// The record's plain text: the string content, or all text blocks joined.
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(function (p) {
      return p && p.type === 'text' && typeof p.text === 'string' ? p.text : '';
    }).join('\n');
  }
  return '';
}

// User content that carries typed text: plain-string content, or an array with a
// real text block (e.g. a message with an attachment) — NOT only tool_result blocks.
function isTypedTurn(content) {
  return typeof content === 'string'
    || (Array.isArray(content) && content.some(function (p) { return p && p.type === 'text'; }));
}

// A real user prompt: a non-isMeta user record with typed text. Skill bodies and Stop-hook
// feedback are isMeta, so they never end a lookback window.
function isPrompt(rec) {
  return !!rec && rec.type === 'user' && !rec.isMeta && isTypedTurn(rec.message && rec.message.content);
}

// A mutating tool_use that touches at least one file outside the scratchpad (a call with no
// path counts). Pushes its non-scratchpad target paths (file_path / notebook_path, `\` → `/`).
function projectMutation(part, paths) {
  if (!part || part.type !== 'tool_use' || !MUTATING_TOOLS.has(part.name)) return false;
  const inp = part.input || {};
  let any = false, kept = false;
  [inp.file_path, inp.notebook_path].forEach(function (p) {
    if (typeof p !== 'string' || !p) return;
    any = true;
    p = p.replace(/\\/g, '/');
    if (!SCRATCHPAD.test(p)) { kept = true; paths.push(p); }
  });
  return !any || kept;
}

// <dir of transcript>/<session>/subagents/<name>
function subagentPath(tpath, name) {
  return path.join(path.dirname(tpath), path.basename(tpath, '.jsonl'), 'subagents', name);
}

// True only for a real subagent: it has an agent-<id>.meta.json next to its transcript.
// Background Bash tasks also emit <task-notification>/<task-id> but have no such file.
function isAgent(tpath, id) {
  try { return SAFE_AGENT_ID.test(id) && fs.existsSync(subagentPath(tpath, 'agent-' + id + '.meta.json')); }
  catch (_) { return false; }
}

// Subagent ids named by <task-id> in a <task-notification> text (Bash task ids filtered out).
function notifiedAgentIds(tpath, text) {
  const ids = [];
  const re = /<task-id>([^<]+)<\/task-id>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = m[1].trim();
    if (isAgent(tpath, id)) ids.push(id);
  }
  return ids;
}

// Read one subagent transcript and report its project mutation at/after `since`
// (ms epoch; NaN = no boundary, count all). Missing/unreadable file -> nothing.
function scanSubagent(tpath, agentId, since, paths) {
  let found = false;
  try {
    const file = subagentPath(tpath, 'agent-' + agentId + '.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      if (!line || !line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch (_) { continue; }
      const c = rec && rec.message && rec.message.content;
      if (!rec || rec.type !== 'assistant' || !Array.isArray(c)) continue;
      if (!isNaN(since)) {
        const t = Date.parse(rec.timestamp);
        if (isNaN(t) || t < since) continue; // unknowable age -> don't count (allow-list)
      }
      for (const part of c) {
        if (projectMutation(part, paths)) found = true;
      }
    }
  } catch (_) { /* missing subagent file: nothing to add */ }
  return found;
}

module.exports = {
  SAFE_AGENT_ID, textOf, isPrompt, projectMutation,
  subagentPath, isAgent, notifiedAgentIds, scanSubagent
};
