---
name: Knot
description: A voice-first personal ledger — warm ink, one gold, numbers you can trust.
colors:
  ink-black: "#0c0a08"
  ink-card: "#26221e"
  ink-raised: "#39352e"
  parchment: "#faf7f0"
  parchment-card: "#ffffff"
  parchment-raised: "#f2ede2"
  bone: "#f5f1e8"
  bone-secondary: "#b5ad9f"
  bone-muted: "#a8a197"
  soot: "#1a1712"
  soot-secondary: "#5c5548"
  soot-muted: "#6f6759"
  signal-gold: "#e0a93a"
  signal-gold-ink-light: "#8a6410"
  ledger-green: "#50ac6d"
  ledger-green-light: "#1f7a45"
  ledger-red: "#e08170"
  ledger-red-light: "#b4402b"
  ledger-amber: "#d58846"
  ledger-amber-light: "#9a5512"
  ledger-blue: "#6ba6e0"
  ledger-blue-light: "#2a6bb8"
  ochre: "#c08a2f"
  ochre-light: "#a07b2a"
  clay-rose: "#c9695f"
  clay-rose-light: "#a8443a"
  deep-teal: "#3f8f96"
  deep-teal-light: "#256b74"
  spend-neutral: "#a8846d"
  spend-neutral-light: "#8a6450"
  residue: "#8a8172"
  hairline: "#524b42"
  hairline-light: "#e8e1d3"
typography:
  display:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "clamp(2.125rem, 5vw, 4.625rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "0.005em"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.08em"
  figure:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    fontFeature: "tabular-nums"
    letterSpacing: "-0.01em"
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  control: "8px"
  card: "12px"
  surface: "16px"
  pill: "999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "40px"
components:
  card:
    backgroundColor: "{colors.ink-card}"
    rounded: "{rounded.card}"
    padding: "12px"
  card-hero:
    backgroundColor: "{colors.ink-card}"
    rounded: "{rounded.card}"
    padding: "16px"
  button-primary:
    backgroundColor: "{colors.signal-gold}"
    textColor: "{colors.soot}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-ghost:
    textColor: "{colors.bone-secondary}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  pill:
    rounded: "{rounded.pill}"
    padding: "4px 10px"
    typography: "{typography.label}"
---

# Design System: Knot

## Overview

**Creative North Star — The Ledger Desk at Night.**

A warm, low-light writing surface: black-brown paper, bone ink, and one lamp.
Knot is a double-entry ledger you talk to, so the interface has to feel like
something that keeps records rather than something that visualises them. The
reference is a physical ledger — ruled lines, tabular figures, a serif hand for
the headings — lit by a single warm source.

Mood: composed, warm, exact, unhurried. The product's whole claim is that no
number was invented, so the design's job is to make figures look *kept* rather
than *rendered*. Restraint is the brand.

**Anti-reference:** the cold neon fintech dashboard — saturated blue/violet
charts on near-black, glowing cards, every metric a hero. Knot is warm, not
cold; ruled, not glowing.

## Colors

The palette is warm-neutral with **exactly one accent**. Everything that is not
ink or paper must justify its hue.

### Primary

- **Signal Gold** (`#e0a93a`): the only accent, and it is rationed. Gold appears
  as a 1px rule almost everywhere and as a *fill* exactly once per screen — the
  single primary action. A second gold fill in one view is a bug. In light mode
  text-weight gold darkens to `#8a6410`; the fill stays `#e0a93a`.

### Neutral

- **Ink Black** (`#0c0a08`) / **Parchment** (`#faf7f0`): the page.
- **Ink Card** (`#26221e`) / **Parchment Card** (`#ffffff`): objects on the page.
- **Ink Raised** (`#39352e`) / **Parchment Raised** (`#f2ede2`): tracks, inputs,
  hover. Never a text background — it is the recessed surface.
- **Bone** `#f5f1e8` → **Bone Secondary** `#b5ad9f` → **Bone Muted** `#a8a197`
  (light: `#1a1712` → `#5c5548` → `#6f6759`). Three ink levels, no more. Every
  one clears 4.5:1 on all three surfaces in both themes.

### Status

Reserved, never reused as a data colour: **Ledger Green** `#50ac6d`,
**Ledger Red** `#e08170`, **Ledger Amber** `#d58846`, **Ledger Blue** `#6ba6e0`
(light: `#1f7a45`, `#b4402b`, `#9a5512`, `#2a6bb8`). Each clears 4.5:1 against
both its own soft tint and the card. Status always ships with a word or a shape
as well — colour is never the only carrier.

### Categorical (spending groups)

One warm family plus a single cool anchor, so charts belong to the same room as
the rest of the product:

- **Ochre** `#c08a2f` (light `#a07b2a`) — essentials
- **Clay Rose** `#c9695f` (light `#a8443a`) — discretionary
- **Ledger Green** — savings, investments and income share one hue on purpose:
  money that stayed yours
- **Deep Teal** `#3f8f96` (light `#256b74`) — debt service, the one cool anchor
- **Spend Neutral** `#a8846d` (light `#8a6450`) — undifferentiated daily spend
- **Residue** `#8a8172` — the `other` bucket, deliberately achromatic

Worst pairwise separation is 11.0 in dark and 9.9 in light (OKLab ×100), above
the 8 floor this project accepts *because every bar carries an adjacent label*.
Every category clears 3:1 against both card and page as a graphical object.

Colour follows the entity, never the rank: a filter that changes what is on
screen must not repaint the survivors.

### Heat

A single-hue orange ramp for the spending heatmap, stepped evenly in OKLCH.
Magnitude is one hue getting darker — never a rainbow, and an investing day is
marked with a green ring rather than heat, because putting money into an SIP is
not a bad day.

## Typography

Two families, and the split is load-bearing.

- **Instrument Serif** is the *display* voice: the wordmark, page titles, landing
  headlines. It is what makes the product read as drawn rather than typed. Never
  below ~28px, never body copy, and **never a number** — a serif figure in a
  ledger reads as decoration.
- **Geist** carries everything else, and **Geist Mono** carries code, identifiers
  and machine output only.

Roles, and the rule each one earns:

| Role | Size | Weight | Use |
|---|---|---|---|
| `display` | 34–74px | 400 serif | landing headlines, page titles |
| `figure` | 20–40px | 600 tabular | the number a card exists to show |
| `body` | 15px | 400 | sentences |
| `ui` | 13px | 400 | dense rows, secondary values |
| `label` | 11px | 500, 0.08em, upper | card titles, axis and stat labels |

**Money is always tabular**, and its symbol, decimal point and minor unit render
at 0.62em / 70% opacity so the figure reads as the figure. A negative amount
always shows its sign — colour is never the only carrier.

Two treatments must never be one step apart. If two things sit at the same size,
they differ by weight or by ink level; if they share both, they are the same
thing and should look it.

## Layout

- App shell: `max-w-310` (1240px), `px-6 sm:px-8`. Insights widens to
  `max-w-350` because it is the one dense page.
- Insights is 8/4 on `lg`: the analytical column left, a sticky decision rail
  right. The rail carries what you act on (safe-to-spend, what I notice, due
  next, who owes who, limits); the column carries what you study.
- Cards group; they do not decorate. Nested cards are never correct — a card
  inside a card means the inner thing wanted a section, not a surface.
- Section rhythm on the landing is `py-16 sm:py-24`; more space above a heading
  than below it.

## Elevation & Depth

**Declare elevation once.** A surface is lifted by `--elevation` (an inset top
highlight, a tight shadow, and a wide soft one) *or* bounded by a hairline —
never both. A 1px border under a wide shadow is the ghost card and is banned.

- `elevated` — objects sitting on the page: cards, the composer, the landing
  panels.
- `hairline` (`--line`) — structure: dividers, table rules, input bounds,
  recessed tracks. Structural borders are not depth and may coexist with nothing.
- `hairline-gold` — a 1px inset gold rule, used to mark the one card on a screen
  that matters most. It is a box-shadow, so it cannot share an element with
  `elevated`; put it on a child.

## Shapes

- `control` 8px — buttons, inputs, nav items.
- `card` 12px — every card and panel.
- `surface` 16px — the composer and landing frames only.
- `pill` — small status chips and segmented controls, nothing larger.

Nested radii are concentric: inner = outer − padding. A 16px frame with 8px
padding takes 8px children.

## Components

- **Card** — `card` radius, `elevated`, no border. Title is `label` in muted ink
  with a 12px icon; **the card's own figure is `figure` weight**, and everything
  below it steps down to `ui` or `label`. A card with three identical text levels
  has no hierarchy and is the most common failure on this product.
- **Stat** — label above or below a tabular figure; used in rows of 2–4. Never
  more than one toned stat in a row, or the tone stops meaning anything.
- **Button** — `primary` is the gold fill, once per screen. `ghost` is a hairline.
  `tonal` carries a status tint and is the only place a status colour becomes a
  background. Press feedback is `brightness`, not scale.
- **Pill** — `label` type, status tint, always with a word.
- **Bar / track** — the track is `raised`, the fill is the entity's categorical
  colour, and the bar carries its label adjacent. Limit bars additionally carry a
  1px elapsed-day tick: being left of that line is the definition of on track.
- **Nav** — the active item is marked by a gold rule beneath it, not a filled
  pill. Gold as a fill is reserved for the primary action.

## Do's and Don'ts

**Do**

- Let SQL-derived figures look derived: tabular, exact, unrounded.
- Give every card one figure that is obviously the point.
- Tint secondary text on a coloured surface from that surface's hue. Grey text on
  a gold card is the giveaway that the card was themed and the text was not.
- Theme the surfaces you did not draw: selection, caret, scrollbar, focus ring.
- Animate to explain — a write cinches the knot, a state change moves. One
  authored moment per surface, not a reveal per section.

**Don't**

- Don't use a second gold fill in one view.
- Don't put a status colour on a chart, or a categorical colour on a status.
- Don't set a number in the serif.
- Don't stack a border and a shadow on the same element.
- Don't add an eyebrow above a heading; the heading carries its own weight.
- Don't let two text treatments differ by one step — merge them or separate them.
- Don't animate a routine, high-frequency interaction. Motion that repeats on
  every keystroke is a tax.
