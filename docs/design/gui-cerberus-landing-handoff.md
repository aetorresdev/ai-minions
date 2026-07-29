# GUI Cerberus landing — design continuity handoff

**Architecture / design handoff** — preserves the approved **detailed** Cerberus landing for a future GUI surface. This is **not** a claim that a GUI runtime exists, and it does **not** select a GUI framework.

**Related:** [tui-visual-system.md](tui-visual-system.md) · [`assets/cerberus-master.svg`](../../assets/cerberus-master.svg) · [`assets/CERBERUS-ART-LICENSE.md`](../../assets/CERBERUS-ART-LICENSE.md) · approved GUI mockup [`assets/mockups/gui-landing-detailed-v1.png`](../../assets/mockups/gui-landing-detailed-v1.png) · TUI pixel derivative [`assets/mockups/tui-landing-pixel-v1.png`](../../assets/mockups/tui-landing-pixel-v1.png)

---

## Status

**Accepted for design continuity (in sprint)** — 2026-07-29.

GUI **runtime / framework / deployment** remain **not selected**. Implementation of an interactive GUI must not start until those are explicit and operator-approved.

**Visual SoT (operator 2026-07-28):** `assets/mockups/gui-landing-detailed-v1.png` — detailed three-head Cerberus with chains and hex core; richer wordmark; same IA panels as the TUI at GUI fidelity.

---

## Context

The fullscreen TUI adopts terminal-native arcade / pixel-art Cerberus sprites (`tui-landing-pixel-v1.png`). That path must **not** discard the approved **detailed** geometric Cerberus that requires SVG, richer typography, and responsive layout.

This handoff records the canonical assets, hierarchy contract, and gates so a future GUI can implement the approved direction without inventing a new brand from TUI block cells.

---

## Decision

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Canonical detailed guardian art is `assets/cerberus-master.svg` | Vector source aligned to the approved GUI mockup / option C |
| 2 | Review mockup SoT is `assets/mockups/gui-landing-detailed-v1.png` | Operator-approved GUI composition (not a runtime asset) |
| 3 | Provenance and license live in `assets/CERBERUS-ART-LICENSE.md` (root `LICENSE`) | No silent relicensing |
| 4 | TUI arcade sprites are a **terminal-specific derivative** | Pixel mockup is SoT for TUI only; must not overwrite the SVG |
| 5 | Shared IA across TUI and future GUI | Header/version, guardian, product identity, **Start New Run**, Quick Start, System Readiness, Recent Runs, prompt/footer |
| 6 | Palette for GUI starts from `docs/design/tui-visual-system.md` tokens | Any GUI palette evolution must be explicit |
| 7 | Cerberus remains secondary to task hierarchy | Never obscure Start New Run, Overall readiness, or authoritative run state |

---

## Required before GUI implementation

1. Revalidate `gui-landing-detailed-v1.png` against the selected GUI viewport(s) and interaction model.
2. Confirm canonical SVG, palette tokens, icon assets, and license/provenance (this handoff).
3. Produce responsive GUI mockups for desktop and narrow widths (derived from the approved SoT).
4. Map every visible readiness/run field to its authoritative product contract (mockup sample runs are illustrative only).
5. Obtain explicit operator approval before broad implementation.

---

## Acceptance (handoff slice)

- [x] Approved detailed Cerberus direction retained as GUI target (not replaced by TUI arcade).
- [x] Canonical SVG path, license/provenance, and GUI mockup SoT recorded and linked.
- [x] Hierarchy contract (Start New Run / System Readiness / Recent Runs) stated for GUI continuity.
- [x] Explicit non-goals: no GUI framework selection; no product claim of GUI availability; no overwrite of master SVG by TUI sprites.
- [ ] Responsive GUI mockups (desktop + narrow) — **deferred until framework/surface selected**.
- [ ] Full GUI interaction / accessibility validation — **deferred until implementation**.

---

## Non-goals

- Selecting or shipping a GUI runtime, framework, or deployment surface.
- Changing TUI pixel-art behavior (owned by the arcade TUI path).
- Claiming GUI availability in release or product docs.
- Runtime LLM/image generation for artwork.
- Harness, execution, trace, gate, RAG, Loop, or Graph capability changes.

---

## CERBERUS gates

- A terminal limitation must not silently reduce the GUI design target.
- Mock data cannot be presented as an implemented GUI state.
- Layout may adapt; changes to meaning, data source, or operator action need an explicit contract update.
- No production or cross-platform claim without executable evidence on declared targets.

---

## Revision history

| Date | Note |
|------|------|
| 2026-07-29 | In-sprint handoff; linked operator GUI mockup `gui-landing-detailed-v1.png` as visual SoT |
