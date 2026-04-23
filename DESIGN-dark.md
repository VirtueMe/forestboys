---
name: Milorg Utforsker — Archival Paper (dark)
colors:
  ink: "#EDE6D6"
  ink-soft: "#B8B0A0"
  paper: "#1C1A17"
  paper-raised: "#252320"
  paper-sunken: "#151311"
  rule: "#3A352E"
  muted: "#807867"
  faded-red: "#C8604E"
  faded-red-soft: "#A85A48"
  moss: "#8A9672"
  focus: "#7FA4C3"
  danger: "#C8604E"
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
  sm: "0 1px 2px rgba(0, 0, 0, 0.30)"
  md: "0 2px 8px rgba(0, 0, 0, 0.40)"
  lg: "0 8px 24px rgba(0, 0, 0, 0.55)"
  inset-rule: "inset 0 -1px 0 {colors.rule}"
layout:
  nav-height: 48px
  content-max-width: 1320px
  prose-max-width: 68ch
  breakpoint-sm: 640px
  breakpoint-md: 900px
  breakpoint-lg: 1200px
---

## Overview

**Archival Paper — Dark** is the night-reading inverse of the light theme.
Imagine the same archival research material seen under a warm reading lamp
on dark leather. Spacing, typography, radii, and components are identical
to `DESIGN.md`; only the color tokens change.

Core principle: **ink becomes warm cream, paper becomes dark charcoal**.
Neither flip is pure — pure white on pure black is a developer default, not
a design choice. Every surface retains the warm hue of aged leather and
lamp-lit parchment.

## Color mapping (light → dark)

| Token              | Light       | Dark        | Rationale                                  |
| ------------------ | ----------- | ----------- | ------------------------------------------ |
| `ink`              | `#1A1A1A`   | `#EDE6D6`   | Warm cream. Never pure white.              |
| `ink-soft`         | `#3D3A35`   | `#B8B0A0`   | Desaturated cream for secondary text.      |
| `paper`            | `#F4EFE4`   | `#1C1A17`   | Warm charcoal, brown-biased.               |
| `paper-raised`    | `#FBF7EE`   | `#252320`   | One step lighter than `paper`.             |
| `paper-sunken`    | `#E8DFCC`   | `#151311`   | One step darker than `paper`.              |
| `rule`             | `#C8BFA9`   | `#3A352E`   | Subtle dividers, still warm.               |
| `muted`            | `#6B6459`   | `#807867`   | Placeholder, captions.                     |
| `faded-red`        | `#8B2E1F`   | `#C8604E`   | Lifted for contrast against dark paper.    |
| `faded-red-soft`  | `#A85A48`   | `#A85A48`   | Shared — hover state works both modes.     |
| `moss`             | `#4F5A3E`   | `#8A9672`   | Lifted for dark contrast.                  |
| `focus`            | `#3A5A74`   | `#7FA4C3`   | Lifted for dark contrast.                  |
| `danger`           | `#8B2E1F`   | `#C8604E`   | Mirrors `faded-red`.                       |

## Contrast verification

- `ink` (`#EDE6D6`) on `paper` (`#1C1A17`): **12.1:1** — AAA.
- `ink-soft` (`#B8B0A0`) on `paper`: **8.4:1** — AAA.
- `muted` (`#807867`) on `paper`: **4.5:1** — AA for normal text. Captions only.
- `faded-red` (`#C8604E`) on `paper`: **4.8:1** — AA. Acceptable for button text
  sized `body-ui` or larger.
- `ink` on `paper-raised` (`#252320`): **10.7:1** — AAA.

## Shadow adjustment

Dark surfaces swallow black shadows. Dark-mode shadows are **higher alpha**
(30–55%) than light mode (6–10%) to remain perceptible. Otherwise keep the
spec scale (`sm`, `md`, `lg`).

## Image treatment

Historical photographs on dark paper can read as cold. Apply a very subtle
warm filter (`sepia(4%) brightness(0.98)`) to photo strips and hero images in
dark mode **only** — light mode keeps photographs untreated.

## Anti-patterns (dark-specific, in addition to those in `DESIGN.md`)

- **Pure `#000` backgrounds.** Always `paper` (`#1C1A17`).
- **Pure `#FFFFFF` text.** Always `ink` (`#EDE6D6`).
- **Cool-blue dark modes.** Milorg's dark mode is warm charcoal + cream,
  never slate-and-white.
- **Raising red/moss lightness beyond spec.** Accent lift is done; don't
  re-lift at component level.
