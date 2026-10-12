import type { GameState } from '../game/types';

export interface SaveMeta {
  slot: string;
  gameId: string;
  fundName: string;
  difficulty: string;
  preset: string;
  date: string;
  day: number;
  daysPlayed: number;
  nav: number; // cents
  status: string;
  savedAt: number;
  schema: number;
  label: string;
  logo?: { mark: string; color: string; accent: string };
}

export interface SaveRecord {
  meta: SaveMeta;
  state: GameState;
}

/** Common interface for local (IndexedDB) and cloud save backends. */
export interface SaveRepository {
  readonly kind: 'local' | 'cloud';
  list(): Promise<SaveMeta[]>;
  load(slot: string): Promise<GameState>;
  save(slot: string, state: GameState, label?: string): Promise<SaveMeta>;
  remove(slot: string): Promise<void>;
}

export class SaveError extends Error {
  constructor(message: string, readonly code: 'not-found' | 'corrupt' | 'incompatible' | 'storage' | 'auth' | 'network') {
    super(message);
  }
}

export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5'];
export const autoSlot = (gameId: string) => `auto:${gameId}`;
