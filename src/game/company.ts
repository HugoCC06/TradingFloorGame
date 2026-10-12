/**
 * Management company ledger. Strictly separate from the fund: the only links are
 * fee transfers (fund → company), which are booked here explicitly.
 *
 * Fees are charged by cancelling the client's units at the current NAV per unit,
 * so the fund's NAV per unit (the time-weighted *gross* investment return) is not
 * distorted by fees, while each client's account value is net of fees.
 * Performance fees use a per-client high-water mark on NAV per unit.
 */
import { AUTOMATIONS, BALANCE, OFFICES, type AutomationId } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import { navCents, toCents } from './accounting';
import { notify, logKeyEvent } from './notify';
import type { CompanyTxn, GameState } from './types';
import { hasRole } from './staff';

export function companyTxn(state: GameState, kind: CompanyTxn['kind'], amount: number, memo: string) {
  const c = state.company;
  c.cash += amount;
  if (amount > 0 && (kind === 'mgmtFee' || kind === 'perfFee')) {
    c.totals.revenue += amount;
    if (kind === 'mgmtFee') c.totals.mgmtFees += amount;
    else c.totals.perfFees += amount;
  } else if (amount < 0 && kind !== 'credit') {
    c.totals.expenses += -amount;
  }
  const last = c.ledger[c.ledger.length - 1];
  // collapse repeated daily entries of the same kind to keep the ledger readable
  if (last && last.day === state.clock.day && last.kind === kind && (kind === 'mgmtFee' || kind === 'salary' || kind === 'rent' || kind === 'tech' || kind === 'automation' || kind === 'marketing' || kind === 'interest')) {
    last.amount += amount;
  } else {
    c.ledger.push({ day: state.clock.day, date: state.clock.date, kind, amount, memo });
    if (c.ledger.length > 600) c.ledger.splice(0, c.ledger.length - 600);
  }
}

export interface ExpenseBreakdown {
  salaries: number;
  rent: number;
  tech: number;
  marketing: number;
  automation: number;
  interest: number;
  total: number;
}

/** Annualised operating expenses (cents/yr). */
export function annualExpenses(state: GameState): ExpenseBreakdown {
  const d = DIFFICULTIES[state.setup.difficulty];
  const c = state.company;
  const salaries = state.staff.reduce((a, e) => a + e.salary, 0);
  const rent = toCents(OFFICES[c.officeTier].rentPerYear * d.expenseMult);
  const tech = toCents((BALANCE.company.techCostPerYear + BALANCE.company.perHeadOverhead * state.staff.length) * d.expenseMult);
  const marketing = c.marketingPerYear;
  let automation = 0;
  for (const [id, a] of Object.entries(c.automations)) if (a?.enabled) automation += toCents(AUTOMATIONS[id as AutomationId].perYear * d.expenseMult);
  const interest = Math.round(c.creditDrawn * BALANCE.company.creditLineRate);
  return { salaries, rent, tech, marketing, automation, interest, total: salaries + rent + tech + marketing + automation + interest };
}

/** Annualised management-fee run-rate (cents/yr) at the current NAV. */
export function feeRunRate(state: GameState): number {
  const navpu = navCents(state) / 100 / Math.max(state.fund.unitsOutstanding, 1e-9);
  let r = 0;
  for (const cl of state.clients) if (cl.status !== 'departed') r += cl.units * navpu * 100 * cl.mgmtFee;
  return Math.round(r);
}

export function runwayDays(state: GameState): number {
  const burn = annualExpenses(state).total / 252;
  const rev = feeRunRate(state) / 252;
  const net = rev - burn;
  if (net >= 0) return Infinity;
  return Math.max(0, (state.company.cash + Math.max(0, state.company.creditLimit - state.company.creditDrawn)) / -net);
}

/** Accrue management fees for the day (unit cancellation). */
export function chargeManagementFees(state: GameState, navpu: number): number {
  if (navpu <= 0) return 0;
  let total = 0;
  for (const cl of state.clients) {
    if (cl.units <= 0 || cl.mgmtFee <= 0) continue;
    const fee = Math.round(cl.units * navpu * 100 * (cl.mgmtFee / BALANCE.tradingDaysPerYear));
    if (fee <= 0) continue;
    const u = fee / 100 / navpu;
    cl.units -= u;
    state.fund.unitsOutstanding -= u;
    state.fund.cash -= fee;
    total += fee;
  }
  if (total > 0) {
    state.fund.totals.managementFees += total;
    companyTxn(state, 'mgmtFee', total, 'Management fees accrued');
  }
  return total;
}

/** Crystallise performance fees against each client's high-water mark. */
export function crystallisePerformanceFees(state: GameState, navpu: number): number {
  if (navpu <= 0) return 0;
  let total = 0;
  for (const cl of state.clients) {
    if (cl.units <= 0) continue;
    if (navpu > cl.hwm) {
      if (cl.perfFee > 0) {
        const fee = Math.round(cl.perfFee * (navpu - cl.hwm) * cl.units * 100);
        if (fee > 0) {
          const u = fee / 100 / navpu;
          cl.units -= u;
          state.fund.unitsOutstanding -= u;
          state.fund.cash -= fee;
          total += fee;
        }
      }
      cl.hwm = navpu;
    }
  }
  state.fund.lastCrystallisationDay = state.clock.day;
  if (total > 0) {
    state.fund.totals.performanceFees += total;
    companyTxn(state, 'perfFee', total, 'Performance fees crystallised');
    notify(state, 'success', 'Performance fees earned', `Crystallised ${usd(total)} of performance fees above clients' high-water marks.`, { link: { screen: 'business' }, sound: 'cash' });
  }
  return total;
}

/** Pay one day of operating expenses. */
export function payDailyExpenses(state: GameState): number {
  const e = annualExpenses(state);
  const days = BALANCE.tradingDaysPerYear;
  const parts: [CompanyTxn['kind'], number, string][] = [
    ['salary', e.salaries, 'Payroll'],
    ['rent', e.rent, `Rent — ${OFFICES[state.company.officeTier].name}`],
    ['tech', e.tech, 'Technology & overheads'],
    ['marketing', e.marketing, 'Marketing & business development'],
    ['automation', e.automation, 'Automation subscriptions'],
    ['interest', e.interest, 'Credit line interest'],
  ];
  let total = 0;
  for (const [kind, annual, memo] of parts) {
    const amt = Math.round(annual / days);
    if (amt > 0) {
      companyTxn(state, kind, -amt, memo);
      total += amt;
    }
  }
  return total;
}

export function updateCreditLimit(state: GameState) {
  const runRate = feeRunRate(state);
  state.company.creditLimit = Math.max(toCents(250_000), Math.round(runRate * BALANCE.company.creditLineMultiple));
}

export function drawCredit(state: GameState, amount: number): { ok: boolean; error?: string } {
  const c = state.company;
  const avail = c.creditLimit - c.creditDrawn;
  if (amount <= 0) return { ok: false, error: 'Enter a positive amount.' };
  if (amount > avail) return { ok: false, error: `Only ${usd(avail)} of credit is available.` };
  c.creditDrawn += amount;
  companyTxn(state, 'credit', amount, 'Credit line drawdown');
  return { ok: true };
}

export function repayCredit(state: GameState, amount: number): { ok: boolean; error?: string } {
  const c = state.company;
  const amt = Math.min(amount, c.creditDrawn);
  if (amt <= 0) return { ok: false, error: 'Nothing to repay.' };
  if (c.cash < amt) return { ok: false, error: 'Not enough company cash.' };
  c.creditDrawn -= amt;
  companyTxn(state, 'credit', -amt, 'Credit line repayment');
  return { ok: true };
}

/** Handle negative company cash: auto-draw the credit line, then count insolvency days. */
export function checkCompanySolvency(state: GameState) {
  const c = state.company;
  if (c.cash < 0) {
    const need = -c.cash;
    const avail = c.creditLimit - c.creditDrawn;
    if (avail > 0) {
      const draw = Math.min(avail, need);
      c.creditDrawn += draw;
      companyTxn(state, 'credit', draw, 'Automatic credit line draw to cover a shortfall');
      notify(state, 'warning', 'Credit line drawn', `The management company drew ${usd(draw)} on its credit line to cover expenses.`, { link: { screen: 'business' }, sound: 'alert' });
    }
  }
  if (c.cash < 0) {
    c.insolventDays++;
    const grace = DIFFICULTIES[state.setup.difficulty].insolvencyGrace;
    notify(state, 'danger', 'Management company insolvent', `The firm cannot pay its bills (${usd(c.cash)}). Cut costs or raise fee revenue: ${grace - c.insolventDays} trading days until bankruptcy.`, { link: { screen: 'business' }, sound: 'alert' });
  } else {
    c.insolventDays = 0;
  }
}

export function upgradeOffice(state: GameState): { ok: boolean; error?: string } {
  const c = state.company;
  const next = OFFICES[c.officeTier + 1];
  if (!next) return { ok: false, error: 'Already at the top tier.' };
  const cost = toCents(next.fitOut * DIFFICULTIES[state.setup.difficulty].expenseMult);
  if (c.cash < cost) return { ok: false, error: `Fit-out costs ${usd(cost)}; the company has ${usd(c.cash)}.` };
  companyTxn(state, 'upgrade', -cost, `Moved to ${next.name}`);
  c.officeTier++;
  state.reputation = Math.min(100, state.reputation + (next.reputation - OFFICES[c.officeTier - 1].reputation) * 0.5);
  notify(state, 'success', 'Office upgraded', `The firm has moved into a ${next.name}.`, { link: { screen: 'business' }, sound: 'cash' });
  logKeyEvent(state, `Moved into a ${next.name}`);
  return { ok: true };
}

export function downgradeOffice(state: GameState): { ok: boolean; error?: string } {
  const c = state.company;
  if (c.officeTier === 0) return { ok: false, error: 'Already in the cheapest space.' };
  const prev = OFFICES[c.officeTier - 1];
  if (state.staff.length > prev.capacity) return { ok: false, error: `${prev.name} only fits ${prev.capacity} staff.` };
  c.officeTier--;
  state.reputation = Math.max(0, state.reputation - 2);
  notify(state, 'info', 'Office downsized', `The firm moved to a ${prev.name} to save costs.`, { link: { screen: 'business' } });
  logKeyEvent(state, `Downsized to a ${prev.name}`);
  return { ok: true };
}

export function setAutomation(state: GameState, id: AutomationId, enabled: boolean): { ok: boolean; error?: string } {
  const c = state.company;
  const def = AUTOMATIONS[id];
  const cur = c.automations[id];
  if (enabled) {
    if (def.requiresPm && !hasRole(state, 'pm')) return { ok: false, error: `${def.name} requires a portfolio manager on staff.` };
    if (!cur) {
      const cost = toCents(def.setup * DIFFICULTIES[state.setup.difficulty].expenseMult);
      if (c.cash < cost) return { ok: false, error: `Set-up costs ${usd(cost)}.` };
      companyTxn(state, 'automation', -cost, `Installed ${def.name}`);
      c.automations[id] = { enabled: true, installedDay: state.clock.day };
    } else cur.enabled = true;
  } else if (cur) cur.enabled = false;
  return { ok: true };
}

export function automationOn(state: GameState, id: AutomationId): boolean {
  const a = state.company.automations[id];
  if (!a?.enabled) return false;
  if (AUTOMATIONS[id].requiresPm && !hasRole(state, 'pm')) return false;
  return true;
}

export function usd(cents: number): string {
  const neg = cents < 0;
  const v = Math.abs(cents) / 100;
  let s: string;
  if (v >= 1e9) s = `$${(v / 1e9).toFixed(2)}B`;
  else if (v >= 1e6) s = `$${(v / 1e6).toFixed(2)}M`;
  else if (v >= 1e4) s = `$${(v / 1e3).toFixed(1)}K`;
  else s = `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return neg ? `−${s}` : s;
}
