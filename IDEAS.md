# Ideas backlog

Options saved for later. Nothing here is decided. Rule changes need Dad's yes first.

## Rules (ask Dad)

- **Flanking:** a hit from behind or the side does +1 damage.
- **Cavalry charge:** cavalry that moved 3+ hexes in a straight line before attacking does +1 damage.
- **Counters:** spearmen double damage to cavalry, cavalry runs down archers, archers wear down heavy infantry.
- **Terrain:** hills (archers shoot further, defenders +1), swamp (slow), villages to hold, the castle.
- **Fog of war:** you only see enemies near your pieces (best against the computer or online).
- **Morale:** an army that lost half its pieces, or a surrounded piece, fights worse or retreats.
- **Dice safety net:** a minimum roll of 6, or carry 2 unused points to the next turn.

## Feel

- A five-step guided tutorial (roll, move, attack, shoot, capture the King).
- Painted pieces: small knight and horse figures, different per side.
- Richer map: drawn river banks, trees, roads to the bridges, snow or ice.
- End-of-battle summary (losses, kills per piece type, turns) with a rematch button.
- Replay of the whole battle at speed.
- Quiet medieval music loop.

## Phone play

- Enemy threat view: hold a hex to see which enemies can reach or shoot it next turn.
- Drag a piece along its path and see the cost as you go.
- "Next piece" button for pieces that can still act.
- Confirm before ending a turn with many unused points.
- Saved, named armies.

## More ways to play

- Online play by link (needs a server).
- Computer difficulty levels (easy, normal, hard with two-move look-ahead).
- Scenarios: fixed historical battles, such as the Battle on the Ice.
- More armies: Mongols, Vikings, Byzantines, each with one special piece.
- Map choice or a random map.
- Army sizes of 30, 50 or 80 points.

## UI, visuals and functionality (second round, 2026-11-16)

### Board and pieces
- Facing: pieces visibly turn toward the enemy or the way they last moved.
- Health as a small bar or broken-shield look, so wounded pieces stand out at a glance.
- "Spent" look: pieces you can't afford to move this turn are dimmed.
- Path line: tap a destination to see the route drawn, tap again to confirm.
- Last-move trail: a faint arrow showing what the opponent just did.
- Range rings: an archer's shooting zone drawn when selected.
- Minimap in a corner when zoomed in, tap to jump.
- Auto-follow: the camera glides to the computer's moves.
- Day and night or weather skins (snow, autumn, dusk) as cosmetic themes.
- Board edge: a drawn wooden table or map border instead of a hard cut-off.

### Screens and flow
- Title screen with painted art, the two coats of arms and a "Continue" button.
- Animated battle intro: armies revealed with a horn and a banner wipe.
- Turn banner: "Novgorod's turn" slides across at each handover.
- Victory screen with the fallen King, stats and share-a-picture.
- Settings page: sound, music, animation speed, language, left-handed layout.
- Rules page inside the game, with pictures, in both languages.
- Army builder presets: Balanced, Cavalry rush, Shield wall, Archer line.
- Deployment tools: mirror left-right, clear all, drag pieces around, save formation.

### Feedback and polish
- Haptics: a small buzz on dice, hits and kills (Android; limited on iPhone).
- Dice you can flick or shake the phone to roll, with 3D-looking tumbling dice.
- Screen shake and dust on heavy cavalry hits; arrows that arc.
- Points counter that drains like a bar, turning red when low.
- Combat forecast card: attacker vs defender side by side before you confirm.
- Kill feed: small portraits of fallen pieces lined up beside each army's banner.
- Undo that visibly rewinds the move.

### Functionality
- Install as an app: home-screen icon, splash screen, works offline.
- Several save slots and a "resume last battle" list.
- Share a battle: a link or code that loads the same armies and map.
- Speed controls for the computer's turn (normal, fast, instant).
- Hint button: the computer suggests a move for you.
- Accessibility: colour-blind safe army colours and patterns, larger text option.
- Tablet and desktop layouts with a permanent side panel and keyboard shortcuts.
- Map editor: paint forest, river and bridges, save and share maps.

## From the simulation (2026-11-16, 400 computer-vs-computer games, `npm run sim`)

Findings: typical game 60 rounds (far too long); archers make 52% of kills from 13% of pieces; heavy infantry 0.12 kills each (no job); light cavalry 0% survival; 23% of rolled points unused; first mover wins 54%; luckier roller wins 59%; King captured in only 3 of 80 games. Report: https://claude.ai/artifact/MopJeX6vBAnCZJruauzzZo

- Rules to test with Dad: morale (rout at half the army's points lost), shield wall (+1 defense for adjacent heavy infantry, spears hit charging cavalry back), arrows weaker past 3 hexes and limited volleys, cavalry charge and flanking, King's command aura, carry up to 3 unused points, second player +2 points on turn 1.
- Factions: Mongols (horse archers, feigned retreat), Japanese (samurai, ashigaru spears, honour), Teutonic (knight brothers, discipline), Novgorod (militia, home forest), Vikings (berserkers, longships), English (longbow, stakes), Byzantines (cataphracts, Greek fire), Saracens (camels scare horses).
- Custom battle screen: army points, map type, board size, factions, dice / fixed points, victory type, fog of war, hidden setup, turn timer, computer difficulty, saved setups.
- Chess-like: no-dice Tactician mode, zone of control, facing, counters, key ground, activations.
- UX: piece card bottom sheet, tap-to-preview path then confirm, threat view, next-piece button, installable app; desktop hover info, right-click menu, tab through pieces.
