# Fork metadata

**Upstream:** obra/superpowers via superpowers-marketplace  
**Upstream version:** 5.1.0  
**Fork version:** 5.1.0-fork.1

## Local diff surface

- `hooks/session-start` — modified: reads stdin model, falls back to settings cascade, selects CONDENSED.md for fable/sonnet/haiku and SKILL.md for opus/unknown.
- `skills/using-superpowers/CONDENSED.md` — added: token-efficient version of the using-superpowers skill for smaller/faster models.
- Pruned from upstream: `tests/`, `docs/plans/`, `scripts/`, `assets/`, `gemini-extension.json`, `AGENTS.md`, `GEMINI.md`, `RELEASE-NOTES.md`, `CODE_OF_CONDUCT.md`, `package.json`.

## Re-sync procedure

1. Copy the new upstream version from the marketplace cache over `plugins/superpowers/` (all files).
2. Re-apply the `hooks/session-start` patch (the model-detection block at the top, and the content-file selection block replacing the hardcoded SKILL.md read).
3. Keep `skills/using-superpowers/CONDENSED.md` — upstream will not have it.
4. Update the upstream version recorded above and bump fork patch version (e.g. `5.2.0-fork.1`).
5. Update `plugins/superpowers/.claude-plugin/plugin.json` version accordingly.
