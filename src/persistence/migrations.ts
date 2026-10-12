import { SAVE_SCHEMA } from '../game/init';
import { SaveError } from './types';

type Migration = (s: Record<string, unknown>) => Record<string, unknown>;

/**
 * Ordered migrations keyed by the schema version they upgrade FROM.
 * Add an entry here whenever GameState changes shape and bump SAVE_SCHEMA.
 */
const MIGRATIONS: Record<number, Migration> = {
  // 1: (s) => ({ ...s, schema: 2, newField: default }),
};

export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let s = raw;
  let v = typeof s.schema === 'number' ? s.schema : 0;
  if (v > SAVE_SCHEMA) throw new SaveError(`This save was made by a newer version of Trading Floor (schema ${v}).`, 'incompatible');
  while (v < SAVE_SCHEMA) {
    const m = MIGRATIONS[v];
    if (!m) throw new SaveError(`No migration path from save schema ${v}.`, 'incompatible');
    s = m(s);
    v = s.schema as number;
  }
  return s;
}
