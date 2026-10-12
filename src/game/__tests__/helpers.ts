import { newGame } from '../init';
import { nextDay, runToClose } from '../sim';
import type { GameSetup, GameState } from '../types';

export function setup(over: Partial<GameSetup> = {}): GameSetup {
  return {
    fundName: 'Test Capital', description: '', logo: { mark: 'TF', color: '#3b82f6', accent: '#ffffff' },
    difficulty: 'normal', preset: 'founder', tutorial: false, seed: 12345, ...over,
  };
}

export function game(over: Partial<GameSetup> = {}): GameState {
  return newGame(setup(over));
}

/** Play `n` full days (no player actions). */
export function playDays(state: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    if (state.status !== 'active') return;
    if (state.clock.phase === 'closed') nextDay(state);
    runToClose(state);
  }
}

import { stepMinute } from '../sim';
import { instById, navCents, summarize } from '../accounting';

let cached: Record<string, GameState> = {};
/** Fresh deep copy of a cached new game (newGame is relatively expensive). */
export function fresh(over: Partial<GameSetup> = {}): GameState {
  const key = JSON.stringify(over);
  if (!cached[key]) cached[key] = newGame(setup(over));
  return structuredClone(cached[key]);
}
export function clearCache() { cached = {}; }

/** Advance into the session (09:30 bar processed). */
export function openMarket(state: GameState) {
  if (state.clock.phase === 'pre') stepMinute(state);
}

export function steps(state: GameState, n: number) {
  for (let i = 0; i < n; i++) stepMinute(state);
}

/** NAV must always equal cash + longs − shorts and be finite. */
export function assertLedger(state: GameState) {
  const s = summarize(state);
  if (!Number.isFinite(s.nav) || !Number.isFinite(state.fund.cash)) throw new Error('non-finite ledger');
  if (s.nav !== state.fund.cash + s.longValue - s.shortValue) throw new Error('NAV does not reconcile');
  if (navCents(state) !== s.nav) throw new Error('navCents mismatch');
  for (const i of state.instruments) if (!(i.price > 0) || !Number.isFinite(i.price)) throw new Error(`bad price ${i.id}`);
}

export function equity(state: GameState, pred: (i: GameState['instruments'][number]) => boolean = () => true) {
  return state.instruments.find((i) => i.kind === 'equity' && i.shortable && pred(i))!;
}

export { instById };
