/**
 * Rival funds. Each rival holds a real basket of instruments chosen by its
 * strategy rules from observable market data (never hidden fair values), and
 * its daily return is the weighted return of those holdings in the same market
 * the player trades. Difficulty changes selection noise, risk management and
 * marketing strength — never the results directly.
 */
import { DIFFICULTIES } from '../config/difficulty';
import { toCents } from './accounting';
import { pushNews } from './events/engine';
import { Rng } from './rng';
import { closeAt } from './series';
import type { GameState, Instrument, Rival, RivalStrategy } from './types';
import { trailingReturn } from './performance';

interface RivalDef {
  name: string;
  short: string;
  color: string;
  strategy: RivalStrategy;
  description: string;
  aum: number;
  gross: number;
  rebalance: number;
  feeDrag: number;
}

export const RIVAL_DEFS: RivalDef[] = [
  { name: 'Ashgrove Capital', short: 'ASH', color: '#7aa2c9', strategy: 'conservative', description: 'Conservative long-only manager. Broad index exposure tilted to quality and defensive sectors, with a cash buffer.', aum: 900e6, gross: 0.85, rebalance: 21, feeDrag: 0.012 },
  { name: 'Vantage Peak Partners', short: 'VPK', color: '#e38c5a', strategy: 'growth', description: 'Aggressive growth investor. Concentrated, leveraged bets on the fastest-growing companies.', aum: 420e6, gross: 1.3, rebalance: 15, feeDrag: 0.02 },
  { name: 'Ironbridge Value', short: 'IRB', color: '#8fb573', strategy: 'value', description: 'Contrarian value fund buying cheap, profitable companies the market dislikes.', aum: 610e6, gross: 1.0, rebalance: 21, feeDrag: 0.016 },
  { name: 'Meridian Macro', short: 'MER', color: '#c7a64a', strategy: 'macro', description: 'Global macro fund trading indices, sectors and commodities on economic signals.', aum: 1_300e6, gross: 1.2, rebalance: 8, feeDrag: 0.02 },
  { name: 'Quantum Ridge', short: 'QRG', color: '#9d86d6', strategy: 'tech', description: 'Technology specialist owning the highest-quality software and semiconductor franchises.', aum: 350e6, gross: 1.1, rebalance: 21, feeDrag: 0.018 },
  { name: 'Kinetic Flow', short: 'KFL', color: '#d46f8f', strategy: 'momentum', description: 'High-turnover momentum fund: long recent winners, short recent losers.', aum: 280e6, gross: 1.35, rebalance: 5, feeDrag: 0.026 },
  { name: 'Halcyon Systematic', short: 'HAL', color: '#5fb6b0', strategy: 'quant', description: 'Market-neutral quant: long high-quality companies, short low-quality ones.', aum: 750e6, gross: 1.6, rebalance: 10, feeDrag: 0.02 },
];

const MANAGERS = ['Helena Ashworth', 'Rafael Quintero', 'Ingrid Falkenberg', 'Desmond Okonkwo', 'Mei Takeda', 'Callum Strand', 'Anouk Beaumont'];

export function createRivals(state: GameState, rng: Rng): Rival[] {
  return RIVAL_DEFS.map((d, i) => {
    const r: Rival = {
      id: d.short,
      name: d.name,
      short: d.short,
      color: d.color,
      strategy: d.strategy,
      description: d.description,
      manager: MANAGERS[i],
      aum: toCents(d.aum * (0.75 + rng.next() * 0.5)),
      navPerUnit: 100,
      peakNavPerUnit: 100,
      reputation: 55 + rng.normal() * 8,
      riskAppetite: d.gross,
      holdings: [],
      lastRebalanceDay: -999,
      rebalanceEvery: d.rebalance,
      clients: 10 + rng.int(5, 40),
      history: [],
      feeDrag: d.feeDrag,
      derisked: false,
    };
    rebalanceRival(state, r, rng);
    return r;
  });
}

function trailingInst(state: GameState, inst: Instrument, days: number): number {
  const d1 = state.history.d1[inst.idx];
  if (d1.len < 2) return 0;
  const back = Math.min(d1.len - 1, days);
  return inst.price / closeAt(d1, d1.len - 1 - back) - 1;
}

const byId = (state: GameState, id: string) => state.instruments.find((i) => i.id === id);

/** Choose holdings according to strategy. Selection quality depends on difficulty. */
export function rebalanceRival(state: GameState, r: Rival, rng: Rng) {
  const skill = DIFFICULTIES[state.setup.difficulty].rivalSkill;
  const eq = state.instruments.filter((i) => i.kind === 'equity');
  const noisy = (x: number, scale: number) => x + rng.normal() * scale * (1 - skill) * 1.5;
  const pe = (i: Instrument) => (i.fundamentals!.earnings > 0 ? (i.price * i.fundamentals!.sharesOut) / i.fundamentals!.earnings : 999);
  const topN = (arr: Instrument[], n: number, key: (i: Instrument) => number) => [...arr].map((i) => ({ i, k: key(i) })).sort((a, b) => b.k - a.k).slice(0, n).map((x) => x.i);
  const eqw = (arr: Instrument[], total: number) => arr.map((i) => ({ idx: i.idx, w: total / arr.length }));
  let h: { idx: number; w: number }[] = [];
  const m = state.macro;
  switch (r.strategy) {
    case 'conservative': {
      const ids: [string, number][] = [['TFX', 0.5], ['DEFN', 0.2], ['QUAL', 0.15]];
      h = ids.map(([id, w]) => ({ idx: byId(state, id)!.idx, w }));
      break;
    }
    case 'growth':
      h = eqw(topN(eq.filter((i) => i.fundamentals!.quality > 30), 12, (i) => noisy(i.fundamentals!.revGrowth + 0.3 * trailingInst(state, i, 60), 0.08)), r.riskAppetite);
      break;
    case 'value':
      h = eqw(topN(eq.filter((i) => i.fundamentals!.quality > 45 && pe(i) > 0 && pe(i) < 900), 15, (i) => noisy(-pe(i) / 20 + i.fundamentals!.quality / 100, 0.4)), r.riskAppetite);
      break;
    case 'tech':
      h = eqw(topN(eq.filter((i) => i.sector === 'tech' || i.sector === 'semis'), 10, (i) => noisy(i.fundamentals!.quality / 100 + i.fundamentals!.revGrowth, 0.2)), r.riskAppetite);
      break;
    case 'momentum': {
      const scored = eq.map((i) => ({ i, k: noisy(trailingInst(state, i, 20), 0.05) })).sort((a, b) => b.k - a.k);
      h = [...scored.slice(0, 10).map((x) => ({ idx: x.i.idx, w: 0.1 * r.riskAppetite * 0.75 })), ...scored.slice(-5).map((x) => ({ idx: x.i.idx, w: -0.05 * r.riskAppetite * 0.5 }))];
      break;
    }
    case 'quant': {
      const scored = eq.map((i) => ({ i, k: noisy(i.fundamentals!.quality / 100 - Math.min(2, Math.max(0, pe(i) / 60)) * 0.2, 0.15) })).sort((a, b) => b.k - a.k);
      const half = r.riskAppetite / 2;
      h = [...eqw(scored.slice(0, 12).map((x) => x.i), half), ...eqw(scored.slice(-12).map((x) => x.i), -half)];
      break;
    }
    case 'macro': {
      const add = (id: string, w: number) => { const i = byId(state, id); if (i) h.push({ idx: i.idx, w }); };
      // signals read from observable macro data
      const growth = noisy(m.growth - 2, 0.6);
      const infl = noisy(m.inflation - 2.7, 0.6);
      add('TFX', growth > 0 ? 0.45 : growth < -0.6 ? -0.25 : 0.15);
      if (infl > 0.3) { add('GOLD', 0.2); add('FNRG', 0.15); }
      if (m.geopolitics > 0.4) { add('GOLD', 0.15); add('CRUD', 0.1); }
      if (m.rateShock > 0.0002 || m.expectedRate > m.policyRate + 0.1) { add('FREI', -0.15); add('FUTL', -0.1); add('FFIN', 0.1); }
      if (growth < -0.3) add('DEFN', 0.25);
      if (growth > 0.4) { add('FIND', 0.15); add('COPR', 0.1); }
      const gross = h.reduce((a, x) => a + Math.abs(x.w), 0) || 1;
      h = h.map((x) => ({ idx: x.idx, w: (x.w * r.riskAppetite) / Math.max(1, gross) }));
      break;
    }
  }
  // turnover cost
  const before = new Map(r.holdings.map((x) => [x.idx, x.w]));
  let turnover = 0;
  for (const x of h) turnover += Math.abs(x.w - (before.get(x.idx) ?? 0));
  for (const [idx, w] of before) if (!h.some((x) => x.idx === idx)) turnover += Math.abs(w);
  r.navPerUnit *= 1 - turnover * 0.0015 * (1.6 - skill);
  r.holdings = h;
  r.lastRebalanceDay = state.clock.day;
}

/** Daily rival performance and AUM update, using actual instrument returns for the day. */
export function updateRivals(state: GameState, playerDayReturn: number): { id: string; ret: number }[] {
  const rng = new Rng(state.rng.misc);
  const d = DIFFICULTIES[state.setup.difficulty];
  const out: { id: string; ret: number }[] = [];
  const rets = state.rivals.map(() => 0);
  state.rivals.forEach((r, k) => {
    let ret = 0;
    let gross = 0;
    for (const h of r.holdings) {
      const inst = state.instruments[h.idx];
      const d1 = state.history.d1[inst.idx];
      const prev = d1.len >= 2 ? closeAt(d1, d1.len - 2) : inst.price;
      const w = r.derisked ? h.w * 0.55 : h.w;
      ret += w * (inst.price / prev - 1);
      gross += Math.abs(w);
    }
    const cashW = Math.max(0, 1 - gross);
    ret += cashW * (state.macro.policyRate / 100 / 252);
    ret -= r.feeDrag / 252;
    // financing on leverage above 1
    ret -= Math.max(0, gross - 1) * ((state.macro.policyRate + 1) / 100 / 252);
    r.navPerUnit *= 1 + ret;
    r.peakNavPerUnit = Math.max(r.peakNavPerUnit, r.navPerUnit);
    rets[k] = ret;
    out.push({ id: r.id, ret });
  });
  // flows: relative 60-day performance vs peers (including the player)
  const r60 = state.rivals.map((r) => {
    const h = r.history;
    const base = h.length ? h[Math.max(0, h.length - 60)].navPerUnit : 100;
    return r.navPerUnit / base - 1;
  });
  const all = [...r60, trailingReturn(state, 60)].sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)];
  state.rivals.forEach((r, k) => {
    const rel = r60[k] - median;
    const flowRate = Math.max(-0.004, Math.min(0.004, rel * 0.012 * d.rivalMarketing + (r.reputation - 55) * 0.00002 + rng.normal() * 0.0006));
    r.aum = Math.max(toCents(20e6), Math.round(r.aum * (1 + rets[k]) * (1 + flowRate)));
    r.reputation = Math.max(5, Math.min(95, r.reputation + Math.max(-0.4, Math.min(0.4, rel * 4)) - (r.reputation - 55) * 0.004));
    r.clients = Math.max(3, Math.round(r.clients * (1 + flowRate * 2)));
    // competent rivals de-risk in drawdowns and bear markets
    const dd = 1 - r.navPerUnit / r.peakNavPerUnit;
    const wasDerisked = r.derisked;
    r.derisked = d.rivalSkill > 0.4 && r.strategy !== 'quant' && r.strategy !== 'macro' && (dd > 0.14 - d.rivalSkill * 0.04 || state.macro.regime === 'crisis' || (state.macro.regime === 'bear' && d.rivalSkill > 0.7));
    if (r.derisked && !wasDerisked && rng.chance(0.6)) {
      pushNews(state, { templateId: 'rival_derisk', category: 'competitor', headline: `${r.name} slashes risk as losses mount`, body: `${r.name}, run by ${r.manager}, has cut its gross exposure after a ${(dd * 100).toFixed(0)}% drawdown, according to a letter to investors.`, severity: 1, tone: -1, instruments: [], sectors: [] });
    }
    r.history.push({ day: state.clock.day, navPerUnit: r.navPerUnit, aum: r.aum });
    if (r.history.length > 1500) r.history.shift();
    if (state.clock.day - r.lastRebalanceDay >= r.rebalanceEvery) rebalanceRival(state, r, rng);
    // news on notable days
    if (Math.abs(rets[k]) > 0.028 && rng.chance(0.5)) {
      const up = rets[k] > 0;
      pushNews(state, {
        templateId: 'rival_move', category: 'competitor',
        headline: up ? `${r.name} posts ${(rets[k] * 100).toFixed(1)}% gain in a single session` : `${r.name} hit with ${(rets[k] * 100).toFixed(1)}% one-day loss`,
        body: `${r.name}'s ${r.strategy} strategy ${up ? 'paid off handsomely' : 'was caught on the wrong side'} as markets moved. The fund manages about $${(r.aum / 1e8).toFixed(0)}M.`,
        severity: 1, tone: up ? 1 : -1, instruments: [], sectors: [],
      });
    }
  });
  // monthly league table story
  if (state.clock.day % 21 === 0 && state.daily.length > 15) {
    const ranked = [...state.rivals].map((r, k) => ({ r, v: r60[k] })).sort((a, b) => b.v - a.v);
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    pushNews(state, {
      templateId: 'rival_table', category: 'competitor',
      headline: `Hedge fund league table: ${top.r.name} leads, ${bottom.r.name} lags`,
      body: `Over the past three months ${top.r.name} returned ${(top.v * 100).toFixed(1)}% while ${bottom.r.name} returned ${(bottom.v * 100).toFixed(1)}%. ${state.setup.fundName} returned ${(trailingReturn(state, 60) * 100).toFixed(1)}%.`,
      severity: 1, tone: 0, instruments: [], sectors: [],
    });
  }
  void playerDayReturn;
  return out;
}

export function rivalReturn(r: Rival, days: number): number {
  const h = r.history;
  if (!h.length) return 0;
  const base = days >= h.length ? 100 : h[h.length - 1 - days].navPerUnit;
  return r.navPerUnit / base - 1;
}

export function rivalDrawdown(r: Rival) {
  let peak = 100, maxDd = 0;
  for (const p of r.history) {
    peak = Math.max(peak, p.navPerUnit);
    maxDd = Math.max(maxDd, 1 - p.navPerUnit / peak);
  }
  return { current: 1 - r.navPerUnit / r.peakNavPerUnit, max: maxDd };
}

export const STRATEGY_LABEL: Record<RivalStrategy, string> = {
  conservative: 'Conservative long-only', growth: 'Aggressive growth', value: 'Contrarian value', macro: 'Global macro', tech: 'Technology specialist', momentum: 'High-turnover momentum', quant: 'Quant market-neutral',
};
