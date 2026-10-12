import { DIFFICULTIES } from '../../config/difficulty';
import { applyTrade, toCents } from '../accounting';
import { checkCompanySolvency } from '../company';
import { checkFailure, closeFundVoluntarily, windDownWarnings, WINDDOWN_DAYS } from '../failure';
import { nextDay, runToClose } from '../sim';
import { fresh, playDays } from './helpers';

describe('failure and wind-down rules', () => {
  test('a single bad day does not end the game', () => {
    const g = fresh({ seed: 201 });
    const inst = g.instruments.find((i) => i.kind === 'equity')!;
    applyTrade(g, inst.id, 'buy', Math.floor(g.fund.cash / 100 / inst.price * 0.5), inst.price, 0);
    inst.price *= 0.8; // −10% NAV day
    expect(checkFailure(g)).toBe(false);
    expect(g.status).toBe('active');
  });

  test('wiping out NAV fails the fund (margin)', () => {
    const g = fresh({ seed: 202 });
    const inst = g.instruments.find((i) => i.kind === 'equity')!;
    applyTrade(g, inst.id, 'buy', Math.floor(g.fund.cash / 100 / inst.price * 1.9), inst.price, 0);
    inst.price *= 0.4;
    expect(checkFailure(g)).toBe(true);
    expect(g.status).toBe('failed');
    expect(g.failure!.cause).toBe('margin');
  });

  test('a catastrophic drawdown collapses the fund', () => {
    const g = fresh({ seed: 203 });
    g.fund.peakNavPerUnit = 100 / (1 - DIFFICULTIES.normal.collapseDrawdown - 0.01);
    expect(checkFailure(g)).toBe(true);
    expect(g.failure!.cause).toBe('drawdown');
  });

  test('company insolvency is recoverable within the grace period, then bankrupts', () => {
    const g = fresh({ seed: 204 });
    g.company.creditLimit = 0;
    g.company.cash = -toCents(50_000);
    checkCompanySolvency(g);
    expect(g.company.insolventDays).toBe(1);
    expect(windDownWarnings(g)[0].cause).toBe('insolvency');
    // recover
    g.company.cash = toCents(10_000);
    checkCompanySolvency(g);
    expect(g.company.insolventDays).toBe(0);
    g.company.cash = -toCents(50_000);
    for (let i = 0; i < DIFFICULTIES.normal.insolvencyGrace; i++) checkCompanySolvency(g);
    expect(checkFailure(g)).toBe(true);
    expect(g.failure!.cause).toBe('insolvency');
  });

  test('a fund below the minimum size gets a countdown before wind-down', () => {
    const g = fresh({ seed: 205, preset: 'bootstrapped' });
    g.fund.cash = toCents(500_000);
    g.fund.unitsOutstanding = 5000; // keep NAV per unit at 100 (no drawdown)
    for (let i = 0; i < WINDDOWN_DAYS - 1; i++) expect(checkFailure(g)).toBe(false);
    expect(windDownWarnings(g).some((w) => w.cause === 'tooSmall' && w.daysLeft === 1)).toBe(true);
    expect(checkFailure(g)).toBe(true);
    expect(g.failure!.cause).toBe('tooSmall');
  });

  test('voluntary closure ends the run and blocks further trading/time', () => {
    const g = fresh({ seed: 206 });
    playDays(g, 1);
    closeFundVoluntarily(g);
    expect(g.status).toBe('closed');
    expect(nextDay(g)).toBe(false);
    expect(runToClose(g)).toBe('inactive');
  });
});
