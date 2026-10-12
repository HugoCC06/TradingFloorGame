/**
 * Performance measurement. Investment performance is the time-weighted return
 * of NAV per unit: subscriptions and redemptions transact at NAV per unit and
 * fees are charged by unit cancellation, so neither flows nor fees distort it.
 * It is therefore a GROSS-of-fee investment return; the net-of-fee experience
 * of a representative 2/20 investor is tracked separately as `netIndex`.
 */
import { navPerUnit, summarize } from './accounting';
import { closeAt } from './series';
import type { GameState } from './types';

export function currentNavpu(state: GameState): number {
  return navPerUnit(state);
}

/** NAV/unit `days` trading days ago (0 = last close). Falls back to the earliest record. */
export function navpuDaysAgo(state: GameState, days: number): number {
  const d = state.daily;
  if (!d.length) return 100;
  const i = Math.max(0, d.length - 1 - days);
  return d[i].navPerUnit;
}

export function trailingReturn(state: GameState, days: number): number {
  const base = days >= state.daily.length ? 100 : navpuDaysAgo(state, days);
  const now = currentNavpu(state);
  return base > 0 ? now / base - 1 : 0;
}

export function annualise(r: number, days: number): number {
  if (days <= 0) return 0;
  const a = Math.pow(Math.max(1e-9, 1 + r), 252 / days) - 1;
  return Math.max(-1, Math.min(10, a));
}

export function sinceInception(state: GameState): number {
  return currentNavpu(state) / 100 - 1;
}

export function currentDrawdown(state: GameState): number {
  const peak = Math.max(state.fund.peakNavPerUnit, currentNavpu(state));
  return peak > 0 ? 1 - currentNavpu(state) / peak : 0;
}

export function benchmarkLevel(state: GameState): number {
  return state.instruments[state.benchmarkIdx].price;
}

export function benchmarkSinceInception(state: GameState): number {
  const first = state.daily[0];
  const base = first ? first.benchmark / (1 + first.benchmarkReturn) : benchmarkLevel(state);
  return benchmarkLevel(state) / base - 1;
}

export function benchmarkTrailing(state: GameState, days: number): number {
  const d1 = state.history.d1[state.benchmarkIdx];
  const n = d1.len;
  if (n < 2) return 0;
  const back = Math.min(n - 1, days);
  const base = closeAt(d1, n - 1 - back);
  return benchmarkLevel(state) / base - 1;
}

export function daysActive(state: GameState) {
  return state.daily.length;
}

/** Daily return series of NAV/unit. */
export function dailyReturns(state: GameState): number[] {
  return state.daily.map((r) => r.dailyReturn);
}

export function volatility(state: GameState, days = 63): number {
  const r = dailyReturns(state).slice(-days);
  if (r.length < 5) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * 252);
}

export function sharpe(state: GameState, days = 252): number {
  const r = dailyReturns(state).slice(-days);
  if (r.length < 10) return 0;
  const rf = state.macro.policyRate / 100 / 252;
  const ex = r.map((x) => x - rf);
  const m = ex.reduce((a, b) => a + b, 0) / ex.length;
  const sd = Math.sqrt(ex.reduce((a, b) => a + (b - m) ** 2, 0) / (ex.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(252) : 0;
}

export function aum(state: GameState) {
  return summarize(state).nav;
}
