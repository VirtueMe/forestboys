---
name: Milorg Utforsker — Archival Paper (light)
colors:
  ink: "#1A1A1A"
  ink-soft: "#3D3A35"
  paper: "#F4EFE4"
  paper-raised: "#FBF7EE"
  paper-sunken: "#E8DFCC"
  rule: "#C8BFA9"
  muted: "#6B6459"
  faded-red: "#8B2E1F"
  faded-red-soft: "#A85A48"
  moss: "#4F5A3E"
  focus: "#3A5A74"
  danger: "#8B2E1F"
typography:
  display:
    fontFamily: Crimson Pro
    fontSize: 2.75rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  h1:
    fontFamily: Crimson Pro
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.2
  h2:
    fontFamily: Crimson Pro
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.25
  h3:
    fontFamily: Public Sans
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: Crimson Pro
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.55
  body-ui:
    fontFamily: Public Sans
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: Public Sans
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1.3
  caps:
    fontFamily: Public Sans
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
    textTransform: uppercase
  mono:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  xxl: 64px
rounded:
  none: 0
  sm: 2px
  md: 4px
  lg: 8px
  pill: 999px
shadow:
  sm: "0 1px 2px rgba(26, 26, 26, 0.06)"
  md: "0 2px 8px rgba(26, 26, 26, 0.08)"
  lg: "0 8px 24px rgba(26, 26, 26, 0.10)"
  inset-rule: "inset 0 -1px 0 {colors.rule}"
layout:
  nav-height: 48px
  content-max-width: 1320px
  prose-max-width: 68ch
  page-zoom: "1 · 1.125 ≥1600px · 1.25 ≥1920px · 1.5 ≥2400px · 2 ≥3200px"
  breakpoint-sm: 640px
  breakpoint-md: 900px
  breakpoint-lg: 1200px
---

## Overview

**Archival Paper** — the aesthetic of opening a document from 1943. The UI
should read like a curated museum card, not a product interface. The subject
matter (Norwegian WWII resistance, 1940–1945) is primary-source historical
research by Jan Warberg and Rolf G. Halvorsen, presented to descendants,
historians, and the curious public. Tone is **curation, not activism**: the
facts, sources, and photographs do the talking.

Three qualities drive every choice:

- **Paper-first.** Surfaces feel like aged paper stock — warm off-whites,
  subtle cream gradients, never pure white. Pure white is for empty space
  inside a form field; everything else sits on paper.
- **Restraint on accent.** The single red (`faded-red`) is the oxidized tone
  of a faded Norwegian flag — used for interaction affordances and one or two
  editorial highlights per page, never for decoration. If you find yourself
  using red three times on a screen, remove two.
- **Serif body, sans UI.** Long-form historical prose is Crimson Pro (serif,
  reads like journalism). Chrome, labels, and buttons are Public Sans
  (humanist sans, reads like museum signage).

## Colors

The palette is four paper tones, one ink, one accent, plus functional utilities.

- **`ink` `#1A1A1A`** — primary text, headlines, core symbols. Never pure black.
- **`ink-soft` `#3D3A35`** — secondary text, captions, metadata. Warm-leaning
  grey to harmonize with paper tones (not a cool neutral).
- **`paper` `#F4EFE4`** — the default page background. Think "limestone" or
  uncoated archival stock. Do not use pure `#FFFFFF` for page backgrounds.
- **`paper-raised` `#FBF7EE`** — cards, modals, any container floating above
  the page. Subtly lighter than `paper`.
- **`paper-sunken` `#E8DFCC`** — filter bars, disabled form backgrounds,
  inset regions. Reads as "below the page level."
- **`rule` `#C8BFA9`** — hairline dividers, form-field underlines,
  card borders. 1px, always.
- **`muted` `#6B6459`** — placeholder text, secondary caption metadata.
- **`faded-red` `#8B2E1F`** — the Norwegian-flag-oxidized accent. Reserved
  for: primary call-to-action buttons, active-state indicators, the
  occasional editorial pull-quote or emphasis. Aim for **one to two** uses
  per screen; it's signal, not texture.
- **`faded-red-soft` `#A85A48`** — hover/pressed state for red affordances.
- **`moss` `#4F5A3E`** — used for successful-save confirmations and
  "verified" source pills. Muted enough to not fight the palette.
- **`focus` `#3A5A74`** — keyboard focus ring only. Not a general accent.
- **`danger` `#8B2E1F`** — destructive action (delete, revoke). Same hex as
  `faded-red` by design: destructive actions are visually weighty, not noisy.

### Contrast rules

- Body text (`ink` on `paper`) is 13.2:1 — comfortably AAA.
- `ink-soft` on `paper` is 9.1:1 — AAA.
- `muted` on `paper` is 4.7:1 — AA only. Do not use for body prose; captions
  and metadata only.
- `faded-red` on `paper` is 5.4:1 — AA for text. Fine for buttons with white
  or cream text inside; test any red-on-paper text at the size you use it.

## Typography

Two families do all the work:

**Crimson Pro** (serif) — long-form Norwegian prose, personal biographies,
event descriptions, pull quotes, page titles. Historical material deserves a
reading face with contrast and narrative texture. Load weights 400, 600.

**Public Sans** (humanist sans) — navigation, buttons, form labels, data
tables, filter chips, tags, metadata strips. Loads with higher x-height and
legible at small sizes. Load weights 400, 500, 600.

**JetBrains Mono** (optional) — only inside admin surfaces that display
technical data: IDs, slugs, code snippets in source citations.

### Scale & usage

- `display` (44px serif) — the single title on a detail page (person name,
  event title, operation codename).
- `h1` (32px serif) — section heroes on list/archive pages.
- `h2` (24px serif) — internal section headings inside a detail page
  ("Beskrivelse", "Deltakere", "Kilder").
- `h3` (18px sans) — sub-section labels, form group headings.
- `body` (17px serif, 1.55 leading) — prose (Portable Text output, long
  descriptions). Constrain to `prose-max-width` (68ch) regardless of screen
  width.
- `body-ui` (15px sans) — anything inside a control, card footer, filter
  panel, or table cell.
- `label` (13px sans, 500 weight) — form field labels.
- `caps` (12px sans, 600, tracked, uppercase) — "KILDER", "DISTRIKT",
  category tags, small section headers above a list.
- `mono` (14px) — admin-only data.

### Language note

UI strings, headings, and validation copy are in **Norwegian Bokmål**. Do not
translate labels into English even in placeholder copy — it reads as
out-of-place tourism. Norwegian typographic conventions apply: use `«»` for
quotes in prose, `–` (en dash) for numeric ranges, `'` (apostrophe) for
elision. Dates in long form: `12. april 1945`.

## Spacing

Strict 8px base grid with a 4px half-step. Never ship values like `6px`,
`10px`, `14px` — if the grid doesn't produce it, the spec doesn't support
it. Within components, compose from `xs`/`sm`/`md`/`lg`; between major page
sections, use `xl` or `xxl`.

- Card internal padding: `lg` (24px)
- Form row vertical gap: `md` (16px) between rows, `xs` (4px) between label
  and input
- Adjacent cards in a grid: `md` (16px)
- Section-to-section on a detail page: `xl` (40px)
- Page-top to hero: `xl` (40px) desktop, `md` (16px) mobile

## Radius & shape

Architectural restraint — **4px corner radius** (`rounded.md`) for almost
everything. Pills (filter chips, tags, source-reference chips) use
`rounded.pill` to read as typographic labels rather than boxes. Never use
radii > 8px; this is an archive, not a consumer app.

## Shadow

Paper surfaces cast almost nothing. Use shadow to signal *layer*, not decoration.

- `shadow.sm` — subtle card lift on light hover
- `shadow.md` — modals over page content
- `shadow.lg` — reserved for image lightbox only
- `shadow.inset-rule` — for card bottom borders when a shadow would be too much

## Layout

Mobile-first PWA, fluid to `content-max-width` (1320px) on desktop. Prose
columns constrain to `prose-max-width` (68ch) *regardless of viewport* —
widescreen prose at 1200px is unreadable for Norwegian long-form.

- `.shell` is `height: 100%; display: flex; flex-direction: column`.
- `AppNav` is `nav-height` (48px), flex-shrink: 0.
- `.page-content` is `flex: 1; min-height: 0; overflow: hidden` and itself
  a flex column — internal scroll lives in a child with `overflow-y: auto`.
- Never break a full-width element out of a column with viewport units
  (`width: 100vw; margin-left: calc(-50vw + 50%)`): the shell is wrapped in
  `zoom: var(--page-zoom)` (1.125 from 1600px, 1.25 from 1920, 1.5 from 2400)
  and `vw` does not follow CSS zoom, so the element overshoots the page and
  grows scrollbars. Make the full-width element 100% of a full-width parent
  and constrain its siblings instead (`.events-page` in `EventsView.vue`).

Breakpoints:
- `<640px` — single column, stacked cards, bottom drawer
- `640–899px` — optional two-column card grid
- `≥900px` — sidebar drawer, three-column archive grids
- `≥1200px` — content reaches `content-max-width`
- `≥1600px` / `≥1920px` / `≥2400px` / `≥3200px` — the whole page scales
  by `page-zoom` 1.125 / 1.25 / 1.5 / 2 (CSS `zoom` on `.shell`), so text
  grows and the content column keeps a proportionate share of the screen;
  a 4K screen at 2 reads like a 1920 one. From `≥3200px` the prose size
  (`body`) is also 1.2rem, so the 68ch measure spans more of the column.
  `zoom`, not a larger root font size: half the components size text in
  px. The map page is not zoomed, and maps inside pages are zoomed back to
  1:1 — MapLibre reads pointer positions against an unzoomed canvas.

## Components

### ItemCard

Universal card used on list pages (People, Transport, Stations, Events).
Photo strip left, title + meta right on desktop; stacked on mobile.

- Background: `paper-raised`
- Border: `1px solid rule`
- Radius: `rounded.md` (4px)
- Padding: `lg` (24px)
- Title: `h3` in `ink`
- Meta row: `body-ui` in `ink-soft`; separators are `•` in `muted`
- Hover (pointer devices): `shadow.sm`, 120ms ease-out
- Active/focus: focus ring `2px solid focus` with 2px offset

### DetailPage hero

Opens a detail view (person, event, location, operation). Single large
title, optional kicker, metadata row, optional hero photo below.

- Kicker (if any): `caps` in `muted`, sits `xs` (4px) above title
- Title: `display` in `ink`, `prose-max-width` constrained
- Metadata row: `body-ui`, separated by a thin vertical `rule` (`1px ×
  1em`), or `•` if vertical rule is awkward
- Hero photo: full-bleed within `content-max-width`, 16:10 or 4:3 ratio,
  4px radius, no shadow — it's a photograph, not a card

### Admin form row

Used throughout admin editors (Organization, Event, Person, Relation
editors in `src/components/relation/`).

- Label: `label` in `ink-soft`, above the input, `xs` (4px) gap to input
- Input: `body-ui` in `ink` on `#FFFFFF` background, `1px solid rule`,
  `rounded.md`, `sm md` padding (8px vertical, 16px horizontal)
- Focus: border becomes `focus`, 1px `focus` ring offset 0px
- Error: border becomes `danger`, error text `body-ui` in `danger`, below
  the input with `xs` gap
- Help text: `body-ui` in `muted`, below the input

### Filter chip / tag / source pill

Pill-shaped label used for districts, organizations, source references,
and tags.

- Background: `paper-sunken`
- Text: `caps` in `ink-soft`
- Padding: `xs sm` (4px vertical, 8px horizontal)
- Radius: `rounded.pill`
- Active/selected: background `ink`, text `paper`. No intermediate hover
  state — this is not a button, it's a filter state toggle.
- "Verified" source pill: background `moss`, text `paper`, same shape.

### Button

Two variants only: `primary` and `ghost`. No tertiary, no subtle, no icon-only
without explicit label for accessibility.

- **Primary**
  - Background: `faded-red`
  - Text: `paper` in `body-ui` 500 weight
  - Padding: `sm lg` (8px vertical, 24px horizontal)
  - Radius: `rounded.md`
  - Hover: background `faded-red-soft`
  - Active: background darkens 6%
  - Disabled: background `paper-sunken`, text `muted`
- **Ghost**
  - Background: transparent
  - Text: `ink` in `body-ui` 500 weight
  - Border: `1px solid rule`
  - Hover: background `paper-sunken`

Destructive actions look like `primary` but use `danger` color naming in
code; same hex. Always confirm destructive actions in a modal — the admin
surface has no undo.

### Timeline (`EventTimeline.vue`)

Our own component, no library. One baseline with every event on it, title
boxes in up to four rows above, joined to their dot by a leader line.

- Axis: `ink-soft`, 2px; month and year ticks in `muted` mono
- Dot (normal): the organisation's colour, else `ink-soft`
- Title box: `paper-raised`, 1px `rule`, 3px organisation colour on the left, 11px sans
- Slug event: `faded-red` box and ring; hash event: `focus` (both tokens, so both modes follow)
- Arrow-key cursor: 2px `ink` outline, bold, whole title
- Count bubble (events that overlap): `paper-raised`, 1px `ink-soft`
- Popover: `paper-raised`, `shadow-lg`
- Header: `paper-raised`, picture or colour dot, title in the serif face
  (`--font-serif`, 15px 600), date · org · district in `muted`
- Dark mode: no hard-coded colours; everything is a token. The organisation
  colours come from data and some are too dark for dark paper (`#2f146e`,
  `#724a11`), so dots, the box's left edge and its leader line are mixed 62/38
  with `ink` in dark mode only (`color-mix`). The header picture gets the warm
  photo filter from `DESIGN-dark.md`.
- Content of the header sits in the same centred column and 12px padding as the
  filters; a strip of page background (16px) separates the filters from it

### Portable Text rendering

Long-form prose output from Sanity Portable Text → HTML. Use `body` type at
`prose-max-width`. Inline styles:

- Links: `ink` with `1px solid rule` underline (not standard browser
  underline), becomes `faded-red` on hover
- Emphasis: italic, no color change
- Strong: weight 600, no color change
- Blockquote: `2px solid rule` left border, `md` left padding, `ink-soft`
  text
- Inline source reference (`SourceRef.vue`): pill-shaped, see "Filter chip"

## Anti-patterns

The following are explicit **no**s. If an agent is tempted, stop.

- **Pure white backgrounds** on pages or cards. Always paper-tone.
- **Cool grays** (e.g. `#888`, `#CCCCCC`) anywhere in the palette. All
  neutrals are warm-biased.
- **Red as decoration** — red is signal. Not for icons, not for accent
  stripes, not for "empty state" flourishes.
- **Drop shadows on photos**. Photographs are the content; they don't need
  UI chrome.
- **Multiple heading families per page.** Serif OR sans for a given hierarchy
  level; don't mix.
- **Emoji in UI copy.** Norwegian historical archive — icons from a curated
  set only (if any at all).
- **Gradients.** Paper is flat. The only permitted gradient is a very subtle
  paper-to-paper-raised variation on hero sections (<5% luminance difference).
- **Animated transitions > 200ms.** The feel is "still life," not "app."
- **Rounded corners > 8px.** Consumer-app radii break the heritage feel.
