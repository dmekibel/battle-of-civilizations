// Undo within the current turn. Rolling the dice and ending the turn are checkpoints
// that clear the history, so dice can never be re-rolled by undoing.

import type { GameState, Result } from './types';

export interface Session {
  state: GameState;
  undo: GameState[];
}

export const startSession = (state: GameState): Session => ({ state, undo: [] });

/** Applies a rule action; on success the previous state becomes undoable. */
export function apply(sess: Session, act: (s: GameState) => Result, checkpoint = false): { sess: Session; result: Result } {
  const result = act(sess.state);
  if (!result.ok) return { sess, result };
  const undo = checkpoint ? [] : [...sess.undo, sess.state];
  return { sess: { state: result.state, undo }, result };
}

export const canUndo = (sess: Session) => sess.undo.length > 0;

export function undo(sess: Session): Session {
  if (!canUndo(sess)) return sess;
  return { state: sess.undo[sess.undo.length - 1], undo: sess.undo.slice(0, -1) };
}
