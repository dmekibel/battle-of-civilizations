import type { TerrainId, UnitTypeId } from '../config';
import type { Hex } from './hex';

export type Player = 'red' | 'blue';

export interface Unit {
  id: string;
  type: UnitTypeId;
  owner: Player;
  pos: Hex;
  hp: number;
  /** Set once the unit has moved this turn. */
  moved: boolean;
  /** Set once the unit has attacked or shot this turn. */
  attacked: boolean;
}

/** draft = buying an army, deploy = placing it in secret, then the battle: roll / act. */
export type Phase = 'draft' | 'deploy' | 'roll' | 'act' | 'over';

export type WinReason = 'kingKilled' | 'kingCaptured';

export type LogEntry =
  | { kind: 'roll'; turn: number; player: Player; dice: number[]; total: number }
  | { kind: 'move'; turn: number; player: Player; unit: UnitTypeId; from: Hex; to: Hex; cost: number }
  | {
      kind: 'attack' | 'shoot';
      turn: number;
      player: Player;
      unit: UnitTypeId;
      target: UnitTypeId;
      damage: number;
      killed: boolean;
      /** The attacker stepped into the dead piece's hex. */
      advanced?: boolean;
      /** Where the attacker stood and where the target stood. */
      from: Hex;
      at: Hex;
      cost: number;
    }
  | { kind: 'endTurn'; turn: number; player: Player }
  | { kind: 'win'; turn: number; player: Player; reason: WinReason };

export interface GameState {
  /** Terrain per hex, indexed [row][col]. */
  board: TerrainId[][];
  units: Unit[];
  /** Bought pieces not yet placed on the board, per side. */
  reserve: Record<Player, UnitTypeId[]>;
  /** Counter for unique unit ids. */
  seq: number;
  turn: number;
  current: Player;
  phase: Phase;
  dice: number[] | null;
  points: number;
  winner: Player | null;
  winReason: WinReason | null;
  /** Set right after a melee kill when advancing is optional: who may step where. */
  advance: { unitId: string; to: Hex } | null;
  log: LogEntry[];
}

export type ErrorCode =
  | 'wrongPhase'
  | 'noSuchUnit'
  | 'notYourUnit'
  | 'notEnemy'
  | 'unreachable'
  | 'notAdjacent'
  | 'notEnoughPoints'
  | 'cannotMelee'
  | 'cannotShoot'
  | 'outOfRange'
  | 'noLineOfSight'
  | 'alreadyAttacked'
  | 'alreadyMoved'
  | 'overBudget'
  | 'badArmy'
  | 'tooManyPieces'
  | 'notInReserve'
  | 'outsideZone'
  | 'blocked'
  | 'occupied'
  | 'reserveNotEmpty'
  | 'nothingToTake';

export type Result = { ok: true; state: GameState } | { ok: false; error: ErrorCode };
