/**
 * Single authoritative fund accounting model.
 *
 * Fund ledger (owned by investors):
 *   NAV = cash + Σ qty_i × price_i            (qty signed: shorts are liabilities)
 *   short collateral = Σ_shorts |qty| × entryPrice   (proceeds restricted while short is open)
 *   free cash = cash − short collateral        (negative → margin loan, financed daily)
 *   NAV per unit = NAV / units outstanding     (time-weighted, unaffected by flows)
 *
 * Management company ledger (owned by the player's firm) is entirely separate
 * and only ever receives fees / pays expenses (see company.ts).
 *
 * All cash amounts are integer cents. Prices are floating dollars.
 */
import { BALANCE } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import type { Cents, GameState, Instrument, OrderSide, Position } from './types';

export const toCents = (dollars: number): Cents => Math.round(dollars * 100);
export const fromCents = (c: Cents): number => c / 100;

export function instById(state: GameState, id: string): Instrument | undefined {
  return lookup(state).get(id);
}

const lookupCache = new WeakMap<Instrument[], Map<string, Instrument>>();
function lookup(state: GameState): Map<string, Instrument> {
  let m = lookupCache.get(state.instruments);
  if (!m) {
    m = new Map(state.instruments.map((i) => [i.id, i]));
    lookupCache.set(state.instruments, m);
  }
  return m;
}

export function marginRates(state: GameState, inst: Instrument) {
  const base = BALANCE.margin[inst.kind];
  const mult = DIFFICULTIES[state.setup.difficulty].marginMult;
  const volAdj = inst.kind === 'equity' ? Math.min(1.6, Math.max(1, inst.vol / 0.025)) : 1;
  return {
    initial: Math.min(1, base.initial * mult * volAdj),
    maintenance: Math.min(0.95, base.maintenance * mult * volAdj),
    shortInitial: Math.min(1, base.shortInitial * mult * volAdj),
    shortMaintenance: Math.min(0.95, base.shortMaintenance * mult * volAdj),
  };
}

export function positionValue(pos: Position, price: number): Cents {
  return toCents(pos.qty * price);
}

export function shortCollateral(state: GameState): Cents {
  let c = 0;
  for (const p of Object.values(state.fund.positions)) if (p.qty < 0) c += toCents(-p.qty * p.avgPrice);
  return c;
}

export interface PositionView {
  id: string;
  inst: Instrument;
  qty: number;
  avgPrice: number;
  price: number;
  value: Cents; // signed market value
  exposure: Cents; // |value|
  costBasis: Cents; // |qty| * avg
  unrealized: Cents;
  unrealizedPct: number;
  dayPnl: Cents;
  weight: number; // signed, of NAV
  realized: Cents;
}

export interface PortfolioSummary {
  cash: Cents;
  collateral: Cents;
  freeCash: Cents;
  longValue: Cents;
  shortValue: Cents; // positive liability
  nav: Cents;
  navPerUnit: number;
  gross: Cents;
  net: Cents;
  grossLeverage: number;
  netLeverage: number;
  unrealized: Cents;
  maintenanceReq: Cents;
  initialReq: Cents;
  marginUtilisation: number;
  excessLiquidity: Cents;
  positions: PositionView[];
  sectorExposure: Record<string, { long: Cents; short: Cents; net: Cents; gross: Cents }>;
  largestPosition: PositionView | null;
  dayPnl: Cents;
}

/** The one place portfolio metrics are computed; UI must use this, not its own formulas. */
export function summarize(state: GameState): PortfolioSummary {
  const f = state.fund;
  let longValue = 0, shortValue = 0, unrealized = 0, maint = 0, init = 0, dayPnl = 0;
  const views: PositionView[] = [];
  const sectorExposure: PortfolioSummary['sectorExposure'] = {};
  for (const pos of Object.values(f.positions)) {
    if (pos.qty === 0) continue;
    const inst = instById(state, pos.instrument);
    if (!inst) continue;
    const value = positionValue(pos, inst.price);
    const costBasis = toCents(Math.abs(pos.qty) * pos.avgPrice);
    const unr = toCents(pos.qty * (inst.price - pos.avgPrice));
    const ref = pos.openedDay === state.clock.day && state.clock.phase !== 'pre' ? pos.avgPrice : inst.prevClose;
    const dp = toCents(pos.qty * (inst.price - ref));
    const mr = marginRates(state, inst);
    if (pos.qty > 0) {
      longValue += value;
      maint += value * mr.maintenance;
      init += value * mr.initial;
    } else {
      shortValue += -value;
      maint += -value * mr.shortMaintenance;
      init += -value * mr.shortInitial;
    }
    unrealized += unr;
    dayPnl += dp;
    const sec = inst.kind === 'commodity' ? 'commodity' : inst.kind === 'etf' && inst.sector === 'broad' ? 'broad' : (inst.sector as string);
    const se = (sectorExposure[sec] ??= { long: 0, short: 0, net: 0, gross: 0 });
    if (value > 0) se.long += value;
    else se.short += -value;
    se.net += value;
    se.gross += Math.abs(value);
    views.push({
      id: pos.instrument, inst, qty: pos.qty, avgPrice: pos.avgPrice, price: inst.price, value, exposure: Math.abs(value), costBasis,
      unrealized: unr, unrealizedPct: costBasis ? unr / costBasis : 0, dayPnl: dp, weight: 0, realized: pos.realized,
    });
  }
  const collateral = shortCollateral(state);
  const nav = f.cash + longValue - shortValue;
  const gross = longValue + shortValue;
  const navPos = Math.max(nav, 1);
  let largest: PositionView | null = null;
  for (const v of views) {
    v.weight = v.value / navPos;
    if (!largest || Math.abs(v.weight) > Math.abs(largest.weight)) largest = v;
  }
  views.sort((a, b) => b.exposure - a.exposure);
  const maintenanceReq = Math.round(maint);
  return {
    cash: f.cash,
    collateral,
    freeCash: f.cash - collateral,
    longValue,
    shortValue,
    nav,
    navPerUnit: f.unitsOutstanding > 0 ? nav / 100 / f.unitsOutstanding : 0,
    gross,
    net: longValue - shortValue,
    grossLeverage: gross / navPos,
    netLeverage: (longValue - shortValue) / navPos,
    unrealized,
    maintenanceReq,
    initialReq: Math.round(init),
    marginUtilisation: nav > 0 ? maintenanceReq / nav : maintenanceReq > 0 ? Infinity : 0,
    excessLiquidity: nav - maintenanceReq,
    positions: views,
    sectorExposure,
    largestPosition: largest,
    dayPnl,
  };
}

export function navCents(state: GameState): Cents {
  let v = state.fund.cash;
  for (const pos of Object.values(state.fund.positions)) {
    const inst = instById(state, pos.instrument);
    if (inst) v += positionValue(pos, inst.price);
  }
  return v;
}

export function navPerUnit(state: GameState): number {
  const u = state.fund.unitsOutstanding;
  return u > 0 ? navCents(state) / 100 / u : 0;
}

export function signedDelta(side: OrderSide, qty: number): number {
  return side === 'buy' || side === 'cover' ? qty : -qty;
}

/**
 * Apply an executed trade to the fund ledger. Commission is charged to cash
 * exactly once here and tracked separately; realised P&L is gross of commission.
 * Returns the realised P&L (cents) produced by this fill.
 */
export function applyTrade(state: GameState, instId: string, side: OrderSide, qty: number, price: number, commission: Cents): Cents {
  if (qty <= 0 || !Number.isFinite(price) || price <= 0) throw new Error('invalid trade');
  const f = state.fund;
  const delta = signedDelta(side, qty);
  const pos: Position = f.positions[instId] ?? { instrument: instId, qty: 0, avgPrice: 0, realized: 0, openedDay: state.clock.day };
  const notional = toCents(qty * price);
  f.cash += delta > 0 ? -notional : notional;
  f.cash -= commission;
  f.totals.commissions += commission;

  let realized = 0;
  if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(delta)) {
    const newQty = pos.qty + delta;
    pos.avgPrice = (Math.abs(pos.qty) * pos.avgPrice + qty * price) / Math.abs(newQty);
    if (pos.qty === 0) pos.openedDay = state.clock.day;
    pos.qty = newQty;
  } else {
    const closing = Math.min(qty, Math.abs(pos.qty));
    realized = toCents((price - pos.avgPrice) * closing * Math.sign(pos.qty));
    pos.qty += Math.sign(delta) * closing;
    const opening = qty - closing;
    if (opening > 0) {
      pos.qty = Math.sign(delta) * opening;
      pos.avgPrice = price;
      pos.openedDay = state.clock.day;
    }
  }
  pos.realized += realized;
  f.totals.realized += realized;
  f.instrumentPnl[instId] = (f.instrumentPnl[instId] ?? 0) + realized - commission;
  if (pos.qty === 0) {
    delete f.positions[instId];
  } else {
    f.positions[instId] = pos;
  }
  return realized;
}

export function commissionFor(state: GameState, notional: Cents): Cents {
  const d = DIFFICULTIES[state.setup.difficulty];
  return Math.max(BALANCE.trading.minCommission * 100, Math.round((Math.abs(notional) * BALANCE.trading.commissionBps * d.costMult) / 10_000));
}
