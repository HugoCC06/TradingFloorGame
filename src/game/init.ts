import { BALANCE } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import { PRESETS } from '../config/presets';
import { SECTORS } from '../config/sectors';
import { toCents } from './accounting';
import { firstTradingDate, formatISO, nextTradingDate, parseDate, prevTradingDate } from './calendar';
import { makeClient } from './clients';
import { initialMacro } from './macro';
import { closeMarketDay, createHistory, generatePreHistory, openDailyBars, stepMarketMinute, applyOvernightGap, HISTORY_CAPS } from './market';
import { notify } from './notify';
import { Rng, seedState } from './rng';
import { createRivals } from './rivals';
import { defaultLimits } from './risk';
import { generateCandidate, refreshCandidates } from './staff';
import type { ClientType, Employee, GameSetup, GameState } from './types';
import { generateUniverse } from './universe';
import { overnight } from './sim';
import { maybeRandomEvent } from './events/engine';

export const SAVE_SCHEMA = 1;

export const CLIENT_MIX: Record<string, ClientType[]> = {
  bootstrapped: ['hnw', 'hnw', 'family'],
  founder: ['hnw', 'hnw', 'family', 'family', 'corporate'],
  spinout: ['hnw', 'hnw', 'family', 'family', 'family', 'institution', 'institution', 'corporate'],
};

/** Build a complete new game from setup choices. Deterministic for a given seed + setup. */
export function newGame(setup: GameSetup): GameState {
  const seed = setup.seed >>> 0;
  const rng = { market: seedState(seed, 1), events: seedState(seed, 2), clients: seedState(seed, 3), misc: seedState(seed, 4) };
  const misc = new Rng(rng.misc);
  const preset = PRESETS[setup.preset];
  const diff = DIFFICULTIES[setup.difficulty];

  // calendar: start date varies with the seed
  const base = parseDate('2031-01-06');
  base.setUTCDate(base.getUTCDate() + (seed % 300));
  const warmupStart = firstTradingDate(formatISO(base));
  const preDates: string[] = [];
  let d = warmupStart;
  for (let i = 0; i < BALANCE.preHistoryDays; i++) {
    d = prevTradingDate(d);
    preDates.unshift(d);
  }
  const startDay = BALANCE.warmupDays;
  const universe = generateUniverse(new Rng(rng.market), startDay);
  const n = universe.instruments.length;

  const state: GameState = {
    schema: SAVE_SCHEMA,
    id: `g${seed.toString(36)}${Date.now().toString(36)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    setup: { ...setup, seed },
    rng,
    clock: { day: 0, date: warmupStart, minute: 0, phase: 'pre' },
    startDay,
    macro: initialMacro(new Rng(rng.events), startDay),
    sectors: Object.fromEntries(SECTORS.map((s) => [s.id, { sentiment: misc.normal() * 0.2, shockDrift: 0 }])),
    instruments: universe.instruments,
    history: createHistory(n),
    benchmarkIdx: universe.benchmarkIdx,
    news: [],
    scheduled: [],
    impacts: [],
    fund: {
      cash: 0, positions: {}, unitsOutstanding: 0, lastCrystallisationDay: startDay,
      totals: { realized: 0, commissions: 0, slippage: 0, borrowFees: 0, financing: 0, interestEarned: 0, managementFees: 0, performanceFees: 0, subscriptions: 0, redemptions: 0, dividends: 0 },
      prevNavPerUnit: 100, peakNavPerUnit: 100, peakNav: 0, instrumentPnl: {},
    },
    orders: [],
    fills: [],
    company: {
      cash: toCents(preset.companyCash * (diff.id === 'easy' ? 1.25 : 1)), officeTier: preset.officeTier, creditDrawn: 0, creditLimit: toCents(250_000),
      marketingPerYear: 0, insolventDays: 0, ledger: [], totals: { revenue: 0, mgmtFees: 0, perfFees: 0, expenses: 0 },
      automations: {}, stopProtectionPct: 0.08, rebalanceBand: 0.02,
    },
    clients: [],
    prospects: [],
    flows: [],
    rivals: [],
    staff: [],
    candidates: [],
    risk: { limits: defaultLimits({ setup }), enforcePreTrade: false, breaches: [], breachStreak: 0, totalBreachDays: 0, cleanDays: 0, marginCalls: 0, lastMarginCallDay: -999 },
    targets: {},
    watchlist: [],
    daily: [],
    lastReport: null,
    notifications: [],
    decisions: [],
    reputation: preset.reputation,
    stats: { startNav: 0, peakNav: 0, peakAum: 0, maxDrawdown: 0, bestDay: 0, worstDay: 0, trades: 0, shorts: 0, profitableDays: 0, daysPlayed: 0, wonClients: 0, lostClients: 0, hires: 0, recoveredFromDrawdown: false, maxDrawdownSinceHigh: 0, keyEvents: [] },
    achievements: [],
    status: 'active',
    failure: null,
    counters: { order: 0, news: 0, fill: 0, misc: 0 },
    intradayNav: [],
    navAtOpen: 0,
    lastLetterDay: -999,
    tutorialStep: setup.tutorial ? 0 : -1,
    watch: { smallDays: 0, lowConfidenceDays: 0 },
  };

  // ~1 year of daily history, then a few warm-up sessions through the full minute engine
  generatePreHistory(state, BALANCE.preHistoryDays, preDates);
  for (let w = 0; w < BALANCE.warmupDays; w++) {
    state.clock.day = w;
    state.clock.phase = 'open';
    if (w > 0) {
      state.clock.date = nextTradingDate(state.clock.date);
      applyOvernightGap(state);
    }
    openDailyBars(state);
    for (let m = 0; m < 390; m++) {
      state.clock.minute = m;
      if (w === BALANCE.warmupDays - 1) maybeRandomEvent(state);
      stepMarketMinute(state);
    }
    state.clock.minute = 390;
    closeMarketDay(state);
  }
  void HISTORY_CAPS;

  // fund & clients
  const navpu = 100;
  const founder = makeClient(state, misc, 'founder', toCents(preset.founderSeed), navpu);
  state.clients.push(founder);
  const mix = CLIENT_MIX[preset.id];
  const weights = mix.map(() => 0.5 + misc.next());
  const wsum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < mix.length; i++) {
    const amt = toCents(Math.round((preset.clientCapital * weights[i]) / wsum / 1000) * 1000);
    const c = makeClient(state, misc, mix[i], amt, navpu, preset.expectationMult * diff.clientExpectation);
    c.history = [{ day: startDay, date: state.clock.date, text: `Seed investor: ${Math.round(amt / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}` }];
    state.clients.push(c);
  }
  let totalUnits = 0, totalCash = 0;
  for (const c of state.clients) { totalUnits += c.units; totalCash += c.netContributed; c.initialDay = startDay; }
  state.fund.cash = totalCash;
  state.fund.unitsOutstanding = totalUnits;
  state.fund.peakNav = totalCash;
  state.navAtOpen = totalCash;
  state.stats.peakNav = totalCash;
  state.stats.startNav = totalCash;
  state.stats.peakAum = totalCash;

  // staff
  for (const sp of preset.startingStaff) {
    const c = generateCandidate(state, misc, sp.role, sp.skill);
    const { hiringCost: _h, expiresDay: _e, ...rest } = c;
    const e: Employee = { ...rest, hiredDay: startDay };
    state.staff.push(e);
  }
  state.rivals = createRivals(state, misc);
  for (const r of state.rivals) r.lastRebalanceDay = startDay;

  // watchlist: benchmark, commodities and a handful of large caps
  const eqs = state.instruments.filter((i) => i.kind === 'equity').sort((a, b) => b.price * b.fundamentals!.sharesOut - a.price * a.fundamentals!.sharesOut);
  state.watchlist = ['TFX', ...eqs.slice(0, 9).map((i) => i.id), 'GOLD', 'CRUD'];

  // first playable day: overnight news, pre-market releases and opening gap
  state.clock.day = startDay - 1;
  state.clock.phase = 'closed';
  state.clock.day = startDay;
  state.clock.date = nextTradingDate(state.clock.date);
  state.clock.minute = 0;
  state.clock.phase = 'pre';
  overnight(state, true);
  refreshCandidates(state, true);
  state.notifications = [];
  for (const n of state.news) n.read = false;
  notify(state, 'info', `Welcome to ${setup.fundName}`, 'Review the overnight news, plan your trades, then press Play (Space) to open the market.', { toast: true });
  return state;
}
