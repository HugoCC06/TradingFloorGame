import { summarize } from '../accounting';
import { submitOrder } from '../orders';
import { nextDay, runToClose } from '../sim';
import type { GameState } from '../types';
import { assertLedger, fresh } from './helpers';

type Strategy = (g: GameState, day: number) => void;

const passive: Strategy = (g, day) => {
  if (day !== 0) return;
  const tfx = g.instruments[g.benchmarkIdx];
  const q = Math.floor((summarize(g).nav * 0.9) / 100 / tfx.price);
  submitOrder(g, { instrument: tfx.id, side: 'buy', type: 'market', quantity: q, tif: 'day' });
};

const reckless: Strategy = (g, day) => {
  if (day % 5 !== 0) return;
  const vol = g.instruments.filter((i) => i.kind === 'equity' && i.adv * i.price > 3e8).sort((a, b) => b.vol - a.vol).slice(0, 2);
  for (const inst of vol) {
    const s = summarize(g);
    const room = s.nav * 0.95 - s.gross / 2;
    const q = Math.floor(Math.max(0, room) / 100 / inst.price);
    if (q > 0) submitOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: Math.min(q, Math.floor(inst.adv * 0.1)), tif: 'day' });
  }
};

const idle: Strategy = () => {};

function run(seed: number, strat: Strategy, days: number) {
  const g = fresh({ seed, difficulty: 'normal' });
  for (let d = 0; d < days && g.status === 'active'; d++) {
    strat(g, d);
    runToClose(g);
    assertLedger(g);
    if (g.status === 'active') nextDay(g);
  }
  return g;
}

describe('long-run balance & stress', () => {
  test('invariants hold over 50 days for passive, reckless and idle strategies; risk has consequences', () => {
    const results: { seed: number; passive: GameState; reckless: GameState; idle: GameState }[] = [];
    for (const seed of [1001, 1002]) {
      results.push({ seed, passive: run(seed, passive, 50), reckless: run(seed, reckless, 50), idle: run(seed, idle, 50) });
    }
    for (const r of results) {
      const p = r.passive, k = r.reckless, i = r.idle;
      console.log(`seed ${r.seed}: passive ret ${(summarize(p).navPerUnit - 100).toFixed(1)}% dd ${(p.stats.maxDrawdown * 100).toFixed(1)}% | reckless ret ${(summarize(k).navPerUnit - 100).toFixed(1)}% dd ${(k.stats.maxDrawdown * 100).toFixed(1)}% marginCalls ${k.risk.marginCalls} breachDays ${k.risk.totalBreachDays} status ${k.status} | idle avgConf ${(i.clients.filter((c) => c.type !== 'founder').reduce((a, c) => a + c.confidence, 0) / Math.max(1, i.clients.filter((c) => c.type !== 'founder').length)).toFixed(0)} company cash ${(i.company.cash / 100).toFixed(0)}`);
      expect(p.status).toBe('active');
      // reckless concentration breaches risk limits and is punished
      expect(k.risk.totalBreachDays).toBeGreaterThan(p.risk.totalBreachDays);
      expect(k.stats.maxDrawdown).toBeGreaterThan(p.stats.maxDrawdown * 0.8);
      expect(p.daily.every((d) => Number.isFinite(d.navPerUnit))).toBe(true);
    }
    // reckless client confidence ends lower than passive on average (breaches & volatility)
    const conf = (g: GameState) => { const ext = g.clients.filter((c) => c.type !== 'founder' && c.status !== 'departed'); return ext.length ? ext.reduce((a, c) => a + c.confidence, 0) / ext.length : 0; };
    const avgReck = results.reduce((a, r) => a + conf(r.reckless), 0), avgPass = results.reduce((a, r) => a + conf(r.passive), 0);
    expect(avgReck).toBeLessThan(avgPass);
  }, 180_000);
});
