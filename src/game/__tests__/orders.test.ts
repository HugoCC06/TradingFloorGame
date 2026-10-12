import { summarize } from '../accounting';
import { cancelOrder, marketFillPrice, processOrders, submitOrder, validateOrder } from '../orders';
import { lastBar, setLast } from '../series';
import { nextDay, runToClose, stepMinute } from '../sim';
import { assertLedger, equity, fresh, openMarket } from './helpers';

const liquid = (g: ReturnType<typeof fresh>) => equity(g, (i) => i.adv * i.price > 1e9 && i.price > 20);

/** Force the latest 1-minute bar of an instrument (to test trigger logic deterministically). */
function forceBar(g: ReturnType<typeof fresh>, idx: number, o: number, h: number, l: number, c: number) {
  setLast(g.history.m1[idx], o, h, l, c, 1000);
  g.instruments[idx].price = c;
}

describe('order execution', () => {
  test('market buy fills immediately during the session above mid (spread + impact)', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    const mid = inst.price;
    const o = submitOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: 1000, tif: 'day' });
    expect(o.status).toBe('filled');
    expect(o.fillPrice!).toBeGreaterThan(mid);
    expect(o.fillPrice!).toBeCloseTo(marketFillPrice(g, inst, 'buy', 1000, mid), 8);
    expect(g.fund.positions[inst.id].qty).toBe(1000);
    // larger orders get worse prices (impact)
    expect(marketFillPrice(g, inst, 'buy', 100_000)).toBeGreaterThan(marketFillPrice(g, inst, 'buy', 1000));
    assertLedger(g);
  });

  test('market orders placed while closed queue and fill at the next open', () => {
    const g = fresh();
    expect(g.clock.phase).toBe('pre');
    const inst = liquid(g);
    const o = submitOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: 200, tif: 'day' });
    expect(o.status).toBe('open');
    stepMinute(g);
    expect(o.status).toBe('filled');
    const firstBar = g.history.m1[inst.idx];
    expect(o.fillPrice!).toBeGreaterThan(0);
    expect(o.filledMinute).toBe(0);
    void firstBar;
  });

  test('buy limit fills only when the market trades through the limit', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    const L = Math.round(inst.price * 0.97 * 100) / 100;
    const o = submitOrder(g, { instrument: inst.id, side: 'buy', type: 'limit', quantity: 100, limitPrice: L, tif: 'gtc' });
    expect(o.status).toBe('open');
    // a bar whose low stays just above the limit (+ spread) must not fill
    forceBar(g, inst.idx, L * 1.01, L * 1.02, L * 1.003, L * 1.01);
    processOrders(g);
    expect(o.status).toBe('open');
    // trade through the limit
    forceBar(g, inst.idx, L * 1.01, L * 1.02, L * 0.99, L * 1.0);
    processOrders(g);
    expect(o.status).toBe('filled');
    expect(o.fillPrice!).toBeLessThanOrEqual(L + 1e-9);
  });

  test('sell stop triggers on the low and gaps can fill worse than the stop', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    submitOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: 500, tif: 'day' });
    const S = Math.round(inst.price * 0.95 * 100) / 100;
    const o = submitOrder(g, { instrument: inst.id, side: 'sell', type: 'stop', quantity: 500, stopPrice: S, tif: 'gtc' });
    forceBar(g, inst.idx, S * 1.02, S * 1.03, S * 1.005, S * 1.01);
    processOrders(g);
    expect(o.status).toBe('open');
    // gap down: the bar opens well below the stop
    forceBar(g, inst.idx, S * 0.9, S * 0.92, S * 0.88, S * 0.91);
    processOrders(g);
    expect(o.status).toBe('filled');
    expect(o.triggered).toBe(true);
    expect(o.fillPrice!).toBeLessThan(S * 0.91);
    expect(g.fund.positions[inst.id]).toBeUndefined();
  });

  test('rejections: invalid quantity, oversell, unshortable, insufficient buying power', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    expect(validateOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: 0, tif: 'day' }).ok).toBe(false);
    expect(validateOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: 1.5, tif: 'day' }).ok).toBe(false);
    expect(validateOrder(g, { instrument: inst.id, side: 'sell', type: 'market', quantity: 10, tif: 'day' }).errors[0]).toMatch(/no long position/);
    expect(validateOrder(g, { instrument: inst.id, side: 'cover', type: 'market', quantity: 10, tif: 'day' }).ok).toBe(false);
    expect(validateOrder(g, { instrument: 'NOPE', side: 'buy', type: 'market', quantity: 10, tif: 'day' }).ok).toBe(false);
    const nav = summarize(g).nav / 100;
    const huge = Math.min(Math.floor(inst.adv * 0.1), Math.floor((nav * 5) / inst.price));
    const r = validateOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: huge, tif: 'day' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/buying power|Gross exposure/);
    const unshort = g.instruments.find((i) => i.kind === 'equity' && !i.shortable);
    if (unshort) expect(validateOrder(g, { instrument: unshort.id, side: 'short', type: 'market', quantity: 10, tif: 'day' }).errors.join()).toMatch(/not available to borrow/);
    const rej = submitOrder(g, { instrument: inst.id, side: 'sell', type: 'market', quantity: 10, tif: 'day' });
    expect(rej.status).toBe('rejected');
    expect(rej.reason).toBeTruthy();
    expect(validateOrder(g, { instrument: inst.id, side: 'buy', type: 'limit', quantity: 10, limitPrice: inst.price * 3, tif: 'day' }).ok).toBe(false);
  });

  test('short opening and covering through orders', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    const o = submitOrder(g, { instrument: inst.id, side: 'short', type: 'market', quantity: 300, tif: 'day' });
    expect(o.status).toBe('filled');
    expect(g.fund.positions[inst.id].qty).toBe(-300);
    expect(o.fillPrice!).toBeLessThan(inst.price); // sells hit the bid
    expect(validateOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: 10, tif: 'day' }).errors[0]).toMatch(/Cover/);
    const c = submitOrder(g, { instrument: inst.id, side: 'cover', type: 'market', quantity: 300, tif: 'day' });
    expect(c.status).toBe('filled');
    expect(g.fund.positions[inst.id]).toBeUndefined();
    assertLedger(g);
  });

  test('cancellation and day-order expiry', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    const a = submitOrder(g, { instrument: inst.id, side: 'buy', type: 'limit', quantity: 10, limitPrice: Math.round(inst.price * 0.6 * 100) / 100, tif: 'gtc' });
    const b = submitOrder(g, { instrument: inst.id, side: 'buy', type: 'limit', quantity: 10, limitPrice: Math.round(inst.price * 0.6 * 100) / 100, tif: 'day' });
    expect(cancelOrder(g, a.id)).toBe(true);
    expect(a.status).toBe('cancelled');
    expect(cancelOrder(g, a.id)).toBe(false);
    runToClose(g);
    expect(b.status).toBe('expired');
  });

  test('pre-trade risk enforcement blocks concentrated positions when enabled', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    const qty = Math.floor((summarize(g).nav / 100) * 0.3 / inst.price);
    const d = { instrument: inst.id, side: 'buy' as const, type: 'market' as const, quantity: qty, tif: 'day' as const };
    const soft = validateOrder(g, d);
    expect(soft.ok).toBe(true);
    expect(soft.warnings.join()).toMatch(/Position would be/);
    g.risk.enforcePreTrade = true;
    expect(validateOrder(g, d).ok).toBe(false);
  });

  test('orders persist across days: GTC limit survives the close', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    const o = submitOrder(g, { instrument: inst.id, side: 'buy', type: 'limit', quantity: 10, limitPrice: Math.round(inst.price * 0.55 * 100) / 100, tif: 'gtc' });
    runToClose(g);
    nextDay(g);
    expect(o.status).toBe('open');
  });

  test('transaction costs make round trips lose money at constant prices', () => {
    const g = fresh();
    openMarket(g);
    const inst = liquid(g);
    const nav0 = summarize(g).nav;
    submitOrder(g, { instrument: inst.id, side: 'buy', type: 'market', quantity: 5000, tif: 'day' });
    submitOrder(g, { instrument: inst.id, side: 'sell', type: 'market', quantity: 5000, tif: 'day' });
    const nav1 = summarize(g).nav;
    expect(nav1).toBeLessThan(nav0);
    const fills = g.fills.slice(-2);
    const spreadCost = Math.round((fills[0].price - fills[1].price) * 5000 * 100);
    expect(nav0 - nav1).toBeGreaterThanOrEqual(fills[0].commission + fills[1].commission + spreadCost - 2);
    void lastBar;
  });
});
