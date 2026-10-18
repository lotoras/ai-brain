---
colors:
  background: "<#hex>"
  surface: "<#hex>"
  primary: "<#hex>"
  accent: "<#hex>"
  text: "<#hex>"
  muted: "<#hex>"
  neutral-100: "<#hex>"
  neutral-200: "<#hex>"
  neutral-300: "<#hex>"
  neutral-400: "<#hex>"
  neutral-500: "<#hex>"
  neutral-600: "<#hex>"
  neutral-700: "<#hex>"
  neutral-800: "<#hex>"
  neutral-900: "<#hex>"
typography:
  h1:
    fontFamily: "<heading font>, <fallback stack>"
    fontSize: "<size>"
    fontWeight: "<weight>"
    lineHeight: "<line-height>"
  h2:
    fontFamily: "<heading font>, <fallback stack>"
    fontSize: "<size>"
    fontWeight: "<weight>"
    lineHeight: "<line-height>"
  h3:
    fontFamily: "<heading font>, <fallback stack>"
    fontSize: "<size>"
    fontWeight: "<weight>"
    lineHeight: "<line-height>"
  body:
    fontFamily: "<body font>, <fallback stack>"
    fontSize: "<16–18px>"
    fontWeight: "<weight>"
    lineHeight: "<1.5–1.6>"
  small:
    fontFamily: "<body font>, <fallback stack>"
    fontSize: "<size>"
    fontWeight: "<weight>"
    lineHeight: "<line-height>"
rounded:
  sm: "<0–8px>"
  md: "<0–8px, equal to sm when one radius is enough>"
spacing:
  base: "<4px or 8px>"
  gutter: "<multiple of base>"
  section-desktop: "<96–160px>"
  section-mobile: "<56–80px>"
motion: "<none | subtle | expressive>"
---

## Overview

<Site name> is <what it is> for <audience>. The one thing a visitor should do is <primary action>.

The direction is <style direction>: <3–5 adjectives>. <One sentence on what makes this site look like itself and not like a template.>

This file is the base styling. Where a request conflicts with it, this file wins unless the request says otherwise.

## Colors

<Light or dark> theme. Two hues at most, plus neutrals.

| Role | Hex | Use |
|---|---|---|
| background | <#hex> | <where used> |
| surface | <#hex> | <where used> |
| primary | <#hex> | <where used> |
| accent | <#hex> | <where used; the only accent> |
| text | <#hex> | <where used> |
| muted | <#hex> | <where used> |

Neutrals run from `neutral-100` to `neutral-900`, tinted toward <primary hue>. Body text holds at least 4.5:1 against its background, large text and UI at least 3:1.

## Typography

Headings in <heading font> <weights>, body in <body font> <weights>. No third typeface.

Scale ratio <ratio>, body <size> at line-height <value>. Lines run 45–75 characters.

Headings are sentence case, one colour, one weight. <One sentence on how emphasis is made: size, weight or wording.>

## Layout

<Grid: columns, max width, alignment>. Left-aligned by default.

Spacing uses a <4px or 8px> base. Sections are padded <value> on desktop and <value> on mobile.

Density limits, treated as hard caps:

| Limit | Value |
|---|---|
| Sections on the home page | <n> |
| Items per group | <n>, unless the content is inherently a list |
| Sections that carry a heading | at most <n>% |
| Words per text block | <n> |

When unsure whether a section or an item belongs, remove one.

Imagery: <photography, illustration, or none and type-led>. <One sentence on how it is cropped and placed.>

## Elevation & Depth

Borders before shadows. Separation comes from whitespace first, then a 1px rule in <muted hex>.

<Either "One shadow exists, for overlays only: value." or "No shadows at all."> No gradients, glows or blur.

## Shapes

Radius <value> on <what>; <second radius and what it is for, or "no second radius">.

Borders are <width> in the same muted colour as the rules. Icons are functional only: <which ones the site needs, or "none">.

## Components

Buttons: <fill, text colour, radius, padding>. The label is a verb with no arrow. One primary action per view; a second action is a text link.

Links: <colour, underline rule, hover>.

Navigation: <structure, number of items, position>.

Cards: <the single card style, and the only content it is used for; or "no cards">.

Lists: plain text rows, a table or a definition list, with no markers.

Forms: <field border, focus state, label position>.

Motion: <the one load sequence or one ambient hero/banner motion>. Everything else moves only in response to the user; scroll-driven motion counts as user-driven. The `motion` level in the front matter caps it: `none` is static only, `subtle` one effect with no loop faster than 6s, `expressive` one ambient effect plus scroll choreography.

## Do's and Don'ts

| Instead of | Do |
|---|---|
| Adding another section or a fourth item | Stay inside the limits in Layout and cut one |
| A title on every block, or eyebrow + heading + subheading | A heading only where it aids navigation; at most one eyebrow per page, carrying real information |
| An icon or dot beside each line, or a three-column icon grid | One or two features shown large with real content, a text-beside-media split, or a plain list with no markers |
| <secondary tell most likely for this site> | <its replacement> |
| <secondary tell> | <its replacement> |
| <secondary tell> | <its replacement> |
