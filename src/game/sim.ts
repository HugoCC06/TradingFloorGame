/**
 * Simulation orchestration: one function per lifecycle step. The real-time
 * controller only ever calls stepMinute() / nextDay(), so the simulation is
 * fully deterministic given the save state and player actions.
 *
 * Day lifecycle:  pre (overnight news reviewed) → open (09:30–16:00, 390 minutes)
 *                 → closed (EOD processing + report) → nextDay() → pre ...
 */
import { BALANCE, OFFICES } from '../config/balance';
import { checkAchievements } from './achievements';
import { navCents, shortCollateral, summarize } from './accounting';
import { nextTradingDate, SESSION_MINUTES } from './calendar';
import { clientDecisions, clientFlowDecisions, generateProspects, resolvePitches, settleFlows, updateClients } from './clients';
import { automationOn, chargeManagementFees, checkCompanySolvency, crystallisePerformanceFees, payDailyExpenses, updateCreditLimit } from './company';
import { expireDecisions } from './decisions';
import { maybeRandomEvent, processEarnings, processMacroReleases, processScheduled, randomEvent, upcomingEvents } from './events/engine';
import { checkFailure } from './failure';
import { evolveMacro } from './macro';
import { applyOvernightGap, closeMarketDay, openDailyBars, stepMarketMinute } from './market';
import { notify, logKeyEvent } from './notify';
import { enforceMargin, expireDayOrders, processOrders } from './orders';
import { currentDrawdown, trailingReturn } from './performance';
import { executeRebalance } from './rebalance';
import { endOfDayRisk, refreshRisk } from './risk';
import { updateRivals } from './rivals';
import { Rng } from './rng';
import { staffDaily } from './staff';
import type { DailyRecord, EodReport, GameState } from './types';

export type StepResult = 'ok' | 'closed' | 'inactive';

/** Transition from pre-market to the open (09:30). */
export function openSession(state: GameState) {
  if (state.clock.phase !== 'pre') return;
  state.clock.phase = 'open';
  state.clock.minute = 0;
  state.navAtOpen = state.daily.length ? state.daily[state.daily.length - 1].nav : navCents(state);
  state.intradayNav = [{ minute: 0, nav: navCents(state) }];
  notify(state, 'info', 'Market open', 'The exchange is open for trading.', { sound: 'open', toast: false });
  if (automationOn(state, 'autoRebalance') && Object.keys(state.targets).length) {
    const r = executeRebalance(state, 'auto-rebalance', state.company.rebalanceBand);
    if (r.submitted || r.rejected.length) notify(state, 'info', 'Auto-rebalance ran', `${r.submitted} orders placed${r.rejected.length ? `, ${r.rejected.length} rejected` : ''}.`, { link: { screen: 'portfolio' } });
  }
}

/** Advance the simulation by one minute. */
export function stepMinute(state: GameState): StepResult {
  if (state.status !== 'active') return 'inactive';
  if (state.clock.phase === 'closed') return 'closed';
  if (state.clock.phase === 'pre') openSession(state);
  const m = state.clock.minute;
  processScheduled(state, m);
  processMacroReleases(state, m);
  maybeRandomEvent(state);
  stepMarketMinute(state);
  processOrders(state);
  const mg = enforceMargin(state);
  if (mg === 'wiped') {
    checkFailure(state);
    if (state.status !== 'active') return 'inactive';
  }
  if (m % 5 === 4 || mg !== 'ok') {
    refreshRisk(state);
    state.intradayNav.push({ minute: m + 1, nav: navCents(state) });
  }
  state.clock.minute = m + 1;
  if (state.clock.minute >= SESSION_MINUTES) {
    closeDay(state);
    return 'closed';
  }
  return 'ok';
}

/** Run until the close (used by "skip to close" and tests). */
export function runToClose(state: GameState, maxMinutes = SESSION_MINUTES + 1) {
  for (let i = 0; i < maxMinutes; i++) {
    const r = stepMinute(state);
    if (r !== 'ok') return r;
  }
  return 'ok';
}

/** Daily fund carrying costs: borrow fees on shorts, margin financing, interest on free cash. */
function chargeCarry(state: GameState) {
  const f = state.fund;
  const s = summarize(state);
  const days = BALANCE.tradingDaysPerYear;
  let borrow = 0;
  for (const p of s.positions) if (p.qty < 0) borrow += Math.round((p.exposure * p.inst.borrowFee) / days);
  if (borrow > 0) {
    f.cash -= borrow;
    f.totals.borrowFees += borrow;
  }
  const free = f.cash - shortCollateral(state);
  const rate = state.macro.policyRate / 100;
  if (free < 0) {
    const fin = Math.round((-free * (rate + BALANCE.trading.financingSpread)) / days);
    f.cash -= fin;
    f.totals.financing += fin;
  } else if (free > 0) {
    const int = Math.round((free * rate * BALANCE.trading.cashInterestShare) / days);
    f.cash += int;
    f.totals.interestEarned += int;
  }
}

function updateReputation(state: GameState, nav: number) {
  const r60 = trailingReturn(state, 60);
  const bench = state.daily.length ? state.daily.slice(-60).reduce((a, d) => a * (1 + d.benchmarkReturn), 1) - 1 : 0;
  const office = OFFICES[state.company.officeTier];
  const sizeScore = Math.min(25, Math.max(0, Math.log10(Math.max(nav / 100, 1) / 1e6) * 10));
  const target = 30 + office.reputation + sizeScore;
  let rep = state.reputation;
  rep += Math.max(-0.5, Math.min(0.5, (r60 - bench) * 3));
  rep += (target - rep) * 0.01;
  state.reputation = Math.max(0, Math.min(100, rep));
}

/** All after-the-bell processing. */
export function closeDay(state: GameState) {
  state.clock.phase = 'closed';
  state.clock.minute = SESSION_MINUTES;
  processEarnings(state, SESSION_MINUTES);
  processScheduled(state, SESSION_MINUTES);
  expireDayOrders(state);
  chargeCarry(state);

  const f = state.fund;
  const navBeforeFees = navCents(state);
  const navpuClose = f.unitsOutstanding > 0 ? navBeforeFees / 100 / f.unitsOutstanding : 0;
  const mgmt = chargeManagementFees(state, navpuClose);
  let perf = 0;
  if (state.clock.day - f.lastCrystallisationDay >= BALANCE.fees.performancePeriod) perf = crystallisePerformanceFees(state, navpuClose);
  const flows = settleFlows(state);
  const companyCashBefore = state.company.cash;
  const expenses = payDailyExpenses(state);
  updateCreditLimit(state);
  checkCompanySolvency(state);

  const s = summarize(state);
  const navpu = s.navPerUnit;
  const prev = f.prevNavPerUnit || 100;
  const dailyReturn = navpu / prev - 1;
  const bench = state.instruments[state.benchmarkIdx];
  const benchmarkReturn = bench.price / bench.prevClose - 1;
  f.peakNavPerUnit = Math.max(f.peakNavPerUnit, navpu);
  f.peakNav = Math.max(f.peakNav, s.nav);
  const dd = currentDrawdown(state);
  const st = state.stats;
  st.daysPlayed++;
  st.peakNav = Math.max(st.peakNav, s.nav);
  st.peakAum = Math.max(st.peakAum, s.nav);
  st.maxDrawdown = Math.max(st.maxDrawdown, dd);
  st.bestDay = Math.max(st.bestDay, dailyReturn);
  st.worstDay = Math.min(st.worstDay, dailyReturn);
  if (dailyReturn > 0) st.profitableDays++;
  st.maxDrawdownSinceHigh = Math.max(st.maxDrawdownSinceHigh, dd);
  if (dd === 0 && st.maxDrawdownSinceHigh >= 0.1) {
    st.recoveredFromDrawdown = true;
    logKeyEvent(state, `Recovered from a ${(st.maxDrawdownSinceHigh * 100).toFixed(0)}% drawdown to a new high`);
    st.maxDrawdownSinceHigh = 0;
  } else if (dd === 0) st.maxDrawdownSinceHigh = 0;
  if (dailyReturn < -0.05) logKeyEvent(state, `Lost ${(dailyReturn * -100).toFixed(1)}% in a single day`);

  const prevNet = state.daily.length ? state.daily[state.daily.length - 1].netIndex : 100;
  const feeDrag = navBeforeFees > 0 ? (mgmt + perf) / navBeforeFees : 0;
  const rec: DailyRecord = {
    day: state.clock.day, date: state.clock.date, nav: s.nav, navPerUnit: navpu, benchmark: bench.price, dailyReturn, benchmarkReturn,
    drawdown: dd, grossExposure: s.gross, netExposure: s.net, subscriptions: flows.subs, redemptions: flows.reds, mgmtFees: mgmt, perfFees: perf,
    companyCash: state.company.cash, companyRevenue: mgmt + perf, companyExpenses: expenses, clients: state.clients.filter((c) => c.status !== 'departed').length,
    // investment P&L: change in NAV excluding capital flows and fee transfers to the management company
    reputation: state.reputation, pnl: s.nav - (state.daily.length ? state.daily[state.daily.length - 1].nav : state.navAtOpen) - flows.subs + flows.reds + mgmt + perf,
    netIndex: prevNet * (1 + dailyReturn - feeDrag),
  };
  void companyCashBefore;
  state.daily.push(rec);
  f.prevNavPerUnit = navpu;

  const breaches = endOfDayRisk(state);
  updateClients(state, breaches);
  clientFlowDecisions(state);
  resolvePitches(state);
  generateProspects(state);
  clientDecisions(state);
  const rivalNotes = updateRivals(state, dailyReturn);
  staffDaily(state);
  updateReputation(state, s.nav);
  const regimeChange = evolveMacro(state, benchmarkReturn);
  if (regimeChange) {
    const to = state.macro.regime;
    notify(state, to === 'crisis' ? 'danger' : 'info', 'Market regime shift', { bull: 'Conditions have turned bullish.', neutral: 'Markets have settled into a range.', bear: 'A bear market is taking hold.', crisis: 'A full-blown financial crisis is under way.' }[to], { sound: to === 'crisis' || to === 'bear' ? 'alert' : undefined });
    logKeyEvent(state, `Market regime shifted to ${to}`);
  }
  closeMarketDay(state);
  state.lastReport = buildReport(state, rec, rivalNotes);
  checkAchievements(state, s.nav);
  checkFailure(state);
  notify(state, 'info', 'Market closed', `Day ${state.daily.length} complete: ${dailyReturn >= 0 ? '+' : ''}${(dailyReturn * 100).toFixed(2)}% vs benchmark ${benchmarkReturn >= 0 ? '+' : ''}${(benchmarkReturn * 100).toFixed(2)}%.`, { sound: 'close', toast: false, link: { screen: 'report' } });
}

function buildReport(state: GameState, rec: DailyRecord, rivalNotes: { id: string; ret: number }[]): EodReport {
  const s = summarize(state);
  const moves = s.positions.map((p) => ({ id: p.id, pnl: p.dayPnl, change: p.inst.price / p.inst.prevClose - 1 }));
  const fillsToday = state.fills.filter((f) => f.day === state.clock.day);
  // include realised P&L on positions closed today
  for (const fl of fillsToday) if (!moves.some((m) => m.id === fl.instrument) && fl.realizedPnl) moves.push({ id: fl.instrument, pnl: fl.realizedPnl, change: 0 });
  const winners = moves.filter((m) => m.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  const losers = moves.filter((m) => m.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 5);
  const movers = state.instruments.filter((i) => i.kind === 'equity').map((i) => ({ id: i.id, change: i.price / i.prevClose - 1 })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6);
  const news = state.news.filter((n) => n.day === state.clock.day && n.severity >= 2).slice(-8).map((n) => n.id);
  const riskNotes = state.risk.breaches.map((b) => `${b.severity.toUpperCase()}: ${b.title}`);
  const clientNotes: string[] = [];
  if (rec.subscriptions) clientNotes.push(`Subscriptions settled: $${Math.round(rec.subscriptions / 100).toLocaleString()}`);
  if (rec.redemptions) clientNotes.push(`Redemptions paid: $${Math.round(rec.redemptions / 100).toLocaleString()}`);
  for (const c of state.clients) {
    const last = c.history[c.history.length - 1];
    if (last && last.day === state.clock.day && !/settled|paid/.test(last.text)) clientNotes.push(`${c.name}: ${last.text}`);
  }
  const atRisk = state.clients.filter((c) => c.status === 'active' && c.type !== 'founder' && c.confidence < 40);
  if (atRisk.length) clientNotes.push(`${atRisk.length} client${atRisk.length > 1 ? 's' : ''} at risk of redeeming (confidence < 40)`);
  const companyNotes = [
    `Fee revenue today $${Math.round(rec.companyRevenue / 100).toLocaleString()} · expenses $${Math.round(rec.companyExpenses / 100).toLocaleString()}`,
    `Company cash $${Math.round(state.company.cash / 100).toLocaleString()}`,
  ];
  const reviewNotes: string[] = [];
  if (automationOn(state, 'dailyReview')) {
    for (const p of s.positions) {
      if (p.unrealizedPct < -0.15) reviewNotes.push(`${p.id}: unrealised loss of ${(p.unrealizedPct * 100).toFixed(0)}% — revisit the thesis.`);
      if (Math.abs(p.weight) > state.risk.limits.maxPositionWeight * 0.8) reviewNotes.push(`${p.id} is ${(Math.abs(p.weight) * 100).toFixed(0)}% of NAV.`);
      const f = p.inst.fundamentals;
      if (f && f.nextEarningsDay - state.clock.day <= 3) reviewNotes.push(`${p.id} reports earnings in ${f.nextEarningsDay - state.clock.day} day(s).`);
    }
    if (!reviewNotes.length) reviewNotes.push('No issues flagged by the review desk.');
  }
  return {
    day: state.clock.day, date: state.clock.date,
    navStart: state.navAtOpen, navEnd: rec.nav, pnl: rec.pnl, dailyReturn: rec.dailyReturn, benchmarkReturn: rec.benchmarkReturn,
    winners, losers, marketMovers: movers, news, fills: fillsToday.map((f) => f.id), riskNotes, clientNotes, companyNotes,
    rivalNotes, upcoming: upcomingEvents(state, 2).slice(0, 8).map((e) => `${e.day === state.clock.day + 1 ? 'Tomorrow' : `Day +${e.day - state.clock.day}`}: ${e.label}${e.detail ? ` — ${e.detail}` : ''}`),
    reviewNotes,
  };
}

/** Advance from the closed state to the next session's pre-market. */
export function nextDay(state: GameState): boolean {
  if (state.status !== 'active' || state.clock.phase !== 'closed') return false;
  state.clock.day++;
  state.clock.date = nextTradingDate(state.clock.date);
  state.clock.minute = 0;
  state.clock.phase = 'pre';
  overnight(state, true);
  expireDecisions(state);
  state.intradayNav = [];
  state.navAtOpen = state.daily.length ? state.daily[state.daily.length - 1].nav : navCents(state);
  return true;
}

/** Overnight news, scheduled pre-market releases and the opening gap. */
export function overnight(state: GameState, randomNews: boolean) {
  processEarnings(state, -1);
  processMacroReleases(state, -1);
  processScheduled(state, -1);
  if (randomNews) {
    const rng = new Rng(state.rng.events);
    const n = rng.int(0, 2);
    for (let i = 0; i < n; i++) randomEvent(state);
  }
  applyOvernightGap(state);
  openDailyBars(state);
}
