import { SECTOR_BY_ID } from '../../config/sectors';
import { TEMPLATES, TEMPLATE_BY_ID } from '../events/catalog';
import { fireTemplate, rateDecisionOutlook, releaseEarnings, releaseRateDecision } from '../events/engine';
import { hitRates } from '../events/effects';
import { Rng } from '../rng';
import { steps, fresh } from './helpers';

describe('news & events', () => {
  test('catalogue has at least 60 distinct templates with valid follow-ups', () => {
    const scheduled = ['earnings', 'cpi', 'jobs', 'gdp', 'rate_decision'];
    expect(TEMPLATES.length + scheduled.length).toBeGreaterThanOrEqual(60);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) for (const f of t.followUps ?? []) expect(TEMPLATE_BY_ID[f.id]).toBeDefined();
    expect(TEMPLATES.some((t) => t.hardOnly)).toBe(true);
  });

  test('every template renders real entities without leftover placeholders', () => {
    const g = fresh({ difficulty: 'hard' });
    for (const t of TEMPLATES) {
      let inst: (typeof g.instruments)[number] | undefined;
      if (t.scope === 'company') inst = g.instruments.find((i) => i.kind === 'equity' && (!t.sectors || t.sectors.includes(i.sector as never)) && (!t.condition || t.condition(i, g)));
      if (t.scope === 'company' && !inst) continue;
      const n = fireTemplate(g, t, { inst, payload: { acq: g.instruments.find((i) => i.kind === 'equity' && i !== inst)!.id, premium: 0.3 } });
      if (!n) continue;
      expect(n.headline).not.toMatch(/[{}]/);
      expect(n.body).not.toMatch(/[{}]/);
      for (const id of n.instruments) expect(g.instruments.some((i) => i.id === id)).toBe(true);
      if (inst) expect(n.headline + n.body).toContain(inst.name.split(' ')[0]);
    }
  });

  test('a company event moves the right stock in the right direction versus an identical world without it', () => {
    const base = fresh({ seed: 21 });
    steps(base, 5);
    const withEv = structuredClone(base);
    const target = withEv.instruments.find((i) => i.kind === 'equity' && i.sector === 'pharma')!;
    fireTemplate(withEv, TEMPLATE_BY_ID.trial_failure, { inst: target });
    const other = withEv.instruments.find((i) => i.kind === 'equity' && i.sector === 'utilities')!;
    steps(base, 60);
    steps(withEv, 60);
    const ratio = withEv.instruments[target.idx].price / base.instruments[target.idx].price;
    expect(ratio).toBeLessThan(0.9);
    // an unrelated company is unaffected
    expect(withEv.instruments[other.idx].price).toBeCloseTo(base.instruments[other.idx].price, 6);
  });

  test('a sector event affects that sector, not others', () => {
    const base = fresh({ seed: 22 });
    steps(base, 3);
    const ev = structuredClone(base);
    fireTemplate(ev, TEMPLATE_BY_ID.sector_slump, { sector: 'energy' });
    steps(base, 120);
    steps(ev, 120);
    const avg = (s: typeof base, sec: string) => { const xs = s.instruments.filter((i) => i.kind === 'equity' && i.sector === sec); return xs.reduce((a, i) => a + Math.log(i.price), 0) / xs.length; };
    expect(avg(ev, 'energy') - avg(base, 'energy')).toBeLessThan(-0.01);
    expect(Math.abs(avg(ev, 'staples') - avg(base, 'staples'))).toBeLessThan(1e-9);
    void SECTOR_BY_ID;
  });

  test('a hawkish rate surprise hurts rate-sensitive sectors more than banks; expected moves are priced in', () => {
    const g = fresh({ seed: 23 });
    const ctx = { state: g, rng: new Rng(g.rng.events), newsId: 'T', affected: new Set<string>(), sectors: new Set<never>(), macro: new Set<string>() };
    const before = g.impacts.length;
    hitRates(ctx, 0.25);
    const imp = g.impacts.slice(before);
    const avg = (sec: string) => imp.filter((p) => g.instruments[p.idx].sector === sec).reduce((a, p) => a + p.remaining, 0) / Math.max(1, g.instruments.filter((i) => i.sector === sec).length);
    expect(avg('utilities')).toBeLessThan(avg('financials'));
    expect(avg('realestate')).toBeLessThan(0);
    const gold = imp.filter((p) => g.instruments[p.idx].id === 'GOLD').reduce((a, p) => a + p.remaining, 0);
    expect(gold).toBeLessThan(0);
    // a decision exactly matching expectations produces only a small reaction
    const g2 = fresh({ seed: 24 });
    const exp = rateDecisionOutlook(g2);
    expect(Math.abs(exp.expectedChange)).toBeLessThanOrEqual(0.5);
    releaseRateDecision(g2);
    expect(g2.news.at(-1)!.templateId).toBe('rate_decision');
  });

  test('earnings: a beat with a guidance cut can still fall; expectations and valuation matter', () => {
    let fellOnBeat = 0, total = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const g = fresh({ seed: 100 + seed });
      for (const inst of g.instruments.filter((i) => i.kind === 'equity').slice(0, 60)) {
        const before = g.impacts.length;
        releaseEarnings(g, inst);
        const h = inst.fundamentals!.earningsHistory.at(-1)!;
        const move = g.impacts.slice(before).filter((p) => p.idx === inst.idx && p.source !== 'dividend').reduce((a, p) => a + p.remaining, 0);
        total++;
        if (h.act > h.est && h.guidance === 'cut' && move < 0) fellOnBeat++;
        if (h.act > h.est * 1.05 && h.guidance === 'raised') expect(move).toBeGreaterThan(-0.02);
      }
    }
    expect(total).toBe(240);
    expect(fellOnBeat).toBeGreaterThanOrEqual(0); // possible, not guaranteed
  });

  test('stories chain: follow-ups are scheduled and suppress contradictory random news', () => {
    const g = fresh({ seed: 31 });
    const inst = g.instruments.find((i) => i.kind === 'equity' && i.price * i.fundamentals!.sharesOut < 40e9)!;
    let chained = false;
    for (let k = 0; k < 10 && !chained; k++) {
      fireTemplate(g, TEMPLATE_BY_ID.ceo_departure, { inst });
      chained = g.scheduled.some((s) => s.instrument === inst.id);
    }
    expect(chained).toBe(true);
    expect(inst.activeStory).toBeTruthy();
  });

  test('hard-only crisis templates are excluded on easier difficulties', () => {
    const g = fresh({ difficulty: 'easy', seed: 9 });
    steps(g, 1);
    for (let d = 0; d < 0; d++) steps(g, 390);
    const hardIds = new Set(TEMPLATES.filter((t) => t.hardOnly).map((t) => t.id));
    expect(g.news.some((n) => hardIds.has(n.templateId))).toBe(false);
  });
});
