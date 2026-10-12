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
