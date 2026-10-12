/**
 * Order management and execution.
 *
 * Execution model (documented in docs/SIMULATION.md):
 *  - Market orders during the session fill immediately at the current price
 *    ± half-spread ± square-root market impact. Outside the session they queue
 *    and fill against the first bar of the next session (the gapped open).
 *  - Buy limit fills when the ask (bar low + half-spread) trades at or below the
 *    limit, at min(limit, open ask). Sell limit is symmetric.
 *  - Stop orders trigger when the bar trades through the stop and fill like a
 *    market order from the worse of stop and open, so gaps can produce fills
 *    worse than the stop price.
 *  - Sides: buy/sell operate on longs, short/cover on shorts. Positions cannot
 *    flip sign in one order (sell more than you hold is rejected).
 *  - No partial fills; orders larger than 10% of ADV are rejected.
 */
import { BALANCE } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import { applyTrade, commissionFor, instById, marginRates, navCents, signedDelta, summarize, toCents } from './accounting';
import { automationOn } from './company';
import { lastBar } from './series';
import { executionDiscount } from './staff';
import { nextId, notify, logKeyEvent } from './notify';
import type { Cents, Fill, GameState, Instrument, Order, OrderOrigin, OrderSide, OrderType } from './types';

export interface OrderDraft {
  instrument: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  tif: 'day' | 'gtc';
}

export interface OrderCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  estPrice: number;
  estNotional: Cents;
  estCommission: Cents;
  estCost: Cents; // spread + impact cost vs mid
  post: ProjectedRisk | null;
  maxQty: number;
}

export interface ProjectedRisk {
  nav: Cents;
  gross: Cents;
  grossLeverage: number;
  initialReq: Cents;
  maintenanceReq: Cents;
  marginUtilisation: number;
  positionWeight: number;
  sectorWeight: number;
  sector: string;
}

const isBuySide = (s: OrderSide) => s === 'buy' || s === 'cover';

export function spreadFraction(state: GameState, inst: Instrument): number {
  const d = DIFFICULTIES[state.setup.difficulty];
  const regime = state.macro.regime === 'crisis' ? 2.2 : state.macro.regime === 'bear' ? 1.3 : 1;
  return (inst.halfSpreadBps / 10_000) * d.costMult * (1 - executionDiscount(state)) * regime * Math.sqrt(inst.volBoost);
}

export function impactFraction(state: GameState, inst: Instrument, qty: number): number {
  const d = DIFFICULTIES[state.setup.difficulty];
  return BALANCE.trading.impactCoef * inst.vol * Math.sqrt(Math.max(0, qty) / Math.max(inst.adv, 1)) * (1 - executionDiscount(state)) * d.costMult;
}

/** Executable price for an immediate (market) execution from a reference price. */
export function marketFillPrice(state: GameState, inst: Instrument, side: OrderSide, qty: number, ref = inst.price, penalty = 1): number {
  const adj = (spreadFraction(state, inst) + impactFraction(state, inst, qty)) * penalty;
  return isBuySide(side) ? ref * (1 + adj) : ref * (1 - adj);
}

export function currentQty(state: GameState, id: string): number {
  return state.fund.positions[id]?.qty ?? 0;
}

function pendingQty(state: GameState, id: string, side: OrderSide): number {
  let q = 0;
  for (const o of state.orders) if (o.status === 'open' && o.instrument === id && o.side === side) q += o.quantity;
  return q;
}

function sectorKey(inst: Instrument) {
  return inst.kind === 'commodity' ? 'commodity' : inst.sector === 'broad' ? 'broad' : (inst.sector as string);
}

/** Risk metrics after a hypothetical trade at the current price (costs ignored). */
export function projectRisk(state: GameState, instId: string, delta: number): ProjectedRisk {
  const nav = navCents(state);
  let gross = 0, init = 0, maint = 0, posVal = 0;
  const sectors: Record<string, number> = {};
  const target = instById(state, instId)!;
  const seen = new Set<string>();
  const each = (inst: Instrument, qty: number) => {
    if (qty === 0) return;
    const v = qty * inst.price * 100;
    const mr = marginRates(state, inst);
    gross += Math.abs(v);
    init += Math.abs(v) * (qty > 0 ? mr.initial : mr.shortInitial);
    maint += Math.abs(v) * (qty > 0 ? mr.maintenance : mr.shortMaintenance);
    const sk = sectorKey(inst);
    if (sk !== 'broad') sectors[sk] = (sectors[sk] ?? 0) + Math.abs(v);
    if (inst.id === instId) posVal = v;
  };
  for (const p of Object.values(state.fund.positions)) {
    const inst = instById(state, p.instrument);
    if (!inst) continue;
    seen.add(p.instrument);
    each(inst, p.instrument === instId ? p.qty + delta : p.qty);
  }
  if (!seen.has(instId)) each(target, delta);
  const navPos = Math.max(nav, 1);
  const sk = sectorKey(target);
  return {
    nav, gross: Math.round(gross), grossLeverage: gross / navPos, initialReq: Math.round(init), maintenanceReq: Math.round(maint),
    marginUtilisation: maint / navPos, positionWeight: Math.abs(posVal) / navPos, sectorWeight: (sectors[sk] ?? 0) / navPos, sector: sk,
  };
}

export function validateOrder(state: GameState, draft: OrderDraft, origin: OrderOrigin = 'player'): OrderCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const inst = instById(state, draft.instrument);
  const res: OrderCheck = { ok: false, errors, warnings, estPrice: 0, estNotional: 0, estCommission: 0, estCost: 0, post: null, maxQty: 0 };
  if (state.status !== 'active') {
    errors.push('The fund is no longer operating.');
    return res;
  }
  if (!inst) {
    errors.push('Unknown instrument.');
    return res;
  }
  const qty = draft.quantity;
  const maxQty = Math.floor(inst.adv * BALANCE.trading.maxAdvFraction);
  res.maxQty = maxQty;
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) errors.push('Quantity must be a whole number greater than zero.');
  else if (qty > maxQty) errors.push(`Order exceeds the liquidity limit of ${maxQty.toLocaleString('en-US')} units (10% of average daily volume).`);

  if (draft.type === 'limit') {
    if (!draft.limitPrice || !Number.isFinite(draft.limitPrice) || draft.limitPrice <= 0) errors.push('Enter a valid limit price.');
    else if (draft.limitPrice > inst.price * 1.5 || draft.limitPrice < inst.price * 0.5) errors.push('Limit price must be within ±50% of the current price.');
  }
  if (draft.type === 'stop') {
    if (!draft.stopPrice || !Number.isFinite(draft.stopPrice) || draft.stopPrice <= 0) errors.push('Enter a valid stop price.');
    else if (draft.stopPrice > inst.price * 1.5 || draft.stopPrice < inst.price * 0.5) errors.push('Stop price must be within ±50% of the current price.');
    else if (isBuySide(draft.side) && draft.stopPrice <= inst.price) errors.push('A buy-side stop must be above the current price (otherwise use a market or limit order).');
    else if (!isBuySide(draft.side) && draft.stopPrice >= inst.price) errors.push('A sell-side stop must be below the current price.');
  }

  const cur = currentQty(state, inst.id);
  switch (draft.side) {
    case 'buy':
      if (cur < 0) errors.push(`You are short ${inst.id}. Use Cover to buy back the short.`);
      break;
    case 'sell': {
      const avail = cur - pendingQty(state, inst.id, 'sell');
      if (cur <= 0) errors.push(`You have no long position in ${inst.id} to sell. Use Short to sell short.`);
      else if (qty > avail) errors.push(`You can sell at most ${Math.max(0, avail).toLocaleString('en-US')} units (including pending sell orders).`);
      break;
    }
    case 'short':
      if (!inst.shortable) errors.push(`${inst.id} is not available to borrow for short selling.`);
      if (cur > 0) errors.push(`You hold a long position in ${inst.id}. Sell it before shorting.`);
      break;
    case 'cover': {
      const avail = -cur - pendingQty(state, inst.id, 'cover');
      if (cur >= 0) errors.push(`You have no short position in ${inst.id} to cover.`);
      else if (qty > avail) errors.push(`You can cover at most ${Math.max(0, avail).toLocaleString('en-US')} units (including pending cover orders).`);
      break;
    }
  }

  // estimates (limit orders: worst case is the limit itself)
  const q = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const ref = draft.type === 'stop' ? draft.stopPrice ?? inst.price : inst.price;
  res.estPrice = draft.type === 'limit' ? draft.limitPrice ?? inst.price : marketFillPrice(state, inst, draft.side, q, ref);
  res.estNotional = toCents(q * res.estPrice);
  res.estCommission = q > 0 ? commissionFor(state, res.estNotional) : 0;
  res.estCost = toCents(Math.abs(res.estPrice - inst.price) * q);

  if (!errors.length && q > 0) {
    const delta = signedDelta(draft.side, q);
    const increasing = Math.abs(cur + delta) > Math.abs(cur);
    const post = projectRisk(state, inst.id, delta);
    res.post = post;
    const sum = summarize(state);
    const limits = state.risk.limits;
    const enforce = state.risk.enforcePreTrade || automationOn(state, 'riskMonitor') || origin === 'risk-monitor';
    if (increasing) {
      if (sum.nav <= 0) errors.push('Fund NAV is not positive; only risk-reducing orders are allowed.');
      else if (sum.maintenanceReq > sum.nav) errors.push('The fund is in a margin call. Only risk-reducing orders are allowed.');
      if (post.initialReq + res.estCommission > post.nav) {
        errors.push(`Insufficient buying power: this order needs ${fmt(post.initialReq / 100)} of initial margin against ${fmt(post.nav / 100)} of equity.`);
      }
      if (post.grossLeverage > limits.maxGross) {
        errors.push(`Gross exposure would reach ${(post.grossLeverage * 100).toFixed(0)}% of NAV, above the prime broker limit of ${(limits.maxGross * 100).toFixed(0)}%.`);
      }
      const posMsg = `Position would be ${(post.positionWeight * 100).toFixed(1)}% of NAV (limit ${(limits.maxPositionWeight * 100).toFixed(0)}%).`;
      const secMsg = `${post.sector} exposure would be ${(post.sectorWeight * 100).toFixed(1)}% of NAV (limit ${(limits.maxSectorWeight * 100).toFixed(0)}%).`;
      if (post.positionWeight > limits.maxPositionWeight && inst.kind !== 'etf') (enforce ? errors : warnings).push(posMsg);
      if (post.sector !== 'broad' && post.sectorWeight > limits.maxSectorWeight) (enforce ? errors : warnings).push(secMsg);
      if (post.marginUtilisation > limits.maxMarginUtilisation) (enforce ? errors : warnings).push(`Margin utilisation would be ${(post.marginUtilisation * 100).toFixed(0)}% (limit ${(limits.maxMarginUtilisation * 100).toFixed(0)}%).`);
      if (draft.side === 'short' && inst.borrowFee > 0.03) warnings.push(`${inst.id} is hard to borrow: ${(inst.borrowFee * 100).toFixed(1)}% annual borrow fee.`);
    }
    if (state.clock.phase !== 'open' && draft.type === 'market') warnings.push('The market is closed. This order will execute at the next open, which may gap away from the current price.');
    if (q > inst.adv * 0.02) warnings.push(`Large order: ${(q / inst.adv * 100).toFixed(1)}% of daily volume. Expect noticeable market impact.`);
  }
  res.ok = errors.length === 0;
  return res;
}

function fmt(x: number) {
  return '$' + Math.round(x).toLocaleString('en-US');
}

export function submitOrder(state: GameState, draft: OrderDraft, origin: OrderOrigin = 'player'): Order {
  const inst = instById(state, draft.instrument);
  const check = validateOrder(state, draft, origin);
  const order: Order = {
    id: nextId(state, 'order', 'O'),
    instrument: draft.instrument,
    side: draft.side,
    type: draft.type,
    quantity: draft.quantity,
    limitPrice: draft.type === 'limit' ? draft.limitPrice : undefined,
    stopPrice: draft.type === 'stop' ? draft.stopPrice : undefined,
    tif: draft.tif,
    status: 'open',
    createdDay: state.clock.day,
    createdMinute: state.clock.minute,
    createdDate: state.clock.date,
    origin,
    refPrice: inst?.price ?? 0,
  };
  state.orders.push(order);
  trimOrders(state);
  if (!check.ok) {
    order.status = 'rejected';
    order.reason = check.errors.join(' ');
    if (origin === 'player') notify(state, 'danger', `Order rejected: ${draft.side.toUpperCase()} ${draft.quantity.toLocaleString('en-US')} ${draft.instrument}`, order.reason, { link: { screen: 'orders' }, sound: 'reject' });
    return order;
  }
  if (state.clock.phase === 'open' && inst) {
    if (order.type === 'market') executeOrder(state, order, inst, inst.price, 1);
    else if (order.type === 'limit') {
      const sf = spreadFraction(state, inst);
      const ask = inst.price * (1 + sf), bid = inst.price * (1 - sf);
      if (isBuySide(order.side) && ask <= order.limitPrice!) executeOrder(state, order, inst, ask, 1, true);
      else if (!isBuySide(order.side) && bid >= order.limitPrice!) executeOrder(state, order, inst, bid, 1, true);
    }
  }
  if (origin === 'player' && order.status === 'open') {
    notify(state, 'info', 'Order working', `${describeOrder(order)} placed${state.clock.phase !== 'open' ? ' for the next session' : ''}.`, { link: { screen: 'orders' }, sound: 'order', toast: true });
  }
  return order;
}

export function describeOrder(o: Order): string {
  const px = o.type === 'limit' ? ` @ ${o.limitPrice?.toFixed(2)} limit` : o.type === 'stop' ? ` @ ${o.stopPrice?.toFixed(2)} stop` : ' at market';
  return `${o.side.toUpperCase()} ${o.quantity.toLocaleString('en-US')} ${o.instrument}${px}`;
}

function trimOrders(state: GameState) {
  const cap = BALANCE.orderHistoryCap;
  if (state.orders.length > cap) {
    const closed = state.orders.filter((o) => o.status !== 'open');
    const remove = state.orders.length - cap;
    const drop = new Set(closed.slice(0, remove).map((o) => o.id));
    state.orders = state.orders.filter((o) => !drop.has(o.id));
  }
  if (state.fills.length > cap) state.fills.splice(0, state.fills.length - cap);
}

export function cancelOrder(state: GameState, orderId: string): boolean {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o || o.status !== 'open') return false;
  o.status = 'cancelled';
  o.reason = 'Cancelled by user';
  return true;
}

/**
 * Execute an order at `basePrice`. If `passive`, the price is already the
 * executable quote (limit fill); otherwise spread + impact are applied.
 * Re-validates buying power for risk-increasing orders at execution time.
 */
function executeOrder(state: GameState, order: Order, inst: Instrument, basePrice: number, penalty: number, passive = false): boolean {
  const cur = currentQty(state, inst.id);
  const delta = signedDelta(order.side, order.quantity);
  // sanity: closing orders cannot exceed the current position
  if ((order.side === 'sell' && order.quantity > cur) || (order.side === 'cover' && order.quantity > -cur)) {
    order.status = 'rejected';
    order.reason = 'Position changed: quantity exceeds the current position.';
    return false;
  }
  if (Math.abs(cur + delta) > Math.abs(cur) && order.origin !== 'forced-liquidation') {
    const post = projectRisk(state, inst.id, delta);
    if (post.initialReq > post.nav || post.grossLeverage > state.risk.limits.maxGross * 1.02) {
      order.status = 'rejected';
      order.reason = 'Insufficient buying power at execution time.';
      if (order.origin === 'player') notify(state, 'danger', 'Order rejected at execution', `${describeOrder(order)}: insufficient buying power when the order triggered.`, { link: { screen: 'orders' }, sound: 'reject' });
      return false;
    }
  }
  const price = passive ? basePrice : marketFillPrice(state, inst, order.side, order.quantity, basePrice, penalty);
  const notional = toCents(order.quantity * price);
  const commission = commissionFor(state, notional) * (order.origin === 'forced-liquidation' ? 2 : 1);
  const realized = applyTrade(state, inst.id, order.side, order.quantity, price, commission);
  // informational: execution cost versus the mid price (already embedded in the fill price)
  const slippageCost = toCents(Math.abs(price - (passive ? inst.price : basePrice)) * order.quantity);
  state.fund.totals.slippage += slippageCost;
  order.status = 'filled';
  order.fillPrice = price;
  order.commission = commission;
  order.slippageCost = slippageCost;
  order.filledDay = state.clock.day;
  order.filledMinute = state.clock.minute;
  const fill: Fill = {
    id: nextId(state, 'fill', 'F'),
    orderId: order.id,
    instrument: inst.id,
    side: order.side,
    quantity: order.quantity,
    price,
    notional,
    commission,
    slippageCost,
    realizedPnl: realized,
    day: state.clock.day,
    minute: state.clock.minute,
    date: state.clock.date,
    origin: order.origin,
  };
  state.fills.push(fill);
  state.stats.trades++;
  if (order.side === 'short') state.stats.shorts++;
  inst.dayVolume += order.quantity;
  if (order.origin === 'player' || order.origin === 'stop-protection') {
    notify(state, 'success', `Filled: ${order.side.toUpperCase()} ${order.quantity.toLocaleString('en-US')} ${inst.id}`, `@ ${price.toFixed(2)} · commission ${fmt(commission / 100)}${realized ? ` · realised ${realized >= 0 ? '+' : '−'}${fmt(Math.abs(realized) / 100)}` : ''}`, { link: { screen: 'orders' }, sound: 'order' });
  }
  // stop protection automation for new/increased positions
  if (order.origin === 'player' && (order.side === 'buy' || order.side === 'short') && automationOn(state, 'stopProtection')) {
    const pct = state.company.stopProtectionPct;
    const stopPrice = Math.round((order.side === 'buy' ? price * (1 - pct) : price * (1 + pct)) * 100) / 100;
    const o2: Order = {
      id: nextId(state, 'order', 'O'), instrument: inst.id, side: order.side === 'buy' ? 'sell' : 'cover', type: 'stop', quantity: order.quantity,
      stopPrice, tif: 'gtc', status: 'open', createdDay: state.clock.day, createdMinute: state.clock.minute, createdDate: state.clock.date,
      origin: 'stop-protection', refPrice: inst.price,
    };
    state.orders.push(o2);
  }
  return true;
}

/** Immediate execution used by internal processes (redemptions, rebalancing, liquidation). */
export function executeImmediate(state: GameState, instId: string, side: OrderSide, qty: number, origin: OrderOrigin, penalty = 1): Fill | null {
  const inst = instById(state, instId);
  if (!inst || qty <= 0) return null;
  const order: Order = {
    id: nextId(state, 'order', 'O'), instrument: instId, side, type: 'market', quantity: qty, tif: 'day', status: 'open',
    createdDay: state.clock.day, createdMinute: state.clock.minute, createdDate: state.clock.date, origin, refPrice: inst.price,
  };
  state.orders.push(order);
  const ok = executeOrder(state, order, inst, inst.price, penalty);
  return ok ? state.fills[state.fills.length - 1] : null;
}

/** Check all working orders against the bar that just formed. */
export function processOrders(state: GameState) {
  const open = state.orders.filter((o) => o.status === 'open');
  for (const o of open) {
    if (o.status !== 'open') continue;
    const inst = instById(state, o.instrument);
    if (!inst) continue;
    const bar = lastBar(state.history.m1[inst.idx]);
    if (!bar) continue;
    const sf = spreadFraction(state, inst);
    if (o.type === 'market') {
      executeOrder(state, o, inst, bar.open, 1);
    } else if (o.type === 'limit') {
      const L = o.limitPrice!;
      if (isBuySide(o.side)) {
        if (bar.low * (1 + sf) <= L) executeOrder(state, o, inst, Math.min(L, bar.open * (1 + sf)), 1, true);
      } else if (bar.high * (1 - sf) >= L) executeOrder(state, o, inst, Math.max(L, bar.open * (1 - sf)), 1, true);
    } else if (o.type === 'stop') {
      const S = o.stopPrice!;
      if (isBuySide(o.side)) {
        if (bar.high >= S) {
          o.triggered = true;
          executeOrder(state, o, inst, Math.max(S, bar.open), 1);
        }
      } else if (bar.low <= S) {
        o.triggered = true;
        executeOrder(state, o, inst, Math.min(S, bar.open), 1);
      }
    }
  }
}

export function expireDayOrders(state: GameState) {
  for (const o of state.orders) {
    if (o.status === 'open' && o.tif === 'day' && o.createdDay <= state.clock.day && !(o.createdDay === state.clock.day && o.createdMinute >= 390)) {
      // orders placed after today's close stay working for the next session
      o.status = 'expired';
      o.reason = 'Day order expired at the close';
    }
  }
}

/**
 * Margin enforcement. The risk-monitor automation trims at 90% utilisation with
 * normal costs; the prime broker force-liquidates at 100% with penalty costs.
 */
export function enforceMargin(state: GameState): 'ok' | 'trimmed' | 'liquidated' | 'wiped' {
  let s = summarize(state);
  if (!s.positions.length) return 'ok';
  if (s.nav <= 0) {
    for (const p of s.positions) executeImmediate(state, p.id, p.qty > 0 ? 'sell' : 'cover', Math.abs(p.qty), 'forced-liquidation', 2);
    return 'wiped';
  }
  const monitor = automationOn(state, 'riskMonitor');
  let result: 'ok' | 'trimmed' | 'liquidated' = 'ok';
  if (monitor && s.marginUtilisation > 0.9 && s.marginUtilisation <= 1) {
    reduceUntil(state, 0.75, 'risk-monitor', 1);
    notify(state, 'warning', 'Risk monitor trimmed positions', 'Margin utilisation exceeded 90%. The risk monitor reduced the largest exposures to avoid a margin call.', { link: { screen: 'risk' }, sound: 'alert' });
    result = 'trimmed';
    s = summarize(state);
  }
  if (s.marginUtilisation > 1) {
    reduceUntil(state, 0.8, 'forced-liquidation', 2);
    state.risk.marginCalls++;
    state.risk.lastMarginCallDay = state.clock.day;
    state.reputation = Math.max(0, state.reputation - 4);
    for (const c of state.clients) if (c.status === 'active') c.confidence = Math.max(0, c.confidence - 8 * c.withdrawalSensitivity);
    notify(state, 'danger', 'MARGIN CALL — forced liquidation', 'Equity fell below the maintenance margin requirement. The prime broker liquidated positions at penalty costs. Clients have been informed.', { link: { screen: 'risk' }, sound: 'alert' });
    logKeyEvent(state, 'Margin call: prime broker force-liquidated positions');
    result = 'liquidated';
  }
  return result;
}

function reduceUntil(state: GameState, targetUtil: number, origin: OrderOrigin, penalty: number) {
  for (let guard = 0; guard < 40; guard++) {
    const s = summarize(state);
    if (s.nav <= 0 || s.marginUtilisation <= targetUtil || !s.positions.length) return;
    const excess = s.maintenanceReq - targetUtil * s.nav;
    // biggest margin consumer first
    let best = s.positions[0], bestReq = 0;
    for (const p of s.positions) {
      const mr = marginRates(state, p.inst);
      const req = p.exposure * (p.qty > 0 ? mr.maintenance : mr.shortMaintenance);
      if (req > bestReq) { best = p; bestReq = req; }
    }
    const mr = marginRates(state, best.inst);
    const rate = best.qty > 0 ? mr.maintenance : mr.shortMaintenance;
    // reducing exposure by X reduces requirement by X*rate (NAV ~unchanged aside from costs)
    const unitReq = best.price * 100 * rate;
    let qty = Math.ceil((excess / Math.max(unitReq, 1)) * 1.1);
    qty = Math.max(1, Math.min(Math.abs(best.qty), qty));
    // cancel working orders on this instrument that could conflict
    for (const o of state.orders) if (o.status === 'open' && o.instrument === best.id && (o.side === 'sell' || o.side === 'cover')) { o.status = 'cancelled'; o.reason = 'Cancelled during margin reduction'; }
    executeImmediate(state, best.id, best.qty > 0 ? 'sell' : 'cover', qty, origin, penalty);
  }
}

/**
 * Raise free cash for redemptions by selling longs pro rata. Returns cents raised.
 */
export function raiseCash(state: GameState, needed: Cents): Cents {
  const s = summarize(state);
  const longs = s.positions.filter((p) => p.qty > 0);
  const longValue = longs.reduce((a, p) => a + p.value, 0);
  if (needed <= 0 || longValue <= 0) return 0;
  const frac = Math.min(1, (needed * 1.01) / longValue);
  const before = state.fund.cash;
  for (const p of longs) {
    for (const o of state.orders) if (o.status === 'open' && o.instrument === p.id && o.side === 'sell') { o.status = 'cancelled'; o.reason = 'Cancelled: position sold to meet redemptions'; }
    const qty = Math.min(p.qty, Math.ceil(p.qty * frac));
    if (qty > 0) executeImmediate(state, p.id, 'sell', qty, 'redemption');
  }
  return state.fund.cash - before;
}

export function openOrders(state: GameState) {
  return state.orders.filter((o) => o.status === 'open');
}

export function keyEventForBigTrade(state: GameState, fill: Fill, nav: Cents) {
  if (Math.abs(fill.notional) > nav * 0.15) logKeyEvent(state, `Large trade: ${fill.side} ${fill.quantity.toLocaleString('en-US')} ${fill.instrument} (${Math.round((fill.notional / nav) * 100)}% of NAV)`);
}
