---
name: site-style
description: Set the base styling for a new website or web project, or turn a vague design wish into one ready-to-paste prompt, for claude.ai/design or the local claude-designs toolkit — briefly interviewing about color, style direction and fonts, deriving a hex palette plus a Google Fonts pairing, and overriding the generic AI look (too many sections, a title on everything, icon-and-text lists). Foundation mode writes a DESIGN.md file; prompt mode outputs one prompt block. Use when the user asks for "base styling", "site style", a "styling foundation for a new website / web project", "DESIGN.md", a "design system starter", a "design prompt", "prompt for claude design", "claude.ai/design", "make me a prompt to design X", or describes something they want designed without saying how it should look.
argument-hint: [what you want styled or designed — e.g. base styling for my studio site, or a landing page for my bakery]
---

You turn a vague design wish into input for claude.ai/design: either a `./DESIGN.md` base-styling file for a whole site (foundation mode) or ONE prompt for a single artifact (prompt mode).
You do not build or code the design yourself — you only produce the file or the prompt text.
The output is always written in English, even if the user typed in German or any other language.

Colocated files, relative to this skill's base directory:

- `references/anti-defaults.md` — the banned patterns with their replacements, the numeric caps, the foundation defaults and the six style directions.
- `templates/DESIGN.md` — the foundation file skeleton.

## Step 0 — Read what's already given, pick the mode

Extract from the raw input: artifact type, audience/purpose, any named color/hex/brand, any named font, any mood words, any style direction.

Pick the mode:

- **Foundation mode** — the request is about a whole site or project, or names base styling / a styling foundation / `DESIGN.md` / a design system starter. Output is the `./DESIGN.md` file.
- **Prompt mode** — the request is one artifact (a landing page, a poster, a dashboard screen). Output is a palette preview plus one fenced prompt block, no file.
- If unclear: a whole site means foundation, a single thing means prompt. Do not ask which mode.

Detect **local mode** (the claude-designs toolkit, the local replacement for claude.ai/design, which closes 2026-12-14). It only changes the **target path** foundation mode writes to and what it prints last:

- cwd has `design.json` (a `design/<slug>` branch) — write `project/DESIGN.md`.
- cwd is the claude-designs toolkit on main (has `design-systems/` and `templates/`, no `design.json`) — write `design-systems/<slug>/DESIGN.md`, with `<slug>` a short kebab-case name derived from the purpose.
- Neither — claude.ai mode: write `./DESIGN.md`.

Never ask the user about something they already stated. If the input is already a detailed brief (concrete color, mood, and type all present), skip the interview entirely and only fill remaining gaps yourself.

Examples:
- `"landing page for my bakery, use #C25B3A, warm and cozy, serif headings"` — prompt mode; color, mood, and type font are all given. Skip the styling questions (Color/Mood/Type); ask only Purpose, and only if it's unclear.
- `"design something for my startup"` — prompt mode; nothing concrete given. Ask all four questions.
- `"dashboard for a fintech app, professional, no idea on colors"` — prompt mode; Purpose and Mood given, Color direction given ("no idea"). Only ask Type.
- `"base styling for a new site for a small architecture studio, swiss-minimal, no colour idea"` — foundation mode; Purpose, Style direction and Color direction given. Round 1 asks only Theme; Purpose is asked only if the one thing a visitor should do is still unclear.

## Step 1 — Interview

`AskUserQuestion` takes at most 4 questions per call and at most 4 options per question. Include only the questions Step 0 didn't already answer.

### Prompt mode (at most ONE AskUserQuestion call, ≤4 questions)

Ask at most one `AskUserQuestion` round — zero if Step 0 already answered everything, one otherwise:

- **Purpose** — what & who: Marketing/landing page · Web app UI · Dashboard/data · Brand or print piece.
- **Color** — direction: No idea — derive from feeling (default) · I have a brand color (type it via Other) · Neutral/monochrome · Bold and colorful.
- **Mood** (multiSelect) — Warm & friendly · Trustworthy & professional · Premium & minimal · Playful & energetic. **Always ask, even when a concrete color is already known** — it still drives typography, neutrals, and the dark-mode decision. Skip it like any other question only when the user already stated the mood themselves.
- **Type** — vibe, not font names: Clean geometric sans · Warm humanist · Classic serif/editorial · Bold display.

A second round is allowed only if an "Other" answer is ambiguous, or a promised brand color wasn't actually given — max 2 questions in that round, and never a third. Example: the user picked "I have a brand color" but typed "our company color" into Other — ask one follow-up for the hex or a close description ("navy blue", "forest green").

### Foundation mode (at most TWO AskUserQuestion calls, ≤4 questions each)

Round 1:

- **Purpose** — what the site is for and the one thing a visitor should do: Marketing site — get enquiries or sign-ups · Shop — sell products · Portfolio or studio — show the work · Web app or product — get people using it.
- **Style direction** — Editorial · Swiss-minimal · Warm-organic · Technical-mono. Name Brutalist and Luxury in the question text as available through Other. The one-line traits per direction are in `references/anti-defaults.md`; use them as the option descriptions.
- **Color** — same four options as prompt mode.
- **Theme** — Light · Dark · Let the direction decide.

Round 2, only for what is still open:

- **Type** — same four options as prompt mode.
- **Content volume** — Sparse · Medium · Dense.
- **Imagery** — Photography · Illustration · None, type-led.

Never a third round. An ambiguous "Other" answer or a promised-but-missing brand color is resolved inside round 2; if round 2 is already spent, pick the closest reading yourself and say so in the palette preview.

In foundation mode the style direction is the dominant mood for Steps 2 and 3; mood words from Step 0 blend in as the secondary mood.

## Step 2 — Derive the palette

Rules (both modes):

- One dominant mood, blend at most one secondary mood. Max 2 hues + neutrals — even "Bold and colorful" gets its punch from saturation and contrast, never from more hues. Emit swatches for six roles: `background`, `surface`, `primary`, `accent`, `text`, `muted/border` — that's 5–6 swatches, since `surface` may merge into `background` (giving 5) when the design doesn't need elevation.
- If the user gave a concrete color, use it verbatim as `primary` (never substitute an invented hex); derive neutrals plus one accent around it — analogous accent for calm moods, complementary accent for playful moods.
- Contrast: body text ≥ 4.5:1, large text/UI ≥ 3:1 against its background. Fix violations by shifting lightness, never by shifting hue.
- Dark mode: light by default. Produce a dark palette only when the mood is premium/techy/nightlife, or the user explicitly asks for dark. Only one variant per output unless a second is requested. In foundation mode the Theme answer decides; "Let the direction decide" falls back to this rule.
- Foundation mode only: also emit a 9-step neutral ramp (`neutral-100` to `neutral-900`), tinted toward the primary hue, with `background`, `text` and `muted` taken from or sitting next to steps on it. When the direction is near-monochrome (Swiss-minimal, Brutalist, Technical-mono), `primary` may be the dark ink neutral and `accent` the single saturated colour.

Mood → palette mapping. These rows are starting points to vary from, not values to copy: shift every hex (hue by a few degrees, lightness, saturation) to suit the actual subject, unless the user supplied the hex. Blend when two moods are picked. The rows below the first four cover mood words taken straight from the user's own wording in Step 0, not just the four interview options:

- **Warm/friendly** — a warm light background around `#FAF6F0`, an earthy primary around `#C25B3A` (or an ochre, plum or deep teal that fits the subject better), dark warm text, one muted cool accent.
- **Trustworthy/corporate** — white or cool off-white background, a deep blue-leaning primary around `#12305C`, cool grays, one bright accent around `#2F80ED`.
- **Premium/minimal** — a deep neutral around `#0E0E10` or a pale stone around `#F2EFE9` for the background, one restrained accent around `#C8A96A`.
- **Playful/energetic** — white background, a saturated primary around `#6C4CF1` or `#FF5A3C` (pick the hue from the subject, not from this row), complementary accent.
- **Natural/sustainable** — oat background, deep green primary around `#1F5C43`, amber accent.
- **Techy/precise** — dark or very light cool background, a clear signal primary around `#5B8CFF`.
- **Calm/wellness** — warm off-white background, dusty low-saturation primary around `#8FA6A0`.

In foundation mode, the colour trait of the chosen style direction in `references/anti-defaults.md` takes precedence over these rows.

Convergence trap: cream + terracotta + serif, near-black + acid accent, Space Grotesk, and Inter everywhere are the recognisable defaults. Do not land on any of them unless the user asked for it, and do not escape one by swapping in another — derive from the subject instead.

## Step 3 — Derive typography

One heading face + one body face — never two display faces. Use real Google Fonts, give weights, and always include a fallback stack.

Mapping (pick by dominant mood; if two moods are picked, favor the one with the stronger typographic signal). Each row lists options, not a fixed pair: choose the heading and the body for this subject, and do not reuse the same pair by habit:

- **Warm** → headings Fraunces, Young Serif or Bricolage Grotesque / body Source Sans 3, Nunito Sans or Figtree.
- **Corporate** → headings Inter Tight, IBM Plex Sans or Public Sans / body IBM Plex Sans, Public Sans or Source Sans 3.
- **Premium/editorial** → headings Playfair Display, Cormorant Garamond or Newsreader / body Lato, Work Sans or Karla.
- **Playful** → headings Poppins, Outfit or Bricolage Grotesque / body Nunito Sans, DM Sans or Figtree.
- **Techy** → headings Sora, IBM Plex Sans or Space Grotesk / body Manrope, IBM Plex Sans or Atkinson Hyperlegible (+ JetBrains Mono for code/data contexts).
- **Natural/calm** → headings Lora or DM Serif Display / body DM Sans, Mulish or Work Sans.

In foundation mode, the type trait of the chosen style direction in `references/anti-defaults.md` takes precedence; pick the closest row above for concrete faces. When the direction calls for a single family (Swiss-minimal), use the same face for headings and body in two weights. Take scale ratio, body size and line-height from the foundation defaults in the same file.

If the user already named a font, keep it verbatim as-is — even if it's not a Google Font — and pick only its pairing partner from the closest mood row above; only that pairing partner must be a real Google Font.

## Step 4 — Output

### Prompt mode

Read `references/anti-defaults.md` first. Then output exactly two parts, in this order, and nothing else:

1. **Palette preview** — a short block in its own fence (it does not count as the prompt block), ≤10 lines total, emitted together with the prompt block in the same response (never wait for approval between the two parts) so the user can eyeball it and easily ask for tweaks afterwards:
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
   Avoid: <3 anti-patterns from references/anti-defaults.md, each written as "no X — instead Y">
   ```

   For the `Avoid:` line, default to the three priority overrides; swap one for a secondary tell only when that tell is the likelier failure for this artifact. Never list a ban without its replacement. Phrase the first override with its number, e.g. "no more than 5 sections or 3 items per group — instead cut one".

No commentary of any kind after the code block — the block is the last thing you output.

### Foundation mode

1. Read `templates/DESIGN.md` and `references/anti-defaults.md`.
2. Check the target path from Step 0 for an existing `DESIGN.md`. If one exists, say in one or two lines what it is (its direction, primary color, last-modified date) and ask before overwriting. This confirmation is not an interview round. Stop if the user declines.
3. Fill the template and write it to the target path:
   - Replace every `<placeholder>`, in the YAML front matter and in the body. None may remain in the written file.
   - Keep the eight sections exactly once each, in the template's order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts. Add no other sections.
   - Set the Layout limits from the numeric caps, in the column matching the Content volume answer (Medium when it wasn't asked).
   - Take shape, layout and elevation values from the chosen style direction's traits; fall back to the foundation defaults for anything the direction leaves open.
   - Keep the three priority-override rows in Do's and Don'ts as they are, and fill the three open rows with the secondary tells most likely for this site, each with its replacement.
   - Fill the `motion` front-matter key (and the Motion line in Components): default `subtle`; `expressive` for Brutalist or Technical-mono direction, or a Playful mood; `none` only if the user asks for no motion.
   - The file obeys its own rules: no eyebrow labels, no icon or emoji bullets, short sections.
4. Output exactly three parts in chat, in this order, and nothing else:
   1. The palette preview, same ≤10-line format as prompt mode.
   2. The path of the written file.
   3. Exactly ONE fenced code block holding the kickoff line to paste into claude.ai/design alongside the attached file:
      ```
      Use the attached DESIGN.md as the base styling for everything in this project. Treat its limits and its Do's and Don'ts as hard rules. Start with: <first page or screen to design>.
      ```
      In local mode, the block is instead a local kickoff (no attachment, no claude.ai paste instruction):
      ```
      Use <path> as the base styling for everything in this project. Treat its limits and its Do's and Don'ts as hard rules. Start with: <first page or screen>.
      ```

No commentary of any kind after the code block — the block is the last thing you output.

### Tweaks (both modes)

If the user then asks for a tweak (different mood, darker, another font, "make it bolder"), regenerate the output from the new input without re-running the interview: the palette preview plus the prompt block in prompt mode; the rewritten `DESIGN.md` (same target path), the palette preview and the kickoff block in foundation mode (no overwrite confirmation for a file this skill just wrote). Only re-open the interview if the tweak genuinely can't be resolved from the moods and colors already established (e.g. the user names a brand-new purpose).
