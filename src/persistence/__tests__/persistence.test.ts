import 'fake-indexeddb/auto';
import { navCents } from '../../game/accounting';
import { submitOrder } from '../../game/orders';
import { stepMinute } from '../../game/sim';
import { fresh, openMarket, steps } from '../../game/__tests__/helpers';
import { LocalSaveRepository, metaFor } from '../local';
import { migrate } from '../migrations';
import { emptyProfile, mergeRun } from '../profile';
import { fromJSON, toJSON } from '../serialize';
import { SaveError } from '../types';
import { validateState } from '../validate';

const repo = new LocalSaveRepository();

describe('local save repository', () => {
  test('save and reload mid-session resumes the identical simulation (no reroll)', async () => {
    const g = fresh({ seed: 555 });
    openMarket(g);
    const inst = g.instruments.find((i) => i.kind === 'equity')!;
    submitOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: 100, tif: 'day' });
    submitOrder(g, { instrument: inst.id, side: 'sell', type: 'limit', quantity: 50, limitPrice: Math.round(inst.price * 1.3 * 100) / 100, tif: 'gtc' });
    steps(g, 37);
    await repo.save('slot1', g, 'Test');
    const loaded = await repo.load('slot1');
    expect(loaded.clock).toEqual(g.clock);
    expect(navCents(loaded)).toBe(navCents(g));
    expect(loaded.instruments.map((i) => i.name)).toEqual(g.instruments.map((i) => i.name));
    expect(loaded.orders.filter((o) => o.status === 'open').length).toBe(1);
    expect(loaded.history.m1[0].c).toBeInstanceOf(Float32Array);
    // continuing both copies yields identical prices and news
    for (let i = 0; i < 60; i++) { stepMinute(g); stepMinute(loaded); }
    expect(loaded.instruments.map((i) => i.price)).toEqual(g.instruments.map((i) => i.price));
    expect(loaded.news.map((n) => n.headline)).toEqual(g.news.map((n) => n.headline));
    expect(navCents(loaded)).toBe(navCents(g));
  });

  test('lists multiple slots with metadata, newest first, and deletes', async () => {
    const a = fresh({ seed: 1, fundName: 'Alpha Fund' });
    const b = fresh({ seed: 2, fundName: 'Beta Fund' });
    await repo.save('slot2', a);
    await new Promise((r) => setTimeout(r, 5));
    await repo.save('slot3', b);
    const list = await repo.list();
    const names = list.map((m) => m.fundName);
    expect(names.indexOf('Beta Fund')).toBeLessThan(names.indexOf('Alpha Fund'));
    expect(list.find((m) => m.slot === 'slot2')!.fundName).toBe('Alpha Fund');
    await repo.remove('slot3');
    expect((await repo.list()).some((m) => m.slot === 'slot3')).toBe(false);
  });

  test('a corrupted save fails gracefully, and the previous good copy is restored from backup', async () => {
    const g = fresh({ seed: 77 });
    await repo.save('slot4', g);
    steps(g, 5);
    await repo.save('slot4', g); // creates backup of the first save
    await repo._putRaw('slot4', { schema: 1, id: 'broken' }, metaFor('slot4', g));
    const restored = await repo.load('slot4');
    expect(restored.id).toBe(g.id); // backup copy
    await repo._putRaw('slot5', { garbage: true }, metaFor('slot5', g));
    await expect(repo.load('slot5')).rejects.toBeInstanceOf(SaveError);
    await expect(repo.load('nope')).rejects.toThrow(/No save/);
  });

  test('refuses to write an invalid state', async () => {
    const g = fresh({ seed: 78 });
    (g as unknown as { instruments: unknown[] }).instruments = [];
    await expect(repo.save('slot1', g)).rejects.toThrow(/validation/);
  });
});

describe('serialisation, validation and migration', () => {
  test('JSON export/import round-trips typed arrays exactly', () => {
    const g = fresh({ seed: 3 });
    steps(g, 20);
    const back = fromJSON(toJSON(g)) as typeof g;
    expect(validateState(back)).toEqual([]);
    expect(back.history.m1[5].c).toBeInstanceOf(Float32Array);
    expect(Array.from(back.history.m1[5].c)).toEqual(Array.from(g.history.m1[5].c));
    expect(back.rng).toEqual(g.rng);
  });

  test('validation catches missing or corrupt data', () => {
    expect(validateState(null).length).toBeGreaterThan(0);
    expect(validateState({ schema: 1 }).length).toBeGreaterThan(3);
    const g = fresh({ seed: 4 });
    g.instruments[3].price = -1;
    expect(validateState(g).join()).toMatch(/invalid price/);
  });

  test('saves from a newer schema are rejected as incompatible', () => {
    expect(() => migrate({ garbage: 1 })).toThrow(/corrupted/);
    expect(() => migrate({ schema: 999 })).toThrow(/newer version/);
    expect(migrate({ schema: 1, a: 1 })).toEqual({ schema: 1, a: 1 });
  });

  test('career profile merges runs and achievements', () => {
    const g = fresh({ seed: 6 });
    g.achievements.push('first_trade');
    const p = mergeRun(emptyProfile(), g);
    expect(p.career).toHaveLength(1);
    expect(p.achievements.first_trade).toBeDefined();
    mergeRun(p, g);
    expect(p.career).toHaveLength(1);
  });
});
