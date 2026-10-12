import { useSyncExternalStore } from 'react';
import type { GameState } from '../game/types';
import { controller } from './controller';
import { getSettings, subscribeSettings, type Settings } from './settings';

/** Re-render on every published simulation update; returns the live state. */
export function useGame(): GameState {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  if (!controller.state) throw new Error('No active game');
  return controller.state;
}

export function useGameMaybe(): GameState | null {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  return controller.state;
}

export function useVersion(): number {
  return useSyncExternalStore(controller.subscribe, controller.getVersion);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
