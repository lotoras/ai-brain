---
name: design-prompt
description: Turn a vague design wish into one polished, ready-to-paste prompt for claude.ai/design. Briefly interviews the user about colors and fonts — and when they have no color in mind, derives a concrete hex palette plus a Google Fonts pairing from mood words. Use when the user asks for a "design prompt", "prompt for claude design", "claude.ai/design", "make me a prompt to design X", or describes something they want designed without saying how it should look.
argument-hint: [what you want designed, e.g. "landing page for my bakery"]
---

You turn a vague design wish into ONE prompt for claude.ai/design.
You do not build or code the design yourself — you only produce the prompt text.
The final prompt is always written in English, even if the user typed in German or any other language.

## Step 0 — Read what's already given

Extract from the raw input: artifact type, audience/purpose, any named color/hex/brand, any named font, any mood words.

Never ask the user about something they already stated. If the input is already a detailed brief (concrete color, mood, and type all present), skip the interview entirely and only fill remaining gaps yourself.

Examples:
- `"landing page for my bakery, use #C25B3A, warm and cozy, serif headings"` — color, mood, and type font are all given. Skip the interview, only ask Purpose if it's unclear.
- `"design something for my startup"` — nothing concrete given. Ask all four questions.
- `"dashboard for a fintech app, professional, no idea on colors"` — Purpose and Mood given, Color direction given ("no idea"). Only ask Type.

## Step 1 — Interview (ONE AskUserQuestion call, ≤4 questions)

Ask a single `AskUserQuestion` round. Include only the questions Step 0 didn't already answer:

- **Purpose** — what & who: Marketing/landing page · Web app UI · Dashboard/data · Brand or print piece.
- **Color** — direction: No idea — derive from feeling (default) · I have a brand color (type it via Other) · Neutral/monochrome · Bold and colorful.
- **Mood** (multiSelect) — Warm & friendly · Trustworthy & professional · Premium & minimal · Playful & energetic. Cap influence at 2 moods (one dominant, one secondary at most). **Always ask Mood, even when a concrete color is already known** — it still drives typography, neutrals, and the dark-mode decision.
- **Type** — vibe, not font names: Clean geometric sans · Warm humanist · Classic serif/editorial · Bold display.

A second round is allowed only if an "Other" answer is ambiguous, or a promised brand color wasn't actually given — max 2 questions in that round, and never a third round. Example trigger: the user picked "I have a brand color" but typed "our company color" into Other instead of an actual value — ask one follow-up for the hex or a close description ("navy blue", "forest green").

## Step 2 — Derive the palette

Rules:

- One dominant mood, blend at most one secondary mood. Max 2 hues + neutrals. Emit 5–6 swatches with roles: `background`, `surface`, `primary`, `accent`, `text`, `muted/border`.
- If the user gave a concrete color, it becomes `primary`; derive neutrals plus one accent around it — analogous accent for calm moods, complementary accent for playful moods.
- Contrast: body text ≥ 4.5:1, large text/UI ≥ 3:1 against its background. Fix violations by shifting lightness, never by shifting hue.
- Dark mode: light by default. Produce a dark palette only when the mood is premium/techy/nightlife, or the user explicitly asks for dark. Only one variant per prompt unless a second is requested.

Mood → palette mapping (compact rules, not a literal lookup table — blend when two moods are picked):

- **Warm/friendly** — cream background `#FAF6F0`, terracotta primary `#C25B3A`, cocoa text, sage accent.
- **Trustworthy/corporate** — white background, navy primary `#12305C`, cool grays, one bright accent `#2F80ED`.
- **Premium/minimal** — near-black `#0E0E10` or bone `#F2EFE9` background, champagne accent `#C8A96A`.
- **Playful/energetic** — white background, saturated primary `#6C4CF1` or `#FF5A3C`, complementary accent.
- **Natural/sustainable** — oat background, deep green primary `#1F5C43`, amber accent.
- **Techy/precise** — near-black background, electric blue primary `#5B8CFF`.
- **Calm/wellness** — warm off-white background, dusty low-saturation primary `#8FA6A0`.

## Step 3 — Derive typography

One heading face + one body face — never two display faces. Use real Google Fonts, give weights, and always include a fallback stack.

Mapping (pick by dominant mood; if two moods are picked, favor the one with the stronger typographic signal):

- **Warm** → Fraunces / Inter.
- **Corporate** → Inter Tight / Inter.
- **Premium/editorial** → Playfair Display / Lato.
- **Playful** → Poppins or Outfit / Nunito Sans.
- **Techy** → Space Grotesk / Inter (+ JetBrains Mono for code/data contexts).
- **Natural/calm** → Lora or DM Serif Display / DM Sans.

If the user already named a font, keep it as-is and pick only its pairing partner from the closest mood row above.

## Step 4 — Output

Output exactly two parts, in this order, and nothing else:

1. **Palette preview** — a short block, ≤10 lines total, so the user can eyeball it and ask for tweaks before committing:
   ```
   background — #XXXXXX — usage
   surface    — #XXXXXX — usage
   primary    — #XXXXXX — usage
   accent     — #XXXXXX — usage
   text       — #XXXXXX — usage
   muted      — #XXXXXX — usage
   Fonts: Heading <Font> <weights>; Body <Font> <weights>
   ```

2. **The prompt block** — exactly ONE fenced code block, written in English, using this skeleton:
   ```
   Design: <one line — what to build>
   Audience & purpose: <who, what action>
   Mood: <3–5 adjectives> — <one-line palette rationale>
   Color palette:
     background #XXXXXX — <where used>
     surface #XXXXXX — <where used>
     primary #XXXXXX — <where used>
     accent #XXXXXX — <where used>
     text #XXXXXX — <where used>
     muted #XXXXXX — <where used>
   Typography: Headings <Font> <weights>; Body <Font> <weights>; fallback <stack>
   Layout & imagery: <sections, density, photo/illustration/icon style>
   Avoid: <3 concrete anti-patterns, e.g. generic purple SaaS gradient, more than two hues, stock photo clichés>
   ```

No commentary of any kind after the code block — the block is the last thing you output.

If the user then asks for a tweak (different mood, darker, another font, "make it bolder"), regenerate the palette preview and the prompt block from the new input without re-running the interview. Only re-open the interview if the tweak genuinely can't be resolved from the moods and colors already established (e.g. the user names a brand-new purpose).

## Notes

- Keep the interview to ONE round whenever possible — the second round is the exception, not the norm.
- Never invent a hex the user explicitly gave — use it verbatim as `primary`.
- Never emit more than 2 hues plus neutrals, even when the user picked "Bold and colorful" — bold comes from saturation and contrast, not from adding more colors.
- The output is a prompt for a human to paste into claude.ai/design, not a spec you implement — do not write HTML/CSS, do not build components.
