/**
 * Market simulation engine.
 *
 * Price model (per simulated minute, log-returns):
 *   r_i = beta_i * F_mkt + load_i * F_sector(i) + link_i * r_commodity + macroDrift_i
 *         + idio_i + fairValuePull_i + eventAbsorption_i
 * where F_mkt and F_sector are correlated factor shocks with regime-dependent
 * drift and volatility. ETFs are the weighted log-return of their basket plus a
 * small tracking error. Commodities have their own macro-driven drift and
 * mean-revert toward a slowly moving anchor.
 *
 * All randomness comes from the persisted `market` RNG stream, and the engine
 * advances only when the simulation clock advances (never on render).
 */
import { BALANCE } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import { SECTORS } from '../config/sectors';
import { intradayProfile, SESSION_MINUTES, timestampFor, dayTimestamp } from './calendar';
import { Rng } from './rng';
import { pushBar, updateLast, createSeries, lastBar, type SeriesData } from './series';
import type { GameState, Instrument, MacroState } from './types';

const SQRT_DT = 1 / Math.sqrt(SESSION_MINUTES);

export const REGIME = {
  bull: { drift: 0.0006, vol: 0.85 },
  neutral: { drift: 0.0, vol: 1.0 },
  bear: { drift: -0.0011, vol: 1.35 },
  crisis: { drift: -0.004, vol: 2.2 },
} as const;

export const HISTORY_CAPS = { m1: SESSION_MINUTES * 2, m15: 26 * 10, h1: 7 * 60, d1: 512 };

export function createHistory(n: number) {
  return {
    m1: Array.from({ length: n }, () => createSeries(HISTORY_CAPS.m1)),
    m15: Array.from({ length: n }, () => createSeries(HISTORY_CAPS.m15)),
    h1: Array.from({ length: n }, () => createSeries(HISTORY_CAPS.h1)),
    d1: Array.from({ length: n }, () => createSeries(HISTORY_CAPS.d1, true)),
  };
}

/** Daily drift of the broad market factor implied by macro state and difficulty. */
export function marketDailyDrift(state: GameState): number {
  const d = DIFFICULTIES[state.setup.difficulty];
  const m = state.macro;
  const base = BALANCE.market.baseDrift * d.driftBias;
  return base + REGIME[m.regime].drift + m.shockDrift + m.sentiment * 0.0005 - (m.credit - 1.5) * 0.0003;
}

export function marketVolMult(state: GameState): number {
  const d = DIFFICULTIES[state.setup.difficulty];
  return d.volMult * REGIME[state.macro.regime].vol * state.macro.volShock;
}

/** Company-specific daily drift from macro conditions through its sensitivities. */
export function macroDriftFor(inst: Instrument, m: MacroState): number {
  const f = inst.fundamentals;
  if (!f) return 0;
  return (
    0.00015 * f.growthSens * (m.growth - 2) +
    f.rateSens * m.rateShock +
    f.inflationSens * m.inflShock +
    f.growthSens * m.growthShock
  );
}

/** Daily drift for commodities from macro state. */
export function commodityDailyDrift(inst: Instrument, m: MacroState): number {
  const c = inst.commodity!;
  const realRate = m.policyRate - m.inflation;
  const gold = 0.0012 * m.geopolitics + 0.0003 * (m.inflation - 2.5) - 0.00035 * (realRate - 0.5) + (m.regime === 'crisis' ? 0.002 : 0) - m.rateShock * 0.8;
  const copper = 0.0005 * (m.growth - 2) + m.growthShock * 1.2;
  const pull = 0.004 * Math.log(c.anchor / inst.price);
  switch (c.driver) {
    case 'gold': return gold + pull;
    case 'silver': return 0.5 * gold + 0.5 * copper + pull;
    case 'copper': return copper + pull;
    case 'oil': return 0.0012 * m.oilSupply + 0.0004 * (m.growth - 2) + 0.0008 * m.geopolitics + m.growthShock + pull;
    case 'gas': return 0.0008 * m.oilSupply + 0.0004 * m.geopolitics + pull * 1.5;
    case 'wheat': return 0.0007 * m.geopolitics + 0.0003 * (m.inflation - 2.5) + pull;
  }
}

/** Scratch arrays reused between minutes (not part of the save). */
let scratch: { r: Float64Array; extra: Float64Array } | null = null;
function getScratch(n: number) {
  if (!scratch || scratch.r.length !== n) scratch = { r: new Float64Array(n), extra: new Float64Array(n) };
  scratch.r.fill(0);
  scratch.extra.fill(0);
  return scratch;
}

/** Consume event impacts for this minute into `extra`. */
function absorbImpacts(state: GameState, extra: Float64Array) {
  const keep = [];
  for (const imp of state.impacts) {
    if (Math.abs(imp.remaining) > 1e-6) {
      const a = imp.remaining * imp.rate;
      extra[imp.idx] += a;
      imp.remaining -= a;
    }
    if (Math.abs(imp.remaining) > 1e-5 || imp.daysLeft > 0) keep.push(imp);
  }
  state.impacts = keep;
}

/**
 * Advance every instrument by one simulated minute at the current clock minute,
 * writing the minute/15m/hourly/daily bars.
 */
export function stepMarketMinute(state: GameState): void {
  const rng = new Rng(state.rng.market);
  const insts = state.instruments;
  const n = insts.length;
  const m = state.clock.minute;
  const prof = intradayProfile(m);
  const sp = Math.sqrt(prof);
  const volMult = marketVolMult(state);
  const mv = BALANCE.market.marketVol;
  const sv = BALANCE.market.sectorVol;
  const { r, extra } = getScratch(n);
  absorbImpacts(state, extra);

  // factor shocks
  const fm = marketDailyDrift(state) / SESSION_MINUTES + mv * volMult * SQRT_DT * sp * rng.fatTail(6);
  const fs: Record<string, number> = {};
  for (const s of SECTORS) {
    const st = state.sectors[s.id];
    const drift = st.sentiment * 0.0006 + st.shockDrift;
    fs[s.id] = drift / SESSION_MINUTES + sv * volMult * SQRT_DT * sp * rng.normal();
  }
  const maxMove = BALANCE.market.maxMinuteMove;
  const t = timestampFor(state.clock.date, m);
  const dayT = dayTimestamp(state.clock.date);

  for (let i = 0; i < n; i++) {
    const inst = insts[i];
    if (inst.kind === 'etf') continue;
    let ret: number;
    let sys: number;
    const boost = inst.volBoost;
    if (inst.kind === 'commodity') {
      const idioVol = inst.vol * volMult * boost * SQRT_DT * sp;
      const crisisFlip = inst.commodity!.driver === 'gold' && state.macro.regime === 'crisis' ? -0.3 : inst.beta;
      sys = crisisFlip * fm + commodityDailyDrift(inst, state.macro) / SESSION_MINUTES;
      if (inst.link) sys += inst.link.load * r[inst.link.idx];
      ret = sys + clamp(idioVol * rng.normal(), maxMove);
    } else {
      const sysVar = (inst.beta * mv) ** 2 + (inst.sectorLoading * sv) ** 2;
      const idioDaily = Math.sqrt(Math.max(inst.vol * inst.vol - sysVar, (0.45 * inst.vol) ** 2));
      const idioVol = idioDaily * volMult * boost * SQRT_DT * sp;
      sys = inst.beta * fm + inst.sectorLoading * fs[inst.sector as string] + macroDriftFor(inst, state.macro) / SESSION_MINUTES;
      if (inst.link) sys += inst.link.load * r[inst.link.idx];
      const f = inst.fundamentals!;
      const pull = clamp((BALANCE.market.fairValuePull / SESSION_MINUTES) * Math.log(f.fairValue / inst.price), 0.0004);
      ret = sys + pull + clamp(idioVol * rng.normal(), maxMove);
    }
    inst.sysAcc += sys;
    ret += extra[i];
    r[i] = ret;
  }
  // ETFs: weighted constituent log-returns + tracking noise
  const te = BALANCE.market.etfTrackingVol * SQRT_DT;
  for (let i = 0; i < n; i++) {
    const inst = insts[i];
    if (inst.kind !== 'etf') continue;
    let acc = 0;
    for (const c of inst.etf!.constituents) acc += c.w * r[c.idx];
    r[i] = acc + te * rng.normal() + extra[i];
  }

  // apply returns & write bars
  for (let i = 0; i < n; i++) {
    const inst = insts[i];
    const o = inst.price;
    let c = o * Math.exp(r[i]);
    if (c < BALANCE.market.minPrice) c = BALANCE.market.minPrice;
    const minuteVol = inst.vol * volMult * inst.volBoost * SQRT_DT * sp;
    const hi = Math.max(o, c) * Math.exp(Math.abs(rng.normal()) * minuteVol * 0.45);
    const lo = Math.min(o, c) * Math.exp(-Math.abs(rng.normal()) * minuteVol * 0.45);
    const surprise = Math.min(6, Math.abs(r[i]) / Math.max(minuteVol, 1e-6));
    const vol = Math.max(0, Math.round((inst.adv / SESSION_MINUTES) * prof * (0.6 + 0.35 * surprise) * Math.exp(0.35 * rng.normal())));
    inst.price = c;
    if (hi > inst.dayHigh) inst.dayHigh = hi;
    if (lo < inst.dayLow) inst.dayLow = lo;
    inst.dayVolume += vol;
    writeBars(state, i, t, dayT, m, o, hi, lo, c, vol);
    // decay transient vol boost
    if (inst.volBoost !== 1) inst.volBoost = 1 + (inst.volBoost - 1) * 0.993;
  }
}

function clamp(x: number, lim: number) {
  return x > lim ? lim : x < -lim ? -lim : x;
}

/** Push/extend bars for every timeframe so all views share one underlying history. */
function writeBars(state: GameState, i: number, t: number, dayT: number, m: number, o: number, h: number, l: number, c: number, v: number) {
  const H = state.history;
  pushBar(H.m1[i], t, o, h, l, c, v);
  extendBucket(H.m15[i], t, m, 15, o, h, l, c, v);
  extendBucket(H.h1[i], t, m, 60, o, h, l, c, v);
  // daily bar is opened in openDailyBars; extend it in place
  const d = H.d1[i];
  if (d.len) {
    const j = (d.start + d.len - 1) % d.cap;
    if (d.t[j] === dayT) {
      if (h > d.h[j]) d.h[j] = h;
      if (l < d.l[j]) d.l[j] = l;
      d.c[j] = c;
      d.v[j] += v;
    }
  }
}

function extendBucket(s: SeriesData, t: number, m: number, size: number, o: number, h: number, l: number, c: number, v: number) {
  if (m % size === 0 || !s.len) {
    pushBar(s, t - (m % size) * 60, o, h, l, c, v);
    return;
  }
  const j = (s.start + s.len - 1) % s.cap;
  if (h > s.h[j]) s.h[j] = h;
  if (l < s.l[j]) s.l[j] = l;
  s.c[j] = c;
  s.v[j] += v;
}

/** Create today's daily bar at the open price. */
export function openDailyBars(state: GameState) {
  const t = dayTimestamp(state.clock.date);
  for (const inst of state.instruments) {
    const d = state.history.d1[inst.idx];
    const last = lastBar(d);
    if (last && last.time === t) continue;
    pushBar(d, t, inst.price, inst.price, inst.price, inst.price, 0);
    inst.dayOpen = inst.price;
    inst.dayHigh = inst.price;
    inst.dayLow = inst.price;
    inst.dayVolume = 0;
  }
}

/**
 * Overnight move between yesterday's close and today's open: macro factor noise,
 * idiosyncratic noise, multi-day event drifts, and the bulk of any news that
 * broke while the market was closed (gaps).
 */
export function applyOvernightGap(state: GameState) {
  const rng = new Rng(state.rng.market);
  const insts = state.instruments;
  const n = insts.length;
  const volMult = marketVolMult(state);
  const of = BALANCE.market.overnightVolFrac;
  const fm = marketDailyDrift(state) * 0.15 + BALANCE.market.marketVol * volMult * of * rng.fatTail(6);
  const fs: Record<string, number> = {};
  for (const s of SECTORS) fs[s.id] = BALANCE.market.sectorVol * volMult * of * rng.normal();
  const extra = new Float64Array(n);
  for (const imp of state.impacts) {
    // news that broke overnight gaps most of the way in at the open
    const a = imp.remaining * 0.7;
    extra[imp.idx] += a;
    imp.remaining -= a;
    if (imp.daysLeft > 0) {
      extra[imp.idx] += imp.dailyDrift;
      imp.daysLeft--;
      imp.dailyDrift *= 0.7;
    }
  }
  state.impacts = state.impacts.filter((i) => Math.abs(i.remaining) > 1e-5 || i.daysLeft > 0);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const inst = insts[i];
    if (inst.kind === 'etf') continue;
    let sys = inst.kind === 'commodity' ? inst.beta * fm : inst.beta * fm + inst.sectorLoading * fs[inst.sector as string];
    if (inst.link) sys += inst.link.load * r[inst.link.idx];
    inst.sysAcc += sys;
    r[i] = sys + inst.vol * volMult * of * 0.6 * rng.normal() + extra[i];
  }
  for (let i = 0; i < n; i++) {
    const inst = insts[i];
    if (inst.kind !== 'etf') continue;
    let acc = 0;
    for (const c of inst.etf!.constituents) acc += c.w * r[c.idx];
    r[i] = acc + extra[i];
  }
  for (let i = 0; i < n; i++) {
    const inst = insts[i];
    inst.price = Math.max(BALANCE.market.minPrice, inst.price * Math.exp(r[i]));
  }
}

/** End-of-day housekeeping for instruments: roll fair values, trends and anchors. (prevClose rolls next morning so the evening still shows today's change.) */
export function closeMarketDay(state: GameState) {
  const rng = new Rng(state.rng.market);
  for (const inst of state.instruments) {
    const f = inst.fundamentals;
    if (f) {
      // systematic moves change intrinsic value; only idiosyncratic mispricing mean-reverts
      f.fairValue *= Math.exp(inst.sysAcc + f.trend * 0.0005 + rng.normal() * inst.vol * 0.15);
      f.trend = Math.max(-1, Math.min(1, f.trend * 0.996 + 0.03 * rng.normal()));
    }
    if (inst.commodity) {
      inst.commodity.anchor *= Math.exp(state.macro.inflation / 100 / 252 + 0.004 * rng.normal());
    }
    inst.sysAcc = 0;
    inst.newsTone *= 0.85;
  }
}

/** Simple daily-step history used to backfill ~1 year of daily bars before the game starts. */
export function generatePreHistory(state: GameState, days: number, dates: string[]) {
  // We simulate backwards: generate a forward path of log-returns, then scale so it ends at the current price.
  const rng = new Rng(state.rng.market);
  const insts = state.instruments;
  const n = insts.length;
  const paths: Float64Array[] = insts.map(() => new Float64Array(days));
  const mv = BALANCE.market.marketVol;
  const sv = BALANCE.market.sectorVol;
  for (let d = 0; d < days; d++) {
    const fm = BALANCE.market.baseDrift + mv * rng.fatTail(6);
    const fs: Record<string, number> = {};
    for (const s of SECTORS) fs[s.id] = sv * rng.normal();
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const inst = insts[i];
      if (inst.kind === 'etf') continue;
      let sys = inst.kind === 'commodity' ? inst.beta * fm : inst.beta * fm + inst.sectorLoading * fs[inst.sector as string];
      if (inst.link) sys += inst.link.load * r[inst.link.idx];
      const idio = inst.kind === 'commodity' ? inst.vol : Math.sqrt(Math.max(inst.vol ** 2 - (inst.beta * mv) ** 2 - (inst.sectorLoading * sv) ** 2, (0.45 * inst.vol) ** 2));
      r[i] = sys + idio * rng.normal();
    }
    for (let i = 0; i < n; i++) {
      const inst = insts[i];
      if (inst.kind !== 'etf') continue;
      let acc = 0;
      for (const c of inst.etf!.constituents) acc += c.w * r[c.idx];
      r[i] = acc;
    }
    for (let i = 0; i < n; i++) paths[i][d] = r[i];
  }
  for (let i = 0; i < n; i++) {
    const inst = insts[i];
    const path = paths[i];
    // level at day k = price * exp(-(sum of returns after k))
    let cum = 0;
    const closes = new Float64Array(days);
    for (let d = days - 1; d >= 0; d--) {
      closes[d] = inst.price * Math.exp(-cum);
      cum += path[d];
    }
    let prev = closes[0] * Math.exp(-path[0]);
    for (let d = 0; d < days; d++) {
      const c = closes[d];
      const o = prev * Math.exp(inst.vol * 0.25 * rng.normal());
      const h = Math.max(o, c) * Math.exp(Math.abs(rng.normal()) * inst.vol * 0.5);
      const l = Math.min(o, c) * Math.exp(-Math.abs(rng.normal()) * inst.vol * 0.5);
      const v = Math.round(inst.adv * (0.7 + 0.25 * Math.min(5, Math.abs(path[d]) / inst.vol)) * Math.exp(0.3 * rng.normal()));
      pushBar(state.history.d1[i], dayTimestamp(dates[d]), o, h, l, c, v);
      prev = c;
    }
    inst.prevClose = inst.price;
  }
}

/** Live mark for an instrument within today's minute bar (for UI use). */
export function updateBarsWithFill(state: GameState, idx: number, qty: number) {
  const s = state.history.m1[idx];
  updateLast(s, state.instruments[idx].price, qty);
  state.instruments[idx].dayVolume += qty;
}
