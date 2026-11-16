# Battle of Civilizations · Битва цивилизаций

A digital prototype of a hex-grid war board game designed by David's father. Two players share one screen and take turns (hot-seat). No server.

The first armies are **Novgorod** (crimson and gold) and the **Teutonic Order** (black and white), as in the Battle on the Ice of 1242. The game saves itself after every move, so closing the app or locking the phone loses nothing. Sounds are made in code (dice, steel, arrows, war horn) and can be muted in the menu.

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

**Board.** 25 x 15 hexes (about twice the first 17 x 11). A river runs down the middle with 2 bridges. Forest hexes block movement. The armies start on opposite sides.

**Turns.** Red goes first. On your turn, roll 3 six-sided dice. The total (3 to 18) is your movement points for the turn. Split them however you like among your pieces: move, attack and shoot until you run out or press **End turn**. Unused points are lost.

**Pieces** (default values, all in `src/config.ts`):

| Piece | Points per hex | Attack | Defense | Picture |
|---|---|---|---|---|
| King | 6 | 1 | 2 | crown, filled box |
| Heavy infantry | 6 | 1 | 2 | shield and sword, filled box |
| Light infantry | 3 | 1 | 1 | spear, outlined box |
| Heavy cavalry | 2 | 2 | 2 | horse with lance, filled box |
| Light cavalry | 1 | 1 | 1 | horse, outlined box |
| Archers | 4 | no melee | 1 | bow and arrow, outlined box |

Speed ratio heavy infantry : light infantry : heavy cavalry : light cavalry = 1 : 2 : 3 : 6.

**Movement.** Each hex costs the piece's points per hex. You can't enter forest or river (only bridges cross it), can't enter or pass through enemy pieces, and can pass through (but not stop on) your own pieces. A piece may move several times in a turn while points last.

**Attack and defense.** Every piece has attack points and defense points (the dots under it). A piece next to an enemy spends 1 movement point to hit it, taking away as many defense points as its attack. At 0 defense the piece is dead and removed. You can attack as many times as your rolled points allow. No dice in combat.

**Taking the hex.** When a piece kills an enemy in melee, it steps into that enemy's hex for free. A config switch sets this to *must* (now), *may* (the player chooses, with a **Take the hex** button) or *never*. Archers stay where they are after a kill.

**Archers.** Spend 2 points to shoot an enemy 2 to 3 hexes away for 1 damage. Forest between the archer and the target blocks the shot; the river does not.

**Winning.**
- Reduce the enemy King to 0 HP, or
- End your turn with one of your pieces next to the enemy King and no enemy defenders next to him (capture).

**Building an army.** Each player has 50 points to buy pieces, using a slider (or − / +) per piece type; the chosen pieces appear right under each slider. Price = the piece's power: light infantry 1, heavy infantry 2, archers 3, light cavalry 3, heavy cavalry 4. Every army gets one King for free. Unspent points are lost.

**Secret setup.** Red builds an army and places it while Blue looks away, then hands the phone over and Blue does the same. Each side places pieces only in its own zone: the 5 columns nearest its edge. Neither player sees the other army until the battle starts. **Auto** places the remaining pieces in a battle formation: heavy infantry holds the front centre, light infantry extends the line, archers stand one rank behind, heavy cavalry on the wings, light cavalry on the outer wings, and the King at the back. **🎲 Auto army** picks a balanced army for the budget, and **⚡ Auto everything** builds, places and hands over in one tap.

**Against the computer.** Pick it on the start screen: you lead Novgorod, the computer leads the Teutonic Order. It builds and places its own army, then plays greedily one step at a time: it takes the best kill or hit it can see, otherwise marches its army together towards the enemy King (crossing at the bridges), keeps archers at shooting range and its King out of reach. It doesn't plan ahead, so it can be beaten. Code: `src/engine/ai.ts`.

**Quick battle** (in the menu) skips setup with a fixed army: 1 King, 4 heavy infantry, 4 light infantry, 2 heavy cavalry, 2 light cavalry, 2 archers.

**Rule switches in config.** Capture on/off, King kill on/off, several moves per piece per turn, several attacks per piece per turn, moving after attacking, passing through your own pieces, attack cost, archer cost/range/damage, dice count and sides, board size, river column, bridge rows, forest hexes, starting positions.

**Terrain is data.** Each terrain type is a row in `config.terrain` with `passable`, `blocksSight`, `moveCostMultiplier` and `defenseBonus`. A castle can be added as a new row (for example a defence bonus, or a cost to enter) plus any special rules, without rewriting movement or combat.

## Controls

- On a phone the board fills the screen, in portrait or landscape. **Roll dice**, then tap one of your pieces. Green hexes show where it can reach and what it costs. Red dashed hexes are enemies it can hit; the badge shows the damage (✕ = the hit kills).
- Tap a green hex to move, tap a red one to attack or shoot.
- **Undo** steps back within the current turn (never re-rolls the dice).
- **End turn** passes the screen to the other player.
- **On a computer** (wide screen): the pieces list, log and settings stay open in a side panel. Keys: Space roll, Enter end turn, U or Ctrl+Z undo, + / − zoom, Esc deselect. Drag the map with the mouse; a trackpad pinch zooms it.
- The log lists every roll, move and hit. **EN / RU** switches the language (in the menu ☰).

## Open design questions (for Dad)

1. **Castle.** What does it do? Defence bonus, slower to enter, holds several pieces, can archers shoot from it, can it be captured?
2. **Archers.** Can archers fight hand to hand? (Now: no.) Range 2-3 and 1 damage for 2 points: right? Do other pieces, or only forest, block shots? Can they shoot over the river?
3. **Combat.** Is combat really without dice, or is there a roll? Does attacking cost points, and how many? Can one piece attack several times a turn? Does the defender hit back?
4. **Army building.** Is 50 points right? Does the King cost anything? Is there a limit per piece type (for example at most 6 cavalry)? How deep is each side’s setup zone (now 5 columns)?
5. **Cavalry vs infantry speed.** "Cavalry about 3x infantry" vs the default 1 : 2 : 3 : 6. What are the exact numbers?
6. **King capture.** Is "end the turn next to the King with no defenders beside him" the right capture rule?
7. **Board.** How many hexes was the original folding board (about 1.5 x 1 m)? Where are the river, bridges and forests?
8. **Taking the hex.** After killing a piece, must the attacker step into its hex, or may it choose? (Now: must.)
9. **Power.** Is "power" only the price of a piece, or does it also matter in combat?
