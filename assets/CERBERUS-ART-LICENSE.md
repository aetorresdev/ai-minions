# Cerberus art — license and provenance

## Official asset

| Field | Value |
|-------|--------|
| Master vector | `assets/cerberus-master.svg` |
| Role | Official Cerberus guardian mark for documentation, GitHub, and Web UI |
| Style | Geometric / wireframe three-headed guardian (Validate / Trace / Enforce); not mascot-like; not entertainment IP |

## Provenance

- **Author:** Andres Torres (operator-directed brand mark for the AI-MINIONS project).
- **Created:** 2026-07-28; redrawn to match approved option C composition.
- **Intent:** Original geometric brand artwork for the Cerberus gate / guardian metaphor used by the AI-MINIONS operator surface.
- **Visual direction source:** Approved Cerberus **option C** TUI landing/splash render attached on the release-prep tracking issue comment (`https://github.com/user-attachments/assets/ee018a2f-ff28-4561-b5f0-e7a9c7fbf88c`). The SVG is a faithful geometric/vector interpretation of that mark (three profile/front heads, checkmark / circuit brow / lock emblems, chain links to a hexagonal gate core, triad labels), using the locked palette in `docs/design/tui-visual-system.md`.
- **Not derived from** third-party game, film, or commercial mascot artwork.
- **Relationship to TUI:** The Ink shell uses deterministic **arcade / pixel-art** cell sprites. Visual SoT for Semantic Guardians review: `assets/mockups/tui-landing-pixel-v1.png` (real PNG). Runtime Semantic geometry: Cerberus terminal pixel-art lock v2 under `orchestrator/modules/operator/` (`terminal-pixel-art.js` + `assets/semantic-guardians-matrix.json`). Neon remains the default guardian style; Semantic is opt-in. This SVG is the **official off-TTY / GUI** source (visual SoT: `assets/mockups/gui-landing-detailed-v1.png`). PNG 1×/2× exports may be generated only when an external platform requires raster assets; they are not the TUI runtime path. TUI sprites must **never** overwrite this master SVG.

## License (path A — same as repository)

This artwork is part of the Software governed by the root repository license:

- **File:** [`LICENSE`](../LICENSE) — **AI MINIONS COMMUNITY LICENSE** Version 1.0
- **Copyright holder:** Andres Torres
- **No separate grant:** This file does **not** grant broader rights (including unrestricted commercial use, sublicense, or distribute-beyond-LICENSE terms) than the root `LICENSE`.

Redistribution and use of `assets/cerberus-master.svg` and this provenance file are subject to the same Non-Commercial Use grant, Commercial Use restrictions, trademark limits, and other terms as the rest of the repository. Brand gradient stops and palette hex values are documented in `docs/design/tui-visual-system.md` and may be referenced under those same LICENSE terms when redistributing the master SVG.

For Commercial Use of the artwork, obtain a separate written commercial license from the Licensor (see root `LICENSE` §4).

## Non-goals

- Do **not** ship font binaries in this repository by default.
- Do **not** treat this SVG as a substitute for the TUI Cerberus component.
- Do **not** elevate Cerberus above the `AI-MINIONS` wordmark or primary task actions on the operator landing.
