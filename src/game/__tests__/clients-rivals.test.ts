import { summarize, toCents } from '../accounting';
import { assessPitch, callClient, clientFlowDecisions, updateClients } from '../clients';
import { nextDay, runToClose } from '../sim';
import { updateRivals } from '../rivals';
import { closeAt } from '../series';
import { hire } from '../staff';
import { fresh, playDays } from './helpers';

describe('clients', () => {
  test('confidence falls when the fund is in a deep drawdown and recovers with calls', () => {
    const a = fresh({ seed: 61 });
    playDays(a, 2);
    const b = structuredClone(a);
    b.fund.peakNavPerUnit = summarize(b).navPerUnit * 1.3; // pretend a 23% drawdown
    const conf = (g: typeof a) => g.clients.filter((c) => c.type !== 'founder').map((c) => c.confidence);
    const before = conf(b);
    for (let i = 0; i < 5; i++) { updateClients(a, 0); updateClients(b, 0); }
    const da = conf(a).reduce((x, y) => x + y, 0), db = conf(b).reduce((x, y) => x + y, 0);
    expect(db).toBeLessThan(da - 20);
    expect(b.clients.find((c) => c.type !== 'founder')!.concerns.join()).toMatch(/Drawdown/);
    const c = b.clients.find((x) => x.type !== 'founder')!;
    const c0 = c.confidence;
    expect(callClient(b, c.id).ok).toBe(true);
    expect(c.confidence).toBeGreaterThan(c0);
    expect(callClient(b, c.id).ok).toBe(false); // cooldown
    void before;
  });

  test('very unhappy clients submit redemption notices with a notice period', () => {
    const g = fresh({ seed: 62 });
    for (const c of g.clients) if (c.type !== 'founder') c.confidence = 2;
    for (let i = 0; i < 40 && !g.flows.some((f) => f.kind === 'redemption'); i++) clientFlowDecisions(g);
    const red = g.flows.filter((f) => f.kind === 'redemption');
    expect(red.length).toBeGreaterThan(0);
    for (const f of red) expect(f.effectiveDay).toBeGreaterThanOrEqual(g.clock.day);
    expect(g.clients.some((c) => c.status === 'redeeming')).toBe(true);
  });

  test('pitch assessment is transparent and blocks unmet requirements', () => {
    const g = fresh({ seed: 63 });
    const p = { id: 'P1', name: 'Test Pension', type: 'pension' as const, amount: toCents(40e6), expectedReturn: 0.07, drawdownTolerance: 0.08, riskTolerance: 0.3, expiresDay: g.clock.day + 5, createdDay: g.clock.day, minTrackDays: 126, minAum: toCents(50e6), mandate: { maxShare: 0.2 }, mgmtFee: 0.0125, perfFee: 0.15, status: 'open' as const, note: '' };
    const a = assessPitch(g, p);
    expect(a.blockers.length).toBeGreaterThan(0);
    expect(a.probability).toBeLessThan(0.05);
    const hnw = { ...p, type: 'hnw' as const, amount: toCents(1e6), minTrackDays: 0, minAum: 0, mandate: {} };
    const b = assessPitch(g, hnw);
    expect(b.blockers).toEqual([]);
    expect(b.factors.length).toBeGreaterThan(3);
    // hiring investor relations staff improves the odds
    const ir = g.candidates.find((c) => c.role === 'ir') ?? null;
    if (ir) { g.company.cash = toCents(10e6); hire(g, ir.id); expect(assessPitch(g, hnw).probability).toBeGreaterThan(b.probability); }
  });
});

describe('rivals', () => {
  test('rival returns come from real holdings in the shared market', () => {
    const g = fresh({ seed: 64 });
    playDays(g, 1);
    nextDay(g);
    runToClose(g); // closeDay already updated rivals once for this day
    const r = g.rivals[0];
    const h = r.history;
    expect(h.length).toBeGreaterThanOrEqual(2);
    // recompute day return from holdings and the daily bars
    let ret = 0, gross = 0;
    for (const x of r.holdings) {
      const s = g.history.d1[x.idx];
      const w = r.derisked ? x.w * 0.55 : x.w;
      ret += w * (closeAt(s, s.len - 1) / closeAt(s, s.len - 2) - 1);
      gross += Math.abs(w);
    }
    void gross;
    const reported = h[h.length - 1].navPerUnit / h[h.length - 2].navPerUnit - 1;
    expect(Math.abs(reported - ret)).toBeLessThan(0.003); // fees, cash yield and rebalance costs explain the gap
    expect(new Set(g.rivals.map((x) => x.strategy)).size).toBeGreaterThanOrEqual(6);
  });

  test('rival AUM evolves with performance and flows and stays positive', () => {
    const g = fresh({ seed: 65 });
    playDays(g, 10);
    for (const r of g.rivals) {
      expect(r.aum).toBeGreaterThan(0);
      expect(r.history.length).toBe(10);
    }
    const out = updateRivals(g, 0);
    expect(out).toHaveLength(g.rivals.length);
  });
});

describe('difficulty changes the simulation', () => {
  test('hard markets are more volatile than easy markets', () => {
    const vol = (difficulty: 'easy' | 'hard') => {
      let acc = 0, n = 0;
      for (const seed of [66, 67]) {
        const g = fresh({ seed, difficulty });
        playDays(g, 15);
        for (const i of g.instruments.filter((x) => x.kind === 'equity')) {
          const s = g.history.d1[i.idx];
          for (let k = s.len - 15; k < s.len; k++) { acc += Math.log(closeAt(s, k) / closeAt(s, k - 1)) ** 2; n++; }
        }
      }
      return Math.sqrt(acc / n);
    };
    expect(vol('hard')).toBeGreaterThan(vol('easy') * 1.15);
  });

  test('difficulty sets different limits, client sensitivity and starting conditions', () => {
    const e = fresh({ difficulty: 'easy', seed: 67 }), h = fresh({ difficulty: 'hard', seed: 67 });
    expect(e.risk.limits.maxGross).toBeGreaterThan(h.risk.limits.maxGross);
    expect(e.company.cash).toBeGreaterThan(h.company.cash);
  });
});
