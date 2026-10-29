---
name: chat-log
description: Use when the user asks about their own past Claude Code work — "did I do this before?", "remember when I…", "I did something like this lately, you remember?", "last time I…", "what did I work on (yesterday / last week / in <project>)?", "find it in my chat log", "how did I fix X back then?", "do it like I did in <project>", "redo that change here / there". Searches the cross-device chat log (~/.claude/chat-log, private GitHub repo lotoras/claude-chat-log, written by the chat-log Stop hook after every code-changing turn), answers with date, project and what was done, and can re-apply a logged change in another project.
---

# Chat log recall

The `chat-log` Stop hook appends one block per code-changing turn to a local git clone that every
device syncs through the private repo `lotoras/claude-chat-log`. Read-only and Q&A turns are not
logged.

## Layout (verified)
- Clone: `~/.claude/chat-log`. Resolve `~` to the absolute home path for Grep/Read
  (Windows: `C:/Users/<user>/.claude/chat-log`).
- One file per session per day: `<YYYY>/<MM>/<DD>/<project>--<session8>.md`.
- First line: `# <project> · <YYYY-MM-DD> · <device>`.
- One block per turn, keyed `<!-- turn:<uuid> -->` … `<!-- /turn -->`, containing:
  ```
  ## HH:MM · <first prompt line>
  - **Where:** `<cwd>` · <branch> @ <short sha> (dirty) · <remote url>
  - **Files:** <paths, relative to the repo root>
  **Prompt:** <user prompt, ≤1500 chars>
  **Result:** <Claude's final reply of that turn, ≤1500 chars>
  ```

## 1. Refresh
```bash
git -C ~/.claude/chat-log pull --ff-only -q
```
If this fails (offline, no auth), say so in one line and search the local copy anyway. If the clone
doesn't exist, tell the user to re-run `setup/setup.ps1` / `setup/setup.sh` (it clones the repo),
then stop.

## 2. Find candidates
- **Timeline:** Grep `^## ` with `output_mode: content` in the clone, narrowed by `glob`. Examples:
  `2026/10/**/*.md` for a month, `**/ai-brain--*.md` for a project. Each hit is
  `path:line:## HH:MM · title`, and the path carries the date and project.
- **Keyword:** Grep with `-i: true`. Use the user's words plus synonyms and likely file/tool names,
  e.g. "ssh guard" → `ssh-guard|ssh guard|pageant|plink`. Add `-C: 6` to see the surrounding block.
- When several turns match, prefer the most recent, and use the project if the user named one.

## 3. Read and answer
Read the matched blocks: just the lines between the `<!-- turn:` marker and `<!-- /turn -->`, not
the whole file. Answer briefly:
- the date and time, project and device;
- what was asked and what was done (from Prompt / Result / Files);
- a link to the file: `https://github.com/lotoras/claude-chat-log/blob/main/<path>`.

If nothing matches, say so and show the 5 nearest timeline headings instead of guessing. Never
invent past work.

## 4. Redo it here / there
When the user wants the logged change applied somewhere else:
1. **Locate the original code** from the `Where` line:
   - the logged cwd exists on this device → read the listed Files there; `git -C <cwd> show <sha>`
     helps when the line isn't marked `(dirty)`;
   - otherwise → use the remote: `gh api repos/<owner>/<repo>/contents/<file>?ref=<branch>` or a
     shallow clone into the scratchpad.
2. **Confirm the target project** (the current cwd or the one the user named) and restate the change
   in one line.
3. **Apply the equivalent change** with the target project's conventions, then run that project's
   checks as usual. Adapt the change; don't copy paths blindly.

## Notes
- The log is private. Don't paste whole blocks into public places.
- Secrets of common shapes were redacted at write time (`[REDACTED]`). Never try to recover them.
- Work on the log itself (cwd inside the clone) is never logged.
