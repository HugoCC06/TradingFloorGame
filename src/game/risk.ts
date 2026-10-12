import { BALANCE } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import { SECTOR_BY_ID, type SectorId } from '../config/sectors';
import { summarize, type PortfolioSummary } from './accounting';
import { nextId, notify } from './notify';
import { currentDrawdown } from './performance';
import type { GameState, RiskBreach, RiskLimits } from './types';

export function defaultLimits(state: Pick<GameState, 'setup'>): RiskLimits {
  return {
    maxPositionWeight: BALANCE.risk.maxPositionWeight,
    maxSectorWeight: BALANCE.risk.maxSectorWeight,
    maxGross: DIFFICULTIES[state.setup.difficulty].maxGross,
    maxMarginUtilisation: BALANCE.risk.maxMarginUtilisation,
    minLiquidity: BALANCE.risk.minLiquidity,
  };
}

export function sectorLabel(k: string) {
  if (k === 'commodity') return 'Commodities';
  if (k === 'broad') return 'Broad-market ETFs';
  return SECTOR_BY_ID[k as SectorId]?.name ?? k;
}

/** Evaluate every rule; each breach explains what, which rule, which instruments, severity and fixes. */
export function evaluateRisk(state: GameState, s: PortfolioSummary = summarize(state)): RiskBreach[] {
  const L = state.risk.limits;
  const out: RiskBreach[] = [];
  const nav = Math.max(s.nav, 1);
  for (const p of s.positions) {
    if (p.inst.kind === 'etf' && p.inst.sector === 'broad') continue;
    const w = Math.abs(p.weight);
    if (w > L.maxPositionWeight) {
      const sev = w > L.maxPositionWeight * 1.5 ? 'critical' : 'breach';
      const excess = Math.ceil(((w - L.maxPositionWeight) * nav) / 100 / p.price);
      out.push({
        id: `pos:${p.id}`, rule: 'position', severity: sev,
        title: `${p.id} is ${(w * 100).toFixed(1)}% of NAV`,
        detail: `Single-position limit is ${(L.maxPositionWeight * 100).toFixed(0)}% of NAV. A concentrated ${p.qty > 0 ? 'long' : 'short'} in ${p.inst.name} exposes the fund to one company's news.`,
        instruments: [p.id], value: w, limit: L.maxPositionWeight,
        actions: [`${p.qty > 0 ? 'Sell' : 'Cover'} about ${excess.toLocaleString()} units of ${p.id}`, 'Grow NAV with new subscriptions', 'Set a target allocation and rebalance'],
      });
    } else if (w > L.maxPositionWeight * 0.85) {
      out.push({ id: `pos:${p.id}`, rule: 'position', severity: 'warning', title: `${p.id} approaching position limit`, detail: `${(w * 100).toFixed(1)}% of NAV vs ${(L.maxPositionWeight * 100).toFixed(0)}% limit.`, instruments: [p.id], value: w, limit: L.maxPositionWeight, actions: ['Avoid adding to this position'] });
    }
  }
  for (const [sec, e] of Object.entries(s.sectorExposure)) {
    if (sec === 'broad') continue;
    const w = e.gross / nav;
    const ids = s.positions.filter((p) => (p.inst.kind === 'commodity' ? 'commodity' : p.inst.sector) === sec).map((p) => p.id);
    if (w > L.maxSectorWeight) {
      out.push({
        id: `sec:${sec}`, rule: 'sector', severity: w > L.maxSectorWeight * 1.4 ? 'critical' : 'breach',
        title: `${sectorLabel(sec)} exposure ${(w * 100).toFixed(0)}% of NAV`,
        detail: `Sector concentration limit is ${(L.maxSectorWeight * 100).toFixed(0)}% (gross). A sector-wide shock would hit several positions at once.`,
        instruments: ids, value: w, limit: L.maxSectorWeight,
        actions: ['Trim the largest positions in this sector', 'Hedge with a short in the sector ETF (reduces net, not gross)', 'Diversify new capital into other sectors'],
      });
    }
  }
  if (s.grossLeverage > L.maxGross) {
    out.push({
      id: 'gross', rule: 'gross', severity: s.grossLeverage > L.maxGross * 1.15 ? 'critical' : 'breach',
      title: `Gross exposure ${(s.grossLeverage * 100).toFixed(0)}% of NAV`,
      detail: `The prime broker allows ${(L.maxGross * 100).toFixed(0)}%. New risk-increasing orders will be rejected until exposure falls.`,
      instruments: s.positions.slice(0, 5).map((p) => p.id), value: s.grossLeverage, limit: L.maxGross,
      actions: ['Reduce both long and short positions', 'Close the smallest, least convicted positions'],
    });
  }
  if (s.marginUtilisation > L.maxMarginUtilisation) {
    out.push({
      id: 'margin', rule: 'margin', severity: s.marginUtilisation > 0.95 ? 'critical' : 'breach',
      title: `Margin utilisation ${(s.marginUtilisation * 100).toFixed(0)}%`,
      detail: `Maintenance margin of ${fmt(s.maintenanceReq)} uses ${(s.marginUtilisation * 100).toFixed(0)}% of equity. At 100% the prime broker force-liquidates positions at penalty prices.`,
      instruments: s.positions.slice(0, 5).map((p) => p.id), value: s.marginUtilisation, limit: L.maxMarginUtilisation,
      actions: ['Reduce leveraged or volatile positions', 'Cover risky shorts', 'Install the Risk Monitor automation to auto-trim at 90%'],
    });
  }
  const liq = s.freeCash / nav;
  if (s.positions.length && liq < L.minLiquidity && liq > -Infinity) {
    const pending = pendingRedemptionValue(state, s);
    out.push({
      id: 'liquidity', rule: 'liquidity', severity: pending > s.freeCash ? 'breach' : 'warning',
      title: `Free cash ${(liq * 100).toFixed(1)}% of NAV`,
      detail: `Liquidity buffer target is ${(L.minLiquidity * 100).toFixed(0)}%.${pending > 0 ? ` Pending redemptions of ${fmt(pending)} will force sales if cash is short.` : ' Low cash leaves no room for redemptions or margin swings.'}`,
      instruments: [], value: liq, limit: L.minLiquidity,
      actions: ['Trim positions to raise cash', 'Avoid new purchases until the buffer is rebuilt'],
    });
  }
  const dd = currentDrawdown(state);
  const collapse = DIFFICULTIES[state.setup.difficulty].collapseDrawdown;
  if (dd > 0.15) {
    out.push({
      id: 'drawdown', rule: 'drawdown', severity: dd > collapse * 0.75 ? 'critical' : dd > 0.25 ? 'breach' : 'warning',
      title: `Drawdown ${(dd * 100).toFixed(1)}% from peak`,
      detail: `Clients judge you on drawdowns. At ${(collapse * 100).toFixed(0)}% investors lose faith entirely and the fund collapses.`,
      instruments: [], value: dd, limit: collapse,
      actions: ['Reduce risk until performance stabilises', 'Call key clients to shore up confidence', 'Send an investor letter'],
    });
  }
  return out;
}

function pendingRedemptionValue(state: GameState, s: PortfolioSummary) {
  let u = 0;
  for (const f of state.flows) if (f.status === 'pending' && f.kind === 'redemption') u += f.amount;
  return Math.round(u * s.navPerUnit * 100);
}

function fmt(c: number) {
  return '$' + Math.round(c / 100).toLocaleString('en-US');
}

/** Intraday: refresh breaches and alert on newly-appearing ones. */
export function refreshRisk(state: GameState) {
  const prev = new Map(state.risk.breaches.map((b) => [b.id, b.severity]));
  const now = evaluateRisk(state);
  for (const b of now) {
    const was = prev.get(b.id);
    const escalated = was && was === 'warning' && b.severity !== 'warning';
    if ((!was && b.severity !== 'warning') || escalated) {
      notify(state, b.severity === 'critical' ? 'danger' : 'warning', `Risk ${b.severity}: ${b.title}`, b.detail, { link: { screen: 'risk' }, sound: 'alert' });
    }
  }
  state.risk.breaches = now;
}

/** End-of-day consequences. Returns the number of hard breaches today. */
export function endOfDayRisk(state: GameState): number {
  refreshRisk(state);
  const hard = state.risk.breaches.filter((b) => b.severity !== 'warning' && b.rule !== 'drawdown').length;
  if (hard > 0) {
    state.risk.breachStreak++;
    state.risk.totalBreachDays++;
    state.risk.cleanDays = 0;
    state.reputation = Math.max(0, state.reputation - 0.4 * hard);
    if (state.risk.breachStreak === 3 && !state.decisions.some((d) => d.kind === 'review')) {
      state.decisions.push({
        id: nextId(state, 'misc', 'D'), kind: 'review', title: 'Investors open a risk review',
        text: 'Your fund has breached its risk limits for three consecutive days. Institutional investors want to know how you will respond.',
        day: state.clock.day, expiresDay: state.clock.day + 3,
        options: [
          { id: 'commit', label: 'Commit to strict limits', detail: 'Pre-trade limit enforcement switches on. Client confidence +4.' },
          { id: 'defend', label: 'Defend the strategy', detail: 'Keep full flexibility. Institutional confidence −6, reputation −2.' },
        ],
      });
      notify(state, 'danger', 'Risk review opened', 'Investors are reviewing your risk management. Respond in the Decisions panel.', { link: { screen: 'business' }, sound: 'alert' });
    }
  } else {
    state.risk.breachStreak = 0;
    state.risk.cleanDays++;
  }
  return hard;
}
