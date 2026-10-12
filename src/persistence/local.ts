import type { GameState } from '../game/types';
import { idbGet, idbKeys, idbWrite, STORES } from './idb';
import { migrate } from './migrations';
import { snapshot } from './serialize';
import { SaveError, type SaveMeta, type SaveRecord, type SaveRepository } from './types';
import { assertValid } from './validate';

const META_PREFIX = 'meta:';
const DATA_PREFIX = 'data:';
const BAK_PREFIX = 'bak:';

export function metaFor(slot: string, state: GameState, label?: string): SaveMeta {
  const last = state.daily[state.daily.length - 1];
  return {
    slot, gameId: state.id, fundName: state.setup.fundName, difficulty: state.setup.difficulty, preset: state.setup.preset,
    date: state.clock.date, day: state.clock.day, daysPlayed: state.daily.length, nav: last?.nav ?? state.fund.cash,
    status: state.status, savedAt: Date.now(), schema: state.schema, label: label ?? '', logo: state.setup.logo,
  };
}

/**
 * IndexedDB-backed saves. Metadata and state are stored under separate keys so
 * listing is cheap. Each write validates the snapshot first and keeps the
 * previous good copy as a backup in the same atomic transaction, so a valid
 * save is never replaced by a partial one.
 */
export class LocalSaveRepository implements SaveRepository {
  readonly kind = 'local' as const;

  async list(): Promise<SaveMeta[]> {
    const keys = await idbKeys(STORES.saves);
    const metas: SaveMeta[] = [];
    for (const k of keys) {
      if (!k.startsWith(META_PREFIX)) continue;
      const m = await idbGet<SaveMeta>(STORES.saves, k);
      if (m) metas.push(m);
    }
    return metas.sort((a, b) => b.savedAt - a.savedAt);
  }

  async load(slot: string): Promise<GameState> {
    const raw = await idbGet<Record<string, unknown>>(STORES.saves, DATA_PREFIX + slot);
    if (!raw) throw new SaveError('No save in this slot.', 'not-found');
    try {
      const s = migrate(raw);
      assertValid(s);
      return s;
    } catch (e) {
      const bak = await idbGet<Record<string, unknown>>(STORES.saves, BAK_PREFIX + slot);
      if (bak) {
        try {
          const s = migrate(bak);
          assertValid(s);
          console.warn('Primary save corrupt; restored backup', e);
          return s;
        } catch { /* fall through */ }
      }
      if (e instanceof SaveError) throw e;
      throw new SaveError('The save file is corrupted and could not be loaded.', 'corrupt');
    }
  }

  async save(slot: string, state: GameState, label?: string): Promise<SaveMeta> {
    const snap = snapshot(state);
    snap.updatedAt = Date.now();
    assertValid(snap);
    const meta = metaFor(slot, snap, label);
    const prev = await idbGet<unknown>(STORES.saves, DATA_PREFIX + slot);
    try {
      await idbWrite(STORES.saves, [
        ...(prev ? [{ put: [BAK_PREFIX + slot, prev] as [string, unknown] }] : []),
        { put: [DATA_PREFIX + slot, snap] },
        { put: [META_PREFIX + slot, meta] },
      ]);
    } catch (e) {
      throw new SaveError(`Could not write save: ${(e as Error).message}`, 'storage');
    }
    return meta;
  }

  async remove(slot: string): Promise<void> {
    await idbWrite(STORES.saves, [{ del: META_PREFIX + slot }, { del: DATA_PREFIX + slot }, { del: BAK_PREFIX + slot }]);
  }

  /** Store raw (possibly invalid) data — used by tests to simulate corruption. */
  async _putRaw(slot: string, data: unknown, meta: SaveMeta) {
    await idbWrite(STORES.saves, [{ put: [DATA_PREFIX + slot, data] }, { put: [META_PREFIX + slot, meta] }]);
  }
}

export type { SaveRecord };
