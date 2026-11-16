# Battle of Civilizations · Битва цивилизаций

A digital prototype of a hex-grid war board game designed by David's father. Two players share one screen and take turns (hot-seat). No server.

**Play:** https://dmekibel.github.io/battle-of-civilizations/ (after GitHub Pages is switched on)

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173/battle-of-civilizations/
npm test         # rules engine tests
npm run build    # production build into dist/
```

Every push to `main` runs the tests, builds, and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## How the code is laid out

| Path | What it is |
|---|---|
| `src/config.ts` | **Every tunable number and rule switch.** Change rules here. |
| `src/engine/` | The rules: pure functions (state in, new state out), no UI. Ready for an AI or online play later. |
| `tests/` | Vitest tests for the rules. |
| `src/ui/` | The SVG board, controls and Russian/English text. |

## Rules as implemented (v1)

**Goal.** Kill the enemy King, or capture him.

**Board.** 17 x 11 hexes. A river runs down the middle with 2 bridges. Forest hexes block movement. The armies start on opposite sides.

**Turns.** Red goes first. On your turn, roll 3 six-sided dice. The total (3 to 18) is your movement points for the turn. Split them however you like among your pieces: move, attack and shoot until you run out or press **End turn**. Unused points are lost.

**Pieces** (default values, all in `src/config.ts`):

| Piece | Points per hex | Attack | HP (defence) | Symbol |
|---|---|---|---|---|
| King | 6 | 1 | 2 | crown, filled |
| Heavy infantry | 6 | 1 | 2 | X in box, filled |
| Light infantry | 3 | 1 | 1 | X in box, outline |
| Heavy cavalry | 2 | 2 | 2 | diagonal, filled |
| Light cavalry | 1 | 1 | 1 | diagonal, outline |
| Archers | 4 | no melee | 1 | bow, outline |

Speed ratio heavy infantry : light infantry : heavy cavalry : light cavalry = 1 : 2 : 3 : 6.

**Movement.** Each hex costs the piece's points per hex. You can't enter forest or river (only bridges cross it), can't enter or pass through enemy pieces, and can pass through (but not stop on) your own pieces. A piece may move several times in a turn while points last.

**Melee.** A piece next to an enemy spends 1 point to hit it for its attack value. A piece at 0 HP is removed. No dice in combat.

**Archers.** Spend 2 points to shoot an enemy 2 to 3 hexes away for 1 damage. Forest between the archer and the target blocks the shot; the river does not.

**Winning.**
- Reduce the enemy King to 0 HP, or
- End your turn with one of your pieces next to the enemy King and no enemy defenders next to him (capture).

**Starting army per side.** 1 King, 4 heavy infantry, 4 light infantry, 2 heavy cavalry, 2 light cavalry, 2 archers.

**Rule switches in config.** Capture on/off, King kill on/off, several moves per piece per turn, several attacks per piece per turn, moving after attacking, passing through your own pieces, attack cost, archer cost/range/damage, dice count and sides, board size, river column, bridge rows, forest hexes, starting positions.

**Terrain is data.** Each terrain type is a row in `config.terrain` with `passable`, `blocksSight`, `moveCostMultiplier` and `defenseBonus`. A castle can be added as a new row (for example a defence bonus, or a cost to enter) plus any special rules, without rewriting movement or combat.

## Controls

- **Roll dice**, then tap one of your pieces. Green hexes show where it can reach and what it costs. Red dashed hexes are enemies it can hit; the badge shows the damage (✕ = the hit kills).
- Tap a green hex to move, tap a red one to attack or shoot.
- **Undo** steps back within the current turn (never re-rolls the dice).
- **End turn** passes the screen to the other player.
- The log lists every roll, move and hit. **EN / RU** switches the language.

## Open design questions (for Dad)

1. **Castle.** What does it do? Defence bonus, slower to enter, holds several pieces, can archers shoot from it, can it be captured?
2. **Archers.** Can archers fight hand to hand? (Now: no.) Range 2-3 and 1 damage for 2 points: right? Do other pieces, or only forest, block shots? Can they shoot over the river?
3. **Combat.** Is combat really without dice, or is there a roll? Does attacking cost points, and how many? Can one piece attack several times a turn? Does the defender hit back?
4. **Army size.** How many of each piece per side, and where do they start?
5. **Cavalry vs infantry speed.** "Cavalry about 3x infantry" vs the default 1 : 2 : 3 : 6. What are the exact numbers?
6. **King capture.** Is "end the turn next to the King with no defenders beside him" the right capture rule?
7. **Board.** How many hexes was the original folding board (about 1.5 x 1 m)? Where are the river, bridges and forests?
