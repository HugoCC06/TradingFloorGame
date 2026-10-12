/**
 * Failure rules. A single bad day never ends a run: immediate failure happens
 * only when NAV is wiped out. Other failures are recoverable wind-down
 * conditions with visible countdowns (company insolvency, a fund too small to
 * operate, collapsed investor confidence) or a catastrophic drawdown.
 */
import { BALANCE } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import { summarize, toCents } from './accounting';
import { usd } from './company';
import { logKeyEvent, notify } from './notify';
import { currentDrawdown } from './performance';
import type { FailureReport, GameState } from './types';

export const WINDDOWN_DAYS = 10;

export interface WindDownWarning {
  cause: FailureReport['cause'];
  title: string;
  detail: string;
  daysLeft: number;
}

export function windDownWarnings(state: GameState): WindDownWarning[] {
  const out: WindDownWarning[] = [];
  const grace = DIFFICULTIES[state.setup.difficulty].insolvencyGrace;
  if (state.company.insolventDays > 0) out.push({ cause: 'insolvency', title: 'Management company insolvent', detail: `Company cash is ${usd(state.company.cash)}. Cut costs (staff, office, automation, marketing) or grow fee-paying AUM.`, daysLeft: grace - state.company.insolventDays });
  if (state.watch.smallDays > 0) out.push({ cause: 'tooSmall', title: 'Fund below minimum viable size', detail: `NAV must recover above ${usd(toCents(BALANCE.clients.minViableFund))} or the fund will be wound down.`, daysLeft: WINDDOWN_DAYS - state.watch.smallDays });
  if (state.watch.lowConfidenceDays > 0) out.push({ cause: 'confidence', title: 'Investor confidence has collapsed', detail: 'Average client confidence is below 15. Call clients, send a letter, cut risk and deliver returns.', daysLeft: WINDDOWN_DAYS - state.watch.lowConfidenceDays });
  return out;
}

function fail(state: GameState, cause: FailureReport['cause'], reason: string) {
  state.status = cause === 'voluntary' ? 'closed' : 'failed';
  state.failure = { cause, reason, day: state.clock.day, date: state.clock.date };
  logKeyEvent(state, reason);
  notify(state, 'danger', cause === 'voluntary' ? 'Fund closed' : 'The fund has failed', reason, { link: { screen: 'gameover' }, sound: 'alert' });
}

/** Evaluated after the close each day (and immediately on NAV wipe-out). */
export function checkFailure(state: GameState): boolean {
  if (state.status !== 'active') return true;
  const s = summarize(state);
  const d = DIFFICULTIES[state.setup.difficulty];
  if (s.nav <= 0) {
    fail(state, 'margin', 'Losses wiped out the fund\'s capital. The prime broker closed all positions and terminated the account.');
    return true;
  }
  const dd = currentDrawdown(state);
  if (dd >= d.collapseDrawdown) {
    fail(state, 'drawdown', `A ${(dd * 100).toFixed(0)}% drawdown from peak destroyed investor trust. Clients redeemed en masse and the fund was wound down.`);
    return true;
  }
  if (state.company.insolventDays >= d.insolvencyGrace) {
    fail(state, 'insolvency', `The management company ran out of cash and could not pay salaries and rent for ${d.insolvencyGrace} trading days. It entered bankruptcy, forcing the fund to close.`);
    return true;
  }
  // recoverable conditions with countdowns
  if (s.nav < toCents(BALANCE.clients.minViableFund)) state.watch.smallDays++;
  else state.watch.smallDays = 0;
  const ext = state.clients.filter((c) => c.status !== 'departed' && c.type !== 'founder');
  const avgConf = ext.length ? ext.reduce((a, c) => a + c.confidence, 0) / ext.length : 100;
  if (ext.length && avgConf < 15) state.watch.lowConfidenceDays++;
  else state.watch.lowConfidenceDays = 0;
  if (state.watch.smallDays >= WINDDOWN_DAYS) {
    fail(state, 'tooSmall', `The fund stayed below the minimum viable size of ${usd(toCents(BALANCE.clients.minViableFund))} for ${WINDDOWN_DAYS} days and was wound down.`);
    return true;
  }
  if (state.watch.lowConfidenceDays >= WINDDOWN_DAYS) {
    fail(state, 'confidence', 'Investor confidence stayed near zero for two weeks. Your remaining clients voted to wind the fund down.');
    return true;
  }
  const flows = state.flows.filter((f) => f.status === 'pending' && f.kind === 'redemption');
  const pendingUnits = flows.reduce((a, f) => a + f.amount, 0);
  if (state.fund.unitsOutstanding > 0 && pendingUnits / state.fund.unitsOutstanding > 0.9 && ext.length) {
    fail(state, 'redemptions', 'Nearly all investors submitted redemption notices. The fund could not continue and began an orderly liquidation.');
    return true;
  }
  return false;
}

export function closeFundVoluntarily(state: GameState) {
  if (state.status !== 'active') return;
  fail(state, 'voluntary', 'You chose to close the fund and return capital to investors.');
}
