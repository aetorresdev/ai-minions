# TUI visual system

Locked operator decisions for the AI-MINIONS Ink fullscreen shell and related brand surfaces. Presentation-only; does not change execution gates, traces, or capability claims.

## Scope

| In scope | Out of scope |
|----------|----------------|
| Color tokens, icon modes, degradation, gradient rules | Shipping font binaries in-repo by default |
| Cerberus TUI art modes `arcade\|text\|none` (Semantic Guardians default; Neon opt-in) | PNG as the TUI Cerberus path |
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
| `warn` | `#E8C547` | Warning / degraded runtime state (saffron; distinct from brand `amber`) |
| `danger` | `#F07178` | Failure / danger state |
| `blocked` | `#D27BEA` | Gate / policy blocked state (orchid; distinct from `danger`, `muted`, and brand `violet`) |

Semantic runtime colors (`success` / `warn` / `danger` / `blocked`) remain distinct from decorative brand accents (`cyan` / `violet` / `amber`). Color may enhance meaning; it must never be the only carrier of meaning.

**Runtime adoption:** Ink/theme code consumes these hex tokens via `operator-tui-theme.js`. Icon mode is wired through `icons=nerd|unicode|ascii` (`AI_MINIONS_TUI_ICONS` / model `iconMode`). Glyph coverage is not auto-detected.

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

- **Reference face:** JetBrainsMono Nerd Font (for rich glyph presence when `icons=nerd`).
- **Do not** ship font binaries in the repository by default.
- **Prerequisite for `nerd`:** operator installs JetBrainsMono Nerd Font (or another Nerd Font with the same Private Use Area glyphs) and selects it in the terminal emulator. Without that face, `icons=nerd` may render tofu (empty boxes); Node/Ink cannot reliably detect per-glyph coverage.
- Prerequisites belong in operator docs; optional platform installers may land later.

## Icon modes

Config: `icons=nerd|unicode|ascii` — default config value may be **`nerd`**, but that is an **explicit operator choice**, not an auto-detected capability.

| Mode | Use when | Behavior |
|------|----------|----------|
| `nerd` | Operator installed and selected a Nerd Font in the TTY | Nerd Font glyphs for rich presence; may tofu without that font |
| `unicode` | Portable mid set, or remediation when Nerd Font is unavailable | Unicode portable set; no proprietary-only icons |
| `ascii` | SSH, CI, constrained TTYs, or explicit operator config | ASCII-only icons |

Rules:

1. No proprietary-only icons without an ascii (and preferably unicode) counterpart in the icon map.
2. Font / glyph coverage is **not** auto-detected reliably from Node/Ink. `NO_COLOR`, CI, or SSH do **not** prove glyph coverage. There is **no** runtime guarantee of auto-degradation on glyph failure.
3. `unicode` and `ascii` are **configurable remediations** (operator or documented default profiles), not claimed automatic fallbacks when a Nerd glyph fails to paint.
4. Do **not** claim “never tofu” as a runtime guarantee until a verifiable coverage mechanism exists.
5. Icon choice must not change navigation keys, gate semantics, or execution truth.

## Degradation matrix

| Condition | Color | Icons | Cerberus mark | Hierarchy |
|-----------|-------|-------|---------------|-----------|
| Full rich TTY + Nerd Font installed & selected | Truecolor optional on wordmark/accent | `nerd` (operator choice) | Arcade Semantic Guardians (default) or Neon (`AI_MINIONS_TUI_GUARDIAN=neon`); `AI_MINIONS_TUI_ART=arcade\|text\|none` | Labels + focus + borders |
| 256-color only | Named / indexed tokens; no required gradient | Same configured mode (no auto glyph degrade) | Same configured art/guardian mode (compact when mid) | Same |
| `NO_COLOR` / CI | No color (styling only — does **not** auto-change art or icon mode) | Configured mode kept; prefer documenting `ascii`/`unicode` in operator profiles | Configured mode kept (`arcade`/`text`/`none`) | Labels + borders + explicit state text only |
| SSH / unknown glyph coverage | As terminal allows | Operator should set `unicode` or `ascii`; coverage is not auto-detected | Configured mode kept; may tofu under `nerd` without Nerd Font | Same |
| Narrow / short TTY | As above | As above | Compact → minimal → omit decorative guardian; at **80×24** Recent Runs **may be omitted** to keep compact guardian + **Start New Run** + Overall | Task-first preserved |

## Cerberus in the TUI

- **Not PNG / not Kitty / not Sixel.** Runtime path is deterministic terminal cells with variants: **wide / compact / minimal**.
- Default presentation under `AI_MINIONS_TUI_ART=auto`: **arcade** block-sprite Cerberus for `icons=nerd|unicode`; textual/ASCII path for `icons=ascii`. Overrides: `arcade|text|none`. Invalid values fail closed to `auto` with an observable reason.
- Guardian comparison: `AI_MINIONS_TUI_GUARDIAN=neon|semantic`. **Default `semantic`** (Cerberus terminal pixel-art lock v2 Braille matrices — `orchestrator/modules/operator/terminal-pixel-art.js` + `assets/semantic-guardians-matrix.json`; labels under heads). **Neon** is opt-in (`AI_MINIONS_TUI_GUARDIAN=neon`) for the compact VTE/block checkpoint. Invalid guardian values fail closed to `semantic` with an observable reason. Invalid `AI_MINIONS_TUI_ART` values fail closed to `auto` with a reason that persists in shell debug/evidence across remounts.
- Cerberus is a **secondary** brand guardian: supports the brand; never displaces `AI-MINIONS`, **Start New Run**, or Overall readiness. Under height pressure (including **80×24**), **Recent Runs may be reduced or omitted** so compact guardian + CTA + Overall still fit.
- **Brand wordmark:** lock v2 3×5 block pixel wordmark when arcade + width allows; otherwise per-character text with optional truecolor cyan→violet→amber gradient. Under `NO_COLOR`, readable uppercase `AI-MINIONS` without claiming gradient.
- Optional pixel section icons (Quick Start / System Readiness / Recent Runs) use lock v2 Braille dot matrices and always keep text labels.
- Drop order under space pressure (matches `LANDING_COMPOSITION_DROP_STEPS`, plus early art demotions): empty-board short Recent copy (only when no runs) → **pixel wordmark → text** → **wide guardian → compact** → reduce Recent to 1 → hide decorative guardian note / tagline / triad → reduce readiness details/next → Quick Start primary-only → **hide Recent** → omit Cerberus guardian → hide Quick Start → hide product. Lock v2 prefers compact guardian at ≥80×24 before `hide_guardian`. Never drop **Start New Run** or Overall readiness. Each Recent Runs entry is a **single truncated line** (CR/LF normalized before truncate).
- Splash (brand prelude) remains skippable and bounded; it is not the landing. Splash + landing share the same guardian default (Semantic) and wordmark treatment.
- **PUA scope:** lock v2 matrices and section icons introduce **no** Nerd/Private Use Area glyphs. Global `icons=nerd` (default operator choice in `operator-tui-icons.js`) remains a separate, explicit TTY profile — not claimed as “no Nerd-PUA” for the whole TUI.

## Official art (off-TTY)

| Asset | Path | Use |
|-------|------|-----|
| Master SVG | `assets/cerberus-master.svg` | Docs, GitHub, Web UI (GUI path) |
| License / provenance | `assets/CERBERUS-ART-LICENSE.md` | Redistribution and attribution |
| TUI mockup SoT | `assets/mockups/tui-landing-pixel-v1.png` | Review evidence for arcade TUI — not Ink runtime (real PNG; Semantic Guardians v3 reference) |
| GUI mockup SoT | `assets/mockups/gui-landing-detailed-v1.png` | Review evidence for future GUI — not a shipped GUI (real PNG) |
| Lock sheet (review) | `assets/mockups/semantic-guardians-lock-sheet-v2.png` | Matrix vs reference comparison — not Ink runtime |
| Terminal geometry lock | `orchestrator/modules/operator/assets/semantic-guardians-matrix.json` | Deterministic Semantic Guardians cells |
| PNG 1× / 2× | Generate only if an external platform requires raster | Not the TUI path |

**Provenance (terminal lock v2):** integrated from operator delivery `ai-minions-terminal-pixel-art-lock-v2` (2026-07-29). Fixture regen is intentional (`scripts/regenerate-terminal-pixel-art-fixtures.js` / `scripts/regenerate-pixel-art-checkpoints.js`); validation tests never rewrite fixtures.

## Landing composition (visual constraints)

Task-first Home / landing remains authoritative:

1. Primary: wordmark, concise product cue, focused **Start New Run**.
2. Secondary: Cerberus guardian (wide → compact → minimal → omit).
3. Below: System Readiness (incl. Overall) and Recent Runs from real contracts.
4. Footer: key hints matching the implemented matrix.

Ink landing implementations must **consume this visual system** (tokens, icon modes, degradation, Cerberus secondary policy). Runtime adoption lives in `orchestrator/modules/operator/operator-tui-{theme,icons,splash,landing,shell-*}` on the landing PR lineage.

## Non-goals

- Custom font packaging inside git.
- PNG-driven TUI Cerberus.
- Gradient-painted paragraphs / tables / states.
- Elevating Cerberus above task hierarchy.
