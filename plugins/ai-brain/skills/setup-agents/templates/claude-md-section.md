## Workflow

**For any change request, follow `.claude/rules/workflow.md`** — understand the code first, plan
the minimal change, delegate to sub-agents, then verify.

**All code edits MUST go through sub-agents — no direct `Edit` / `Write` from the main thread, even
for one-line changes.** The main Claude plans and verifies only. Dispatch by layer:
{{DISPATCH_LIST}}

**Model policy:** domain architects run on **Fable 5** (planning/thinking); test planners
({{TEST_PLANNER_NAMES}}) stay on **Opus** for now; all coders execute on **Sonnet**; exploration is
always **Haiku** (`Explore` / `general-purpose` with `model: "haiku"`). The after-task
simplify/review pass is handled by the global threebrain Stop hook — its routing lives there, not
here.

Multi-layer changes dispatch multiple coders **in parallel** (single message, multiple `Agent` tool
calls). See `.claude/rules/workflow.md` → "Reading discipline" for the full reading rule.
