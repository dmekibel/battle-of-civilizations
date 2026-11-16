# Plan

A hot-seat web prototype of a hex-grid war board game, built so rules can change without touching the UI.

1. **Scaffold.** TypeScript + Vite, Vitest, a GitHub Action that tests, builds and deploys to GitHub Pages.
2. **Config.** `src/config.ts` holds every tunable number: board size, river and bridges, forests, dice, unit costs, attack, HP, archer range, win switches. Rules read only from it.
3. **Rules engine** (`src/engine/`). Pure functions, no DOM: `newGame`, `roll`, `move`, `attack`, `shoot`, `endTurn`, plus queries `reachable`, `attackTargets`, `shootTargets`, `previewAttack`. State in, new state out. Dice come from an injectable random function, so tests are deterministic. Unit tests in `tests/`.
4. **Terrain as data.** Each terrain type is a row in `config.terrain` (passable, blocks sight, defence bonus). A castle is added later as one more row plus its rules.
5. **UI** (`src/ui/`). SVG board with flat-top hexes, NATO-style unit symbols, red vs blue. Dice animation, points counter, reach highlights, attack previews, HP pips, undo within the turn, end-turn button, move log. Russian by default, English toggle.
6. **README.** Rules as implemented, the config switches, and the open design questions for Dad.
