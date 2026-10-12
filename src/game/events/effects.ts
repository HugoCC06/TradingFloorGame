/**
 * Explicit, bounded mechanisms through which news affects the simulation.
 * Every price effect becomes a PendingImpact that the market engine absorbs
 * over time (an immediate jump portion plus a decaying drift), optionally with a
 * multi-day residual drift and a temporary volatility boost.
 */
import { DIFFICULTIES } from '../../config/difficulty';
import { SECTOR_BY_ID, type SectorId } from '../../config/sectors';
import type { Rng } from '../rng';
import type { GameState, Instrument, MacroState } from '../types';

export interface HitOptions {
  /** fraction absorbed in the first minute (intraday) */
  immediate?: number;
  /** minutes over which the remainder is absorbed */
  minutes?: number;
  /** multi-day follow-through: days and total daily drift (log) at each subsequent open */
  days?: number;
  dailyDrift?: number;
  volBoost?: number;
  /** randomise the size ±spread (fraction) */
  spread?: number;
  /** scale by the instrument's volatility relative to 2%/day */
  scaleVol?: boolean;
}

export interface EffectCtx {
  state: GameState;
  rng: Rng;
  newsId: string;
  /** collected for the news item */
  affected: Set<string>;
  sectors: Set<SectorId>;
  macro: Set<string>;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Queue a price impact of approximately `pct` (e.g. 0.05 = +5%) on an instrument. */
export function hit(ctx: EffectCtx, inst: Instrument, pct: number, o: HitOptions = {}): number {
  const d = DIFFICULTIES[ctx.state.setup.difficulty];
  const spread = o.spread ?? 0.3;
  let size = Math.log(1 + clamp(pct, -0.6, 1.5)) * (1 + spread * (ctx.rng.next() * 2 - 1));
  if (o.scaleVol !== false && inst.kind === 'equity') size *= clamp(inst.vol / 0.02, 0.65, 1.7);
  if (size < 0) size *= d.shockSize;
  const minutes = o.minutes ?? 45;
  const immediate = o.immediate ?? 0.55;
  const imm = size * immediate;
  const rest = size - imm;
  const st = ctx.state;
  if (Math.abs(imm) > 1e-6) st.impacts.push({ idx: inst.idx, remaining: imm, rate: 1, daysLeft: 0, dailyDrift: 0, source: ctx.newsId });
  const rate = 1 - Math.pow(0.05, 1 / Math.max(1, minutes));
  st.impacts.push({ idx: inst.idx, remaining: rest, rate, daysLeft: o.days ?? 0, dailyDrift: o.dailyDrift ?? 0, source: ctx.newsId });
  if (o.volBoost) inst.volBoost = Math.min(4, Math.max(inst.volBoost, o.volBoost));
  inst.newsTone = clamp(inst.newsTone + Math.sign(size) * Math.min(1, Math.abs(size) * 10), -1, 1);
  inst.lastEventDay = st.clock.day;
  ctx.affected.add(inst.id);
  return size;
}

/** Hit every equity in a sector, scaled by each name's sector loading. */
export function hitSector(ctx: EffectCtx, sector: SectorId, pct: number, o: HitOptions = {}, exclude?: string) {
  ctx.sectors.add(sector);
  for (const inst of ctx.state.instruments) {
    if (inst.kind !== 'equity' || inst.sector !== sector || inst.id === exclude) continue;
    hit(ctx, inst, pct * inst.sectorLoading * (0.6 + 0.8 * ctx.rng.next()), { spread: 0.2, scaleVol: false, immediate: 0.4, minutes: 90, ...o });
    ctx.affected.delete(inst.id); // sector-wide hits are listed by sector, not every ticker
  }
  const st = ctx.state.sectors[sector];
  st.sentiment = clamp(st.sentiment + Math.sign(pct) * Math.min(0.4, Math.abs(pct) * 8), -1, 1);
}

/** Broad market move transmitted through each instrument's beta. */
export function hitMarket(ctx: EffectCtx, pct: number, o: HitOptions = {}) {
  for (const inst of ctx.state.instruments) {
    if (inst.kind === 'etf') continue;
    const b = inst.kind === 'commodity' ? inst.beta * 0.5 : inst.beta;
    hit(ctx, inst, pct * b, { spread: 0.15, scaleVol: false, immediate: 0.5, minutes: 120, ...o });
    ctx.affected.delete(inst.id);
  }
  ctx.macro.add('market');
}

/** Rate-surprise transmission: instruments react through their rate sensitivity. */
export function hitRates(ctx: EffectCtx, surprisePct: number) {
  // surprisePct: +0.25 = a hawkish 25bp surprise
  for (const inst of ctx.state.instruments) {
    if (inst.kind === 'etf') continue;
    let pct: number;
    if (inst.kind === 'commodity') pct = inst.commodity!.driver === 'gold' ? -0.025 * surprisePct * 4 : -0.008 * surprisePct * 4;
    else pct = (inst.fundamentals!.rateSens * 0.012 - 0.008 * inst.beta) * surprisePct * 4;
    hit(ctx, inst, pct, { spread: 0.25, scaleVol: false, immediate: 0.6, minutes: 60 });
    ctx.affected.delete(inst.id);
  }
  ctx.state.macro.rateShock += surprisePct * 0.0012;
  ctx.macro.add('rates');
}

export function shiftMacro(ctx: EffectCtx, changes: Partial<Record<keyof MacroState, number>>) {
  const m = ctx.state.macro as unknown as Record<string, number>;
  for (const [k, v] of Object.entries(changes)) {
    if (typeof m[k] === 'number' && typeof v === 'number') m[k] += v;
    ctx.macro.add(k);
  }
  const mm = ctx.state.macro;
  mm.sentiment = clamp(mm.sentiment, -1, 1);
  mm.geopolitics = clamp(mm.geopolitics, 0, 1);
  mm.oilSupply = clamp(mm.oilSupply, -1, 1);
  mm.volShock = clamp(mm.volShock, 0.6, 3);
}

export function setRegime(ctx: EffectCtx, regime: MacroState['regime']) {
  ctx.state.macro.regime = regime;
  ctx.state.macro.regimeDays = 0;
  ctx.macro.add('regime');
}

export function adjustFundamentals(inst: Instrument, o: { trend?: number; fair?: number; growth?: number; debtMult?: number; marginAdd?: number }) {
  const f = inst.fundamentals;
  if (!f) return;
  if (o.trend) f.trend = clamp(f.trend + o.trend, -1, 1);
  if (o.fair) f.fairValue *= Math.exp(o.fair);
  if (o.growth) f.growthExpect = clamp(f.growthExpect + o.growth, -0.1, 0.5);
  if (o.debtMult) f.debt *= o.debtMult;
  if (o.marginAdd) {
    f.margin += o.marginAdd;
    f.earnings = f.revenue * f.margin;
  }
}

export function sectorName(id: SectorId) {
  return SECTOR_BY_ID[id]?.name ?? id;
}
