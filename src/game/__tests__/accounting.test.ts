import { applyTrade, navCents, shortCollateral, summarize, toCents } from '../accounting';
import { scheduleFlow, settleFlows } from '../clients';
import { chargeManagementFees, crystallisePerformanceFees, payDailyExpenses } from '../company';
import { enforceMargin, submitOrder } from '../orders';
import { assertLedger, equity, fresh, openMarket } from './helpers';

describe('fund accounting invariants', () => {
  test('buying charges notional plus commission exactly once and NAV reconciles', () => {
    const g = fresh();
    const inst = equity(g);
    const cash0 = g.fund.cash;
    const nav0 = navCents(g);
    applyTrade(g, inst.id, 'buy', 100, inst.price, 500);
    expect(g.fund.cash).toBe(cash0 - toCents(100 * inst.price) - 500);
    expect(g.fund.totals.commissions).toBe(500);
    // at the trade price, NAV only falls by the commission (± rounding of one cent)
    expect(Math.abs(navCents(g) - (nav0 - 500))).toBeLessThanOrEqual(1);
    assertLedger(g);
  });

  test('long positions gain and lose with price', () => {
    const g = fresh();
    const inst = equity(g);
    applyTrade(g, inst.id, 'buy', 1000, inst.price, 0);
    const nav0 = navCents(g);
    inst.price *= 1.1;
    const s = summarize(g);
    expect(navCents(g) - nav0).toBe(toCents(1000 * inst.price) - toCents(1000 * (inst.price / 1.1)));
    expect(s.positions[0].unrealized).toBeGreaterThan(0);
    inst.price = (inst.price / 1.1) * 0.9;
    expect(summarize(g).positions[0].unrealized).toBeLessThan(0);
  });

  test('short positions lose when price rises and gain when it falls; proceeds are restricted collateral', () => {
    const g = fresh();
    const inst = equity(g);
    const p0 = inst.price;
    const cash0 = g.fund.cash;
    applyTrade(g, inst.id, 'short', 500, p0, 0);
    expect(g.fund.cash).toBe(cash0 + toCents(500 * p0));
    expect(shortCollateral(g)).toBe(toCents(500 * p0));
    expect(summarize(g).freeCash).toBe(cash0); // proceeds are not free cash
    const nav0 = navCents(g);
    inst.price = p0 * 1.2;
    expect(navCents(g)).toBeLessThan(nav0);
    inst.price = p0 * 0.8;
    expect(navCents(g)).toBeGreaterThan(nav0);
    const realized = applyTrade(g, inst.id, 'cover', 500, inst.price, 0);
    expect(realized).toBe(toCents((p0 - inst.price) * 500));
    expect(shortCollateral(g)).toBe(0);
    expect(g.fund.positions[inst.id]).toBeUndefined();
    assertLedger(g);
  });

  test('realised and unrealised P&L are not double-counted', () => {
    const g = fresh();
    const inst = equity(g);
    const nav0 = navCents(g);
    applyTrade(g, inst.id, 'buy', 1000, 50, 100);
    inst.price = 60;
    applyTrade(g, inst.id, 'sell', 400, 60, 100);
    inst.price = 55;
    const s = summarize(g);
    const total = g.fund.totals.realized + s.unrealized - g.fund.totals.commissions;
    expect(total).toBe(navCents(g) - nav0);
    expect(g.fund.totals.realized).toBe(toCents(400 * 10));
    expect(s.positions[0].unrealized).toBe(toCents(600 * 5));
  });

  test('position weights are consistent with NAV and gross exposure', () => {
    const g = fresh();
    const a = equity(g), b = equity(g, (i) => i.id !== a.id);
    applyTrade(g, a.id, 'buy', 2000, a.price, 0);
    applyTrade(g, b.id, 'short', 1500, b.price, 0);
    const s = summarize(g);
    const grossFromWeights = s.positions.reduce((x, p) => x + Math.abs(p.weight), 0) * s.nav;
    expect(Math.abs(grossFromWeights - s.gross)).toBeLessThan(2);
    expect(s.nav).toBe(s.cash + s.longValue - s.shortValue);
  });

  test('investor subscriptions and redemptions do not count as investment returns', () => {
    const g = fresh();
    const inst = equity(g);
    applyTrade(g, inst.id, 'buy', 3000, inst.price, 0);
    const navpu0 = summarize(g).navPerUnit;
    const client = g.clients.find((c) => c.type !== 'founder')!;
    const units0 = g.fund.unitsOutstanding;
    scheduleFlow(g, client.id, 'subscription', toCents(5_000_000), g.clock.day);
    settleFlows(g);
    expect(summarize(g).navPerUnit).toBeCloseTo(navpu0, 8);
    expect(g.fund.unitsOutstanding).toBeGreaterThan(units0);
    const cashBefore = g.fund.cash;
    scheduleFlow(g, client.id, 'redemption', client.units / 2, g.clock.day);
    settleFlows(g);
    expect(summarize(g).navPerUnit).toBeCloseTo(navpu0, 6);
    expect(g.fund.cash).toBeLessThan(cashBefore);
    expect(g.fund.totals.subscriptions).toBe(toCents(5_000_000));
    assertLedger(g);
  });

  test('redemptions larger than free cash sell holdings rather than creating hidden debt', () => {
    const g = fresh();
    const inst = equity(g, (i) => i.adv * i.price > 5e8);
    const s0 = summarize(g);
    const qty = Math.floor((s0.nav * 0.97) / 100 / inst.price);
    applyTrade(g, inst.id, 'buy', qty, inst.price, 0);
    expect(summarize(g).freeCash).toBeLessThan(s0.nav * 0.05);
    const big = g.clients.filter((c) => c.type !== 'founder').sort((a, b) => b.units - a.units)[0];
    const units = big.units;
    g.clock.phase = 'closed';
    scheduleFlow(g, big.id, 'redemption', units, g.clock.day);
    settleFlows(g);
    expect(g.fund.positions[inst.id].qty).toBeLessThan(qty);
    expect(g.fills.some((f) => f.origin === 'redemption')).toBe(true);
    expect(big.status).toBe('departed');
    assertLedger(g);
  });

  test('management fees move cash from fund to company without changing NAV per unit', () => {
    const g = fresh();
    const navpu0 = summarize(g).navPerUnit;
    const fund0 = g.fund.cash, co0 = g.company.cash;
    const fee = chargeManagementFees(g, navpu0);
    expect(fee).toBeGreaterThan(0);
    expect(g.fund.cash).toBe(fund0 - fee);
    expect(g.company.cash).toBe(co0 + fee);
    expect(summarize(g).navPerUnit).toBeCloseTo(navpu0, 8);
    // the founder pays no fees
    const founder = g.clients.find((c) => c.type === 'founder')!;
    expect(founder.units).toBeCloseTo(toCents(1_000_000) / 100 / 100, 6);
  });

  test('company expenses never touch the fund ledger', () => {
    const g = fresh();
    const nav0 = navCents(g), co0 = g.company.cash;
    const paid = payDailyExpenses(g);
    expect(paid).toBeGreaterThan(0);
    expect(navCents(g)).toBe(nav0);
    expect(g.company.cash).toBe(co0 - paid);
  });

  test('performance fees respect each client\'s high-water mark', () => {
    const g = fresh();
    const c = g.clients.find((x) => x.type !== 'founder')!;
    // simulate +10% NAV per unit (all clients start at a high-water mark of 100)
    const expected = g.clients.filter((x) => x.perfFee > 0).reduce((a, x) => a + Math.round(x.perfFee * 10 * x.units * 100), 0);
    const fee1 = crystallisePerformanceFees(g, 110);
    expect(fee1).toBeGreaterThan(0);
    expect(fee1).toBe(expected);
    expect(c.hwm).toBe(110);
    // no new high: no fee
    expect(crystallisePerformanceFees(g, 108)).toBe(0);
    // recovering back to the previous high: still no fee
    expect(crystallisePerformanceFees(g, 110)).toBe(0);
    // only gains above the mark are charged
    const before = c.units;
    crystallisePerformanceFees(g, 111);
    const charged = (before - c.units) * 111 * 100;
    expect(charged).toBeCloseTo(c.perfFee * 1 * before * 100, -1);
  });

  test('margin violations force liquidation down to a safe level', () => {
    const g = fresh();
    openMarket(g);
    const inst = equity(g, (i) => i.adv * i.price > 2e9);
    const s0 = summarize(g);
    const qty = Math.floor((s0.nav * 1.8) / 100 / inst.price);
    applyTrade(g, inst.id, 'buy', qty, inst.price, 0);
    expect(summarize(g).grossLeverage).toBeGreaterThan(1.7);
    inst.price *= 0.62; // crash
    const r = enforceMargin(g);
    expect(r).toBe('liquidated');
    const s = summarize(g);
    expect(s.marginUtilisation).toBeLessThanOrEqual(0.85);
    expect(g.risk.marginCalls).toBe(1);
    expect(g.fills.some((f) => f.origin === 'forced-liquidation')).toBe(true);
    assertLedger(g);
  });

  test('order commissions in fills sum to the commission total', () => {
    const g = fresh();
    openMarket(g);
    const a = equity(g);
    submitOrder(g, { instrument: a.id, side: 'buy', type: 'market', quantity: 500, tif: 'day' });
    submitOrder(g, { instrument: a.id, side: 'sell', type: 'market', quantity: 200, tif: 'day' });
    const sum = g.fills.reduce((x, f) => x + f.commission, 0);
    expect(sum).toBe(g.fund.totals.commissions);
    expect(g.fills).toHaveLength(2);
  });
});
