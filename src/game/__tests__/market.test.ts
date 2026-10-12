import { aggregate, barAt, closeAt, sessionStart, toBars } from '../series';
import { nextDay, runToClose, stepMinute } from '../sim';
import { fresh, playDays, steps } from './helpers';

describe('market simulation', () => {
  test('universe has 200+ coherent, uniquely-ticketed fictional instruments', () => {
    const g = fresh();
    expect(g.instruments.length).toBeGreaterThanOrEqual(200);
    const ids = new Set(g.instruments.map((i) => i.id));
    expect(ids.size).toBe(g.instruments.length);
    const names = new Set(g.instruments.map((i) => i.name));
    expect(names.size).toBe(g.instruments.length);
    for (const i of g.instruments) {
      expect(i.name).not.toMatch(/company \d|test|lorem/i);
      expect(i.price).toBeGreaterThan(0);
    }
    expect(g.instruments.filter((i) => i.kind === 'etf').length).toBeGreaterThanOrEqual(10);
    expect(g.instruments.some((i) => i.id === 'GOLD')).toBe(true);
    expect(g.instruments.some((i) => i.id === 'CRUD')).toBe(true);
    // fundamentals coherence: low-quality companies carry more leverage than high-quality ones on average
    const eq = g.instruments.filter((i) => i.kind === 'equity');
    const lev = (arr: typeof eq) => arr.reduce((a, i) => a + i.fundamentals!.debt / i.fundamentals!.revenue, 0) / arr.length;
    const marg = (arr: typeof eq) => arr.reduce((a, i) => a + i.fundamentals!.margin, 0) / arr.length;
    const lo = eq.filter((i) => i.fundamentals!.quality < 35), hi = eq.filter((i) => i.fundamentals!.quality > 65);
    expect(marg(hi)).toBeGreaterThan(marg(lo));
    expect(lev(hi)).toBeLessThan(lev(lo) * 1.2);
  });

  test('seeded games are reproducible and different seeds differ', () => {
    const a = fresh({ seed: 42 }), b = fresh({ seed: 42 }), c = fresh({ seed: 43 });
    expect(a.instruments.map((i) => i.id)).toEqual(b.instruments.map((i) => i.id));
    steps(a, 120);
    steps(b, 120);
    expect(a.instruments.map((i) => i.price)).toEqual(b.instruments.map((i) => i.price));
    expect(a.news.map((n) => n.headline)).toEqual(b.news.map((n) => n.headline));
    const sameNames = c.instruments.filter((i, k) => a.instruments[k]?.name === i.name).length;
    expect(sameNames).toBeLessThan(a.instruments.length * 0.2);
  });

  test('price path depends only on simulated time, not on how steps are batched', () => {
    const a = fresh({ seed: 7 }), b = fresh({ seed: 7 });
    for (let i = 0; i < 60; i++) stepMinute(a);
    steps(b, 30);
    steps(b, 30);
    expect(a.instruments.map((i) => i.price)).toEqual(b.instruments.map((i) => i.price));
  });

  test('the market does not move without simulated time (pause)', () => {
    const g = fresh();
    steps(g, 10);
    const snap = g.instruments.map((i) => i.price);
    // rendering/reading never advances the simulation
    JSON.stringify(g.instruments.slice(0, 5));
    expect(g.instruments.map((i) => i.price)).toEqual(snap);
  });

  test('all candles are valid across every timeframe', () => {
    const g = fresh();
    playDays(g, 3);
    let bad = 0, checked = 0;
    for (const tf of ['m1', 'm15', 'h1', 'd1'] as const) {
      for (const s of g.history[tf]) {
        for (let k = 0; k < s.len; k++) {
          const j = (s.start + k) % s.cap;
          const o = s.o[j], h = s.h[j], l = s.l[j], c = s.c[j];
          checked++;
          if (h < Math.max(o, c) - 1e-3 || l > Math.min(o, c) + 1e-3 || l <= 0 || s.v[j] < 0) bad++;
          if (k > 0 && s.t[j] <= s.t[(s.start + k - 1) % s.cap]) bad++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100_000);
    expect(bad).toBe(0);
  });

  test('timeframes are aggregations of the same underlying minute history', () => {
    const g = fresh();
    playDays(g, 1);
    for (const idx of [0, 20, g.benchmarkIdx]) {
      const m1 = toBars(g.history.m1[idx]).slice(-390);
      const agg15 = aggregate(m1, 900, sessionStart);
      const stored15 = toBars(g.history.m15[idx]).slice(-26);
      expect(agg15.length).toBe(stored15.length);
      agg15.forEach((b, k) => {
        expect(stored15[k].time).toBe(b.time);
        expect(stored15[k].close).toBeCloseTo(b.close, 3);
        expect(stored15[k].high).toBeCloseTo(b.high, 3);
        expect(stored15[k].low).toBeCloseTo(b.low, 3);
      });
      const d = barAt(g.history.d1[idx], g.history.d1[idx].len - 1);
      expect(d.close).toBeCloseTo(m1[m1.length - 1].close, 3);
      expect(d.high).toBeCloseTo(Math.max(...m1.map((b) => b.high)), 3);
      expect(d.open).toBeCloseTo(m1[0].open, 3);
    }
  });

  test('ETFs track their underlying baskets', () => {
    const g = fresh({ seed: 99 });
    playDays(g, 25);
    const etf = g.instruments.find((i) => i.id === 'FTEC')!;
    const s = g.history.d1[etf.idx];
    const rets = (idx: number) => { const x = g.history.d1[idx]; const out: number[] = []; for (let k = x.len - 24; k < x.len; k++) out.push(Math.log(closeAt(x, k) / closeAt(x, k - 1))); return out; };
    const e = rets(etf.idx);
    const basket = e.map((_, k) => etf.etf!.constituents.reduce((a, c) => a + c.w * rets(c.idx)[k], 0));
    const corr = (x: number[], y: number[]) => { const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length; let n = 0, dx = 0, dy = 0; x.forEach((v, k) => { n += (v - mx) * (y[k] - my); dx += (v - mx) ** 2; dy += (y[k] - my) ** 2; }); return n / Math.sqrt(dx * dy); };
    expect(corr(e, basket)).toBeGreaterThan(0.97);
    void s;
  });

  test('prices stay positive, vary across instruments and both rise and fall', () => {
    const g = fresh({ seed: 5 });
    playDays(g, 20);
    const changes = g.instruments.filter((i) => i.kind === 'equity').map((i) => { const s = g.history.d1[i.idx]; return closeAt(s, s.len - 1) / closeAt(s, s.len - 21) - 1; });
    expect(changes.some((c) => c > 0.02)).toBe(true);
    expect(changes.some((c) => c < -0.02)).toBe(true);
    expect(new Set(changes.map((c) => c.toFixed(4))).size).toBeGreaterThan(changes.length * 0.9);
    for (const i of g.instruments) expect(i.price).toBeGreaterThan(0);
  });

  test('accelerated/batched time does not duplicate scheduled events', () => {
    const g = fresh({ seed: 11 });
    playDays(g, 70);
    const earnings = g.news.filter((n) => n.templateId === 'earnings');
    const perCompany = new Map<string, number>();
    for (const n of earnings) perCompany.set(n.instruments[0], (perCompany.get(n.instruments[0]) ?? 0) + 1);
    for (const v of perCompany.values()) expect(v).toBeLessThanOrEqual(2);
    // follow-ups are consumed exactly once
    expect(g.scheduled.every((s) => s.day >= g.clock.day)).toBe(true);
  });

  test('scheduled central-bank decisions occur at 14:00 on their day', () => {
    const g = fresh({ seed: 3 });
    const day = g.macro.nextRateDay;
    while (g.clock.day < day) { runToClose(g); nextDay(g); }
    steps(g, 271);
    const rate = g.news.filter((n) => n.templateId === 'rate_decision');
    expect(rate.length).toBe(1);
    expect(rate[0].day).toBe(day);
    expect(rate[0].minute).toBe(270);
  });
});
