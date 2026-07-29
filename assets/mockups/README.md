# Approved landing mockups (visual SoT)

Operator-approved compositions for the v0.26 sprint (2026-07-28 / 2026-07-29).

| File | Surface | Description |
|------|---------|-------------|
| [`tui-landing-pixel-v1.png`](./tui-landing-pixel-v1.png) | Console / Ink | Semantic Guardians v3 reference (real PNG): pixel three-head Cerberus with **VALIDATE / TRACE / ENFORCE**; task-first panels |
| [`gui-landing-detailed-v1.png`](./gui-landing-detailed-v1.png) | Future GUI | Detailed geometric Cerberus (real PNG); richer wordmark; same IA panels at GUI fidelity |
| [`semantic-guardians-v3-art-crop.png`](./semantic-guardians-v3-art-crop.png) | Review | Guardian art crop used when extracting the terminal matrix |
| [`semantic-guardians-lock-sheet-v2.png`](./semantic-guardians-lock-sheet-v2.png) | Review | Lock v2 sheet: reference vs exact matrix (not Ink runtime) |

## Provenance

- Operator-approved Semantic Guardians v3 reference and detailed GUI mockup, normalized as real PNG assets (not JPEG-in-disguise).
- Terminal geometry lock delivered as `ai-minions-terminal-pixel-art-lock-v2` (2026-07-29); runtime matrices live under `orchestrator/modules/operator/assets/semantic-guardians-matrix.json`.
- Canonical vector for the GUI path remains [`../cerberus-master.svg`](../cerberus-master.svg); license [`../CERBERUS-ART-LICENSE.md`](../CERBERUS-ART-LICENSE.md).
- TUI runtime must render deterministic cell matrices — these PNGs are **visual SoT / review evidence**, not Ink runtime assets.

## Non-goals

- Do not embed these PNGs in the Ink/TUI renderer.
- Do not overwrite `cerberus-master.svg` with pixel approximations.
- Do not treat fabricated mockup run rows as live product data.
