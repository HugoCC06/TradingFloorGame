import type { GameState } from '../game/types';
import { SaveError } from './types';

const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

/** Structural + financial sanity checks before a save is written or loaded. */
export function validateState(s: unknown): string[] {
  const e: string[] = [];
  if (!s || typeof s !== 'object') return ['Save is not an object'];
  const g = s as Partial<GameState>;
  if (!isNum(g.schema)) e.push('missing schema version');
  if (typeof g.id !== 'string') e.push('missing game id');
  if (!g.setup || typeof g.setup.fundName !== 'string') e.push('missing setup');
  if (!g.rng || !Array.isArray(g.rng.market) || g.rng.market.length !== 4) e.push('missing RNG state');
  if (!g.clock || !isNum(g.clock.day) || typeof g.clock.date !== 'string') e.push('missing clock');
  if (!Array.isArray(g.instruments) || g.instruments.length < 200) e.push('instrument universe incomplete');
  else {
    for (const i of g.instruments) {
      if (!isNum(i.price) || i.price <= 0) { e.push(`invalid price for ${i.id}`); break; }
    }
  }
  const h = g.history;
  if (!h || !Array.isArray(h.m1) || !Array.isArray(h.d1) || h.m1.length !== g.instruments?.length || h.d1.length !== g.instruments?.length) e.push('price history incomplete');
  else {
    const d = h.d1[0];
    if (!d || !(d.c instanceof Float32Array) || !(d.t instanceof Float64Array)) e.push('price history arrays corrupt');
  }
  if (!g.fund || !isNum(g.fund.cash) || !isNum(g.fund.unitsOutstanding) || typeof g.fund.positions !== 'object') e.push('fund ledger corrupt');
  else for (const p of Object.values(g.fund.positions)) if (!isNum(p.qty) || !isNum(p.avgPrice)) { e.push('position corrupt'); break; }
  if (!g.company || !isNum(g.company.cash)) e.push('company ledger corrupt');
  if (!Array.isArray(g.clients) || !Array.isArray(g.rivals) || !Array.isArray(g.orders) || !Array.isArray(g.news)) e.push('collections missing');
  return e;
}

export function assertValid(s: unknown): asserts s is GameState {
  const errs = validateState(s);
  if (errs.length) throw new SaveError(`Save failed validation: ${errs.slice(0, 3).join('; ')}`, 'corrupt');
}
