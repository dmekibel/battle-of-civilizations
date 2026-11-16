// Every tunable number and rule switch lives here. Many rules are still being
// play-tested, so the engine reads only from this object and never hard-codes values.

export type UnitTypeId =
  | 'king'
  | 'heavyInfantry'
  | 'lightInfantry'
  | 'heavyCavalry'
  | 'lightCavalry'
  | 'archer';

export type TerrainId = 'plain' | 'forest' | 'river' | 'bridge';

export interface TerrainRules {
  passable: boolean;
  /** Blocks archer line of sight when it lies between shooter and target. */
  blocksSight: boolean;
  /** Multiplies a unit's per-hex move cost when entering this hex. */
  moveCostMultiplier: number;
  /** Damage subtracted from every hit on a unit standing here (hook for a future castle). */
  defenseBonus: number;
}

export interface RangedRules {
  /** Movement points spent per shot. */
  cost: number;
  minRange: number;
  maxRange: number;
  damage: number;
}

export interface UnitRules {
  /** Movement points to enter one plain hex. */
  moveCost: number;
  /** Melee damage dealt per attack. 0 means the unit cannot melee. */
  attack: number;
  /** Hit points; equal to the defence value. */
  hp: number;
  ranged: RangedRules | null;
  /** Heavy units draw with a filled symbol, light units with an outline. */
  heavy: boolean;
}

export type Placement = [type: UnitTypeId, col: number, row: number];

export interface GameConfig {
  board: {
    cols: number;
    rows: number;
    /** Column the river runs down (top to bottom). null = no river. */
    riverCol: number | null;
    /** Rows where the river has a bridge. */
    bridgeRows: number[];
    /** [col, row] of each forest hex. */
    forests: [number, number][];
  };
  terrain: Record<TerrainId, TerrainRules>;
  dice: { count: number; sides: number };
  units: Record<UnitTypeId, UnitRules>;
  combat: {
    /** Movement points spent per melee attack. */
    attackCost: number;
    /** A unit may attack (or shoot) more than once per turn while points last. */
    multipleAttacksPerUnit: boolean;
    /** A unit may move after it has attacked this turn. */
    moveAfterAttack: boolean;
    /** After a melee kill the attacker steps into the dead piece's hex for free:
     *  'must' = always, 'may' = the player chooses, 'never' = stays put. Shooting never advances. */
    advanceAfterKill: 'must' | 'may' | 'never';
  };
  movement: {
    /** Units may move through hexes holding their own side's units (never stop there). */
    passThroughFriendly: boolean;
    /** A unit may make several separate moves in one turn while points last. */
    multipleMovesPerUnit: boolean;
  };
  win: {
    /** Reducing the enemy King to 0 HP wins. */
    killKing: boolean;
    /** Ending your turn next to the enemy King with no enemy defenders beside it wins. */
    captureKing: boolean;
  };
  army: {
    /** Points each player spends on their army before the battle. */
    budget: number;
    /** Price of each piece ("power"). The King is not bought: every army gets exactly one. */
    cost: Record<Exclude<UnitTypeId, 'king'>, number>;
  };
  deploy: {
    /** How many columns from your own edge you may set up in. */
    depth: number;
  };
  /** Quick-battle army for Red (and tests). Blue gets the mirror image (col -> cols - 1 - col). */
  setup: Placement[];
}

export const CONFIG: GameConfig = {
  board: {
    // About twice the original 17 x 11 (375 hexes instead of 187).
    cols: 25,
    rows: 15,
    riverCol: 12,
    bridgeRows: [3, 11],
    // Red's half; Blue's half is the mirror image (col -> 24 - col).
    forests: [
      [6, 1], [7, 1], [7, 2],
      [6, 13], [7, 12], [7, 13],
      [9, 6], [9, 7],
      [10, 10], [10, 11],
      [10, 3],
      [18, 1], [17, 1], [17, 2],
      [18, 13], [17, 12], [17, 13],
      [15, 6], [15, 7],
      [14, 10], [14, 11],
      [14, 3],
    ],
  },
  terrain: {
    plain: { passable: true, blocksSight: false, moveCostMultiplier: 1, defenseBonus: 0 },
    forest: { passable: false, blocksSight: true, moveCostMultiplier: 1, defenseBonus: 0 },
    river: { passable: false, blocksSight: false, moveCostMultiplier: 1, defenseBonus: 0 },
    bridge: { passable: true, blocksSight: false, moveCostMultiplier: 1, defenseBonus: 0 },
  },
  dice: { count: 3, sides: 6 },
  // Speed ratio heavy inf : light inf : heavy cav : light cav = 1 : 2 : 3 : 6.
  units: {
    king: { moveCost: 6, attack: 1, hp: 2, ranged: null, heavy: true },
    heavyInfantry: { moveCost: 6, attack: 1, hp: 2, ranged: null, heavy: true },
    lightInfantry: { moveCost: 3, attack: 1, hp: 1, ranged: null, heavy: false },
    heavyCavalry: { moveCost: 2, attack: 2, hp: 2, ranged: null, heavy: true },
    lightCavalry: { moveCost: 1, attack: 1, hp: 1, ranged: null, heavy: false },
    // Melee for archers is an open question; 0 = they only shoot.
    archer: {
      moveCost: 4,
      attack: 0,
      hp: 1,
      ranged: { cost: 2, minRange: 2, maxRange: 6, damage: 1 }, // range 2-6 per David, 2026-11-16
      heavy: false,
    },
  },
  combat: { attackCost: 1, multipleAttacksPerUnit: true, moveAfterAttack: true, advanceAfterKill: 'must' },
  movement: { passThroughFriendly: true, multipleMovesPerUnit: true },
  win: { killKing: true, captureKing: true },
  army: {
    budget: 50,
    cost: { lightInfantry: 1, heavyInfantry: 2, archer: 3, lightCavalry: 3, heavyCavalry: 4 },
  },
  // 5 columns leave room for the largest possible army (50 light infantry and the King).
  deploy: { depth: 5 },
  setup: [
    ['king', 0, 7],
    ['archer', 1, 6],
    ['archer', 1, 8],
    ['heavyCavalry', 1, 4],
    ['heavyCavalry', 1, 10],
    ['heavyInfantry', 2, 5],
    ['heavyInfantry', 2, 6],
    ['heavyInfantry', 2, 8],
    ['heavyInfantry', 2, 9],
    ['lightCavalry', 2, 3],
    ['lightCavalry', 2, 11],
    ['lightInfantry', 3, 5],
    ['lightInfantry', 3, 6],
    ['lightInfantry', 3, 7],
    ['lightInfantry', 3, 8],
  ],
};
