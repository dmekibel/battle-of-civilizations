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

export type Phase = 'roll' | 'act' | 'over';

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
      cost: number;
    }
  | { kind: 'endTurn'; turn: number; player: Player }
  | { kind: 'win'; turn: number; player: Player; reason: WinReason };

export interface GameState {
  /** Terrain per hex, indexed [row][col]. */
  board: TerrainId[][];
  units: Unit[];
  turn: number;
  current: Player;
  phase: Phase;
  dice: number[] | null;
  points: number;
  winner: Player | null;
  winReason: WinReason | null;
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
  | 'alreadyMoved';

export type Result = { ok: true; state: GameState } | { ok: false; error: ErrorCode };
