'use strict';
/*
 * lib/transcript.js — transcript helpers shared by the Stop hooks
 * (threebrain-after-task.js, chat-log.js). Node built-ins only; every helper is
 * fail-silent (a missing or unreadable file reads as "nothing found").
 *
 * Subagent turns are NOT in the main transcript. They live in
 *   <dir of transcript_path>/<transcript basename without .jsonl>/subagents/agent-<agentId>.jsonl
 * next to an agent-<agentId>.meta.json (background Bash tasks have no meta file).
 */

const fs = require('fs');
const path = require('path');

const MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
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

// Record a mutating tool_use's target path (file_path, or notebook_path for NotebookEdit).
function collectPaths(part, paths) {
  const inp = part.input || {};
  [inp.file_path, inp.notebook_path].forEach(function (p) {
    if (typeof p === 'string' && p) paths.push(p.replace(/\\/g, '/'));
  });
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

// Read one subagent transcript and report its mutating tool_use at/after `since`
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
        if (part && part.type === 'tool_use' && MUTATING_TOOLS.has(part.name)) {
          found = true;
          collectPaths(part, paths);
        }
      }
    }
  } catch (_) { /* missing subagent file: nothing to add */ }
  return found;
}

module.exports = {
  MUTATING_TOOLS, SAFE_AGENT_ID, textOf, isTypedTurn, collectPaths,
  subagentPath, isAgent, notifiedAgentIds, scanSubagent
};
