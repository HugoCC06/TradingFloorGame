import { DIFFICULTIES } from '../config/difficulty';
import { SECTORS } from '../config/sectors';
import { Rng } from './rng';
import type { GameState, MacroState } from './types';

export function initialMacro(rng: Rng, day: number): MacroState {
  return {
    growth: 2 + rng.normal() * 0.4,
    inflation: 2.6 + rng.normal() * 0.5,
    policyRate: 3.0 + rng.normal() * 0.6,
    expectedRate: 3.0,
    sentiment: rng.normal() * 0.2,
    credit: 1.5 + rng.normal() * 0.15,
    regime: rng.chance(0.55) ? 'neutral' : rng.chance(0.7) ? 'bull' : 'bear',
    regimeDays: 0,
    unemployment: 4.4 + rng.normal() * 0.3,
    shockDrift: 0,
    rateShock: 0,
    inflShock: 0,
    growthShock: 0,
    volShock: 1,
    oilSupply: rng.normal() * 0.2,
    geopolitics: 0.15 + rng.next() * 0.15,
    nextCpiDay: day + rng.int(3, 18),
    nextJobsDay: day + rng.int(2, 18),
    nextGdpDay: day + rng.int(10, 55),
    nextRateDay: day + rng.int(8, 28),
    history: [],
  };
}

/** Taylor-style policy rule used for central-bank decisions and market expectations. */
export function policyTarget(m: MacroState): number {
  return Math.max(0, 0.75 + m.inflation + 0.5 * (m.inflation - 2) + 0.5 * (m.growth - 2) - (m.regime === 'crisis' ? 1.5 : 0));
}

const REGIME_TARGET = {
  bull: { growth: 2.8, sentiment: 0.4, credit: 1.2 },
  neutral: { growth: 2.0, sentiment: 0.0, credit: 1.5 },
  bear: { growth: 0.6, sentiment: -0.35, credit: 2.4 },
  crisis: { growth: -1.5, sentiment: -0.8, credit: 4.5 },
} as const;

/** Evolve macro variables and regime once per trading day (after the close). */
export function evolveMacro(state: GameState, marketReturn: number): string | null {
  const rng = new Rng(state.rng.events);
  const d = DIFFICULTIES[state.setup.difficulty];
  const m = state.macro;
  const tgt = REGIME_TARGET[m.regime];
  m.growth += 0.02 * (tgt.growth - m.growth) + 0.04 * rng.normal();
  m.inflation += 0.012 * (2.5 + 0.4 * (m.growth - 2) + 0.6 * m.oilSupply - m.inflation) + 0.025 * rng.normal();
  m.unemployment += 0.01 * (4.5 - 0.5 * (m.growth - 2) - m.unemployment) + 0.015 * rng.normal();
  m.sentiment += 0.05 * (tgt.sentiment - m.sentiment) + 2.5 * marketReturn + 0.04 * rng.normal();
  m.sentiment = Math.max(-1, Math.min(1, m.sentiment));
  m.credit += 0.04 * (tgt.credit - m.credit) + 0.03 * rng.normal();
  m.credit = Math.max(0.6, m.credit);
  m.shockDrift *= 0.8;
  m.rateShock *= 0.75;
  m.inflShock *= 0.75;
  m.growthShock *= 0.75;
  m.volShock = 1 + (m.volShock - 1) * 0.85;
  m.geopolitics = Math.max(0, Math.min(1, m.geopolitics * 0.985 + 0.01 * rng.normal() + 0.002));
  m.oilSupply = Math.max(-1, Math.min(1, m.oilSupply * 0.985 + 0.03 * rng.normal()));
  m.expectedRate = m.policyRate + 0.5 * (policyTarget(m) - m.policyRate);

  for (const s of SECTORS) {
    const st = state.sectors[s.id];
    st.sentiment = Math.max(-1, Math.min(1, st.sentiment * 0.97 + 0.06 * rng.normal()));
    st.shockDrift *= 0.8;
  }

  // regime transitions
  m.regimeDays++;
  const prev = m.regime;
  const p = rng.next();
  switch (m.regime) {
    case 'bull':
      if (p < (1 / 140) * (1 - m.sentiment * 0.5) * d.bearProb) m.regime = 'neutral';
      break;
    case 'neutral':
      if (p < (1 / 110) * (1 + m.sentiment)) m.regime = 'bull';
      else if (p < (1 / 110) * (1 + m.sentiment) + (1 / 170) * d.bearProb * (1 - m.sentiment)) m.regime = 'bear';
      break;
    case 'bear':
      if (p < 1 / 55) m.regime = 'neutral';
      else if (d.crises && p < 1 / 55 + 1 / 450) m.regime = 'crisis';
      break;
    case 'crisis':
      if (p < 1 / 22) m.regime = 'bear';
      break;
  }
  if (m.regime !== prev) {
    m.regimeDays = 0;
    return `${prev}->${m.regime}`;
  }
  return null;
}

export function regimeLabel(r: MacroState['regime']): string {
  return { bull: 'Bull market', neutral: 'Range-bound', bear: 'Bear market', crisis: 'Financial crisis' }[r];
}
