# TUI visual system

Locked operator decisions for the AI-MINIONS Ink fullscreen shell and related brand surfaces. Presentation-only; does not change execution gates, traces, or capability claims.

## Scope

| In scope | Out of scope |
|----------|----------------|
| Color tokens, icon modes, degradation, gradient rules | Shipping font binaries in-repo by default |
| Cerberus TUI component policy (textual / Nerd) | PNG as the TUI Cerberus path |
| Official SVG for docs / GitHub / Web UI | Web UI implementation in this document |
| Config surface `icons=nerd\|unicode\|ascii` | Mouse / pointer interaction |

## Palette tokens

| Token | Hex | Role |
|-------|-----|------|
| `bg` | `#0B1020` | Terminal / panel background |
| `surface` | `#121A2B` | Elevated panels |
| `border` | `#26344D` | Borders, rules |
| `text` | `#E6EDF7` | Primary copy |
| `muted` | `#92A0B8` | Secondary / chrome |
| `cyan` | `#67D9F5` | Brand primary / Validate accent |
| `violet` | `#9B8CFF` | Brand secondary / Trace accent |
| `amber` | `#F4B860` | Brand tertiary / Enforce accent |
| `success` | `#55D6A5` | Positive runtime state |
| `danger` | `#F07178` | Failure / danger state |

Semantic runtime colors (success / warn / danger / blocked) remain distinct from decorative brand accents. Color may enhance meaning; it must never be the only carrier of meaning.

### Brand gradient (decorative only)

Stops: **cyan → violet → amber** (`#67D9F5` → `#9B8CFF` → `#F4B860`).

Allowed only on:

- wordmark / title accent
- small brand accent strokes

Forbidden on:

- paragraph body text
- tables
- readiness / run / gate state labels
- dense chrome that must remain scannable under `NO_COLOR` or 256-color terminals

Truecolor gradients are **optional**. Hierarchy must still work under `NO_COLOR` and 256-color modes via labels, borders, focus, spacing, and explicit state text.

## Fonts

- **Reference face:** JetBrainsMono Nerd Font (for rich glyph presence).
- **Do not** ship font binaries in the repository by default.
- Prerequisites belong in operator docs; optional platform installers may land later.
- Missing glyphs must **never** render as tofu (empty boxes). Fall back per icon mode.

## Icon modes

Config: `icons=nerd|unicode|ascii` — default **`nerd`**.

| Mode | Use when | Behavior |
|------|----------|----------|
| `nerd` | Local rich TTY with Nerd Font installed | Primary path: Nerd Font glyphs for rich presence |
| `unicode` | Portable mid fallback | Unicode portable set; no proprietary-only icons |
| `ascii` | SSH, CI, `NO_COLOR`, missing glyphs, or explicit config | Last-resort ASCII; never blank / tofu |

Rules:

1. No proprietary-only icons without an ascii (and preferably unicode) fallback.
2. Auto-degrade toward ascii when the environment cannot reliably render the richer set.
3. Icon choice must not change navigation keys, gate semantics, or execution truth.

## Degradation matrix

| Condition | Color | Icons | Cerberus mark | Hierarchy |
|-----------|-------|-------|---------------|-----------|
| Full rich TTY + Nerd Font | Truecolor optional on wordmark/accent | `nerd` | Wide textual / Nerd component | Labels + focus + borders |
| 256-color only | Named / indexed tokens; no required gradient | `nerd` → `unicode` if glyphs fail | Compact | Same |
| `NO_COLOR` / CI | No color | Prefer `ascii` (or unicode without color dependency) | Minimal / ascii geometry | Labels + borders + explicit state text only |
| SSH / unknown glyph coverage | As terminal allows | Fall through to `ascii` | Minimal | Never tofu |
| Narrow / short TTY | As above | As above | Drop decorative Cerberus before Start New Run / Overall / recent runs | Task-first preserved |

## Cerberus in the TUI

- **Not PNG.** Runtime path is a deterministic **textual / Nerd** component with variants: **wide / compact / minimal**.
- Cerberus is a **secondary** brand guardian: supports the brand; never displaces `AI-MINIONS`, **Start New Run**, Overall readiness, or recent-runs summary.
- Drop order under space pressure: decorative Cerberus **before** Start New Run / Overall / recent runs.
- Splash (brand prelude) remains skippable and bounded; it is not the landing.

## Official art (off-TTY)

| Asset | Path | Use |
|-------|------|-----|
| Master SVG | `assets/cerberus-master.svg` | Docs, GitHub, Web UI |
| License / provenance | `assets/CERBERUS-ART-LICENSE.md` | Redistribution and attribution |
| PNG 1× / 2× | Generate only if an external platform requires raster | Not the TUI path |

## Landing composition (visual constraints)

Task-first Home / landing remains authoritative:

1. Primary: wordmark, concise product cue, focused **Start New Run**.
2. Secondary: Cerberus guardian (wide → compact → minimal → omit).
3. Below: System Readiness (incl. Overall) and Recent Runs from real contracts.
4. Footer: key hints matching the implemented matrix.

Ink landing implementations must **consume this visual system** (tokens, icon modes, degradation, Cerberus secondary policy). Palette migration and `icons=` wiring may land as follow-up commits after this document is merged.

## Non-goals

- Custom font packaging inside git.
- PNG-driven TUI Cerberus.
- Gradient-painted paragraphs / tables / states.
- Elevating Cerberus above task hierarchy.
