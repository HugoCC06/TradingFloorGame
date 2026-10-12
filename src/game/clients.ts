/**
 * Clients, capital flows and investor prospects.
 *
 * Subscriptions and redemptions transact in fund units at the closing NAV per
 * unit, so they change AUM but never the reported investment return.
 * Client behaviour is probabilistic but driven by visible factors, each of
 * which is recorded as a "concern" the player can inspect.
 */
import { BALANCE, OFFICES } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import { summarize, toCents } from './accounting';
import { companyTxn, usd } from './company';
import { pushNews } from './events/engine';
import { institutionName } from './names';
import { nextId, notify, logKeyEvent } from './notify';
import { raiseCash } from './orders';
import { annualise, currentDrawdown, trailingReturn } from './performance';
import { Rng } from './rng';
import { irPower, riskOversight } from './staff';
import type { CapitalFlow, Client, ClientType, GameState, Prospect } from './types';

export const CLIENT_TYPES: Record<Exclude<ClientType, 'founder'>, {
  label: string; ticket: [number, number]; expRet: number; ddTol: number; sens: number; horizon: number; notice: number; risk: number;
  mgmt: number; perf: number; minAum: number; minTrack: number; mandate: Client['mandate']; pitchCost: number;
}> = {
  hnw: { label: 'High-net-worth individual', ticket: [300_000, 4_000_000], expRet: 0.12, ddTol: 0.15, sens: 1.3, horizon: 252, notice: 5, risk: 0.7, mgmt: 0.02, perf: 0.2, minAum: 0, minTrack: 0, mandate: {}, pitchCost: 2_000 },
  family: { label: 'Family office', ticket: [1_500_000, 20_000_000], expRet: 0.09, ddTol: 0.12, sens: 1.0, horizon: 504, notice: 10, risk: 0.55, mgmt: 0.0175, perf: 0.2, minAum: 5_000_000, minTrack: 20, mandate: { maxShare: 0.35 }, pitchCost: 5_000 },
  institution: { label: 'Endowment / foundation', ticket: [8_000_000, 60_000_000], expRet: 0.08, ddTol: 0.1, sens: 0.9, horizon: 756, notice: 20, risk: 0.45, mgmt: 0.015, perf: 0.175, minAum: 25_000_000, minTrack: 63, mandate: { maxShare: 0.25, maxGross: 1.75 }, pitchCost: 10_000 },
  corporate: { label: 'Corporate treasury', ticket: [5_000_000, 35_000_000], expRet: 0.06, ddTol: 0.08, sens: 1.1, horizon: 504, notice: 15, risk: 0.3, mgmt: 0.015, perf: 0.15, minAum: 15_000_000, minTrack: 42, mandate: { maxShare: 0.25, maxGross: 1.5, maxDrawdown: 0.15 }, pitchCost: 8_000 },
  pension: { label: 'Pension fund', ticket: [20_000_000, 150_000_000], expRet: 0.07, ddTol: 0.08, sens: 0.8, horizon: 1260, notice: 30, risk: 0.3, mgmt: 0.0125, perf: 0.15, minAum: 50_000_000, minTrack: 126, mandate: { maxShare: 0.2, maxGross: 1.5, maxDrawdown: 0.15 }, pitchCost: 15_000 },
};

export function clientTypeLabel(t: ClientType) {
  return t === 'founder' ? 'Founder (you)' : CLIENT_TYPES[t].label;
}

export function mandateText(m: Client['mandate']): string[] {
  const out: string[] = [];
  if (m.maxGross) out.push(`Gross exposure ≤ ${(m.maxGross * 100).toFixed(0)}% of NAV`);
  if (m.maxDrawdown) out.push(`Drawdown ≤ ${(m.maxDrawdown * 100).toFixed(0)}%`);
  if (m.maxShare) out.push(`Max ${(m.maxShare * 100).toFixed(0)}% of fund AUM`);
  return out;
}

export function makeClient(state: GameState, rng: Rng, type: ClientType, amountCents: number, navpu: number, expectMult = 1): Client {
  const def = type === 'founder' ? null : CLIENT_TYPES[type];
  const units = amountCents / 100 / navpu;
  return {
    id: nextId(state, 'misc', 'C'),
    name: type === 'founder' ? `${state.setup.fundName} founder capital` : institutionName(rng, type),
    type,
    units,
    netContributed: amountCents,
    initialDay: state.clock.day,
    riskTolerance: def ? Math.min(1, Math.max(0, def.risk + rng.normal() * 0.1)) : 1,
    expectedReturn: def ? Math.max(0.03, def.expRet * expectMult * (0.85 + rng.next() * 0.3)) : 0,
    drawdownTolerance: def ? Math.max(0.04, def.ddTol * (0.8 + rng.next() * 0.4)) : 1,
    withdrawalSensitivity: def ? Math.max(0.4, def.sens * (0.75 + rng.next() * 0.5)) : 0,
    horizonDays: def ? def.horizon : 99999,
    noticeDays: def ? def.notice : 0,
    confidence: type === 'founder' ? 100 : 58 + rng.normal() * 6,
    relationship: type === 'founder' ? 100 : 50 + rng.normal() * 8,
    mgmtFee: def ? def.mgmt : 0,
    perfFee: def ? def.perf : 0,
    hwm: navpu,
    status: 'active',
    concerns: [],
    history: [{ day: state.clock.day, date: state.clock.date, text: `Invested ${usd(amountCents)}` }],
    lastCallDay: -999,
    lastDinnerDay: -999,
    mandate: def ? { ...def.mandate } : {},
    lastConcessionDay: -999,
    pendingRedemptionUnits: 0,
  };
}

function clientValue(c: Client, navpu: number) {
  return Math.round(c.units * navpu * 100);
}

export function clientValueCents(c: Client, navpu: number) {
  return clientValue(c, navpu);
}

function addHistory(state: GameState, c: Client, text: string, delta?: number) {
  c.history.push({ day: state.clock.day, date: state.clock.date, text, delta });
  if (c.history.length > 40) c.history.shift();
}

/** Daily confidence update with transparent drivers. */
export function updateClients(state: GameState, breachesToday: number) {
  const rng = new Rng(state.rng.clients);
  const d = DIFFICULTIES[state.setup.difficulty];
  const s = summarize(state);
  const days = state.daily.length;
  const r20 = annualise(trailingReturn(state, 20), Math.min(20, Math.max(1, days)));
  const r60 = annualise(trailingReturn(state, 60), Math.min(60, Math.max(1, days)));
  const blend = days < 5 ? 0 : 0.5 * r20 + 0.5 * r60;
  const dd = currentDrawdown(state);
  const rivalMedian = medianRival60(state);
  const raw60 = trailingReturn(state, 60);
  const oversight = riskOversight(state);
  for (const c of state.clients) {
    if (c.status === 'departed' || c.type === 'founder') continue;
    const concerns: string[] = [];
    const exp = c.expectedReturn * d.clientExpectation;
    const excess = Math.max(-1, Math.min(1, blend - exp));
    let delta = 0;
    // performance (dampened in the first weeks: clients judge over time)
    const perfW = Math.min(1, days / 30);
    const perf = 3.2 * excess * perfW;
    delta += perf;
    if (excess < -0.05 && perfW > 0.3) concerns.push(`Returns below expectations (${(blend * 100).toFixed(1)}% annualised vs ${(exp * 100).toFixed(0)}% target)`);
    // drawdown vs tolerance
    const tol = c.drawdownTolerance + d.drawdownGrace;
    if (dd > tol) {
      delta -= 55 * (dd - tol);
      concerns.push(`Drawdown of ${(dd * 100).toFixed(1)}% exceeds their ${(tol * 100).toFixed(0)}% tolerance`);
    }
    // mandate terms
    if (c.mandate.maxGross && s.grossLeverage > c.mandate.maxGross) {
      delta -= 2.5;
      concerns.push(`Mandate breach: gross exposure ${(s.grossLeverage * 100).toFixed(0)}% > ${(c.mandate.maxGross * 100).toFixed(0)}%`);
    }
    if (c.mandate.maxDrawdown && dd > c.mandate.maxDrawdown) {
      delta -= 2.5;
      concerns.push(`Mandate breach: drawdown above ${(c.mandate.maxDrawdown * 100).toFixed(0)}%`);
    }
    if (breachesToday > 0) {
      delta -= 0.8 * breachesToday * (1.3 - c.riskTolerance);
      concerns.push('Risk-limit breaches in the portfolio');
    }
    if (state.risk.lastMarginCallDay > state.clock.day - 20) concerns.push('Recent margin call');
    // rivals
    if (days > 20 && raw60 < rivalMedian - 0.04) {
      delta -= 0.35 * d.rivalMarketing;
      concerns.push('Competing funds are outperforming');
    }
    // reputation, relationship, oversight, mean reversion
    delta += (state.reputation - 50) * 0.012;
    if (state.reputation < 30) concerns.push('Concerns about the firm\'s reputation');
    delta += (c.relationship - 50) * 0.012;
    delta += oversight * 0.25;
    delta += (55 - c.confidence) * 0.008;
    // sensitivity scales the negative side
    if (delta < 0) delta *= c.withdrawalSensitivity * d.clientSensitivity;
    delta += rng.normal() * 0.35;
    c.confidence = Math.max(0, Math.min(100, c.confidence + delta));
    c.relationship = Math.max(0, Math.min(100, c.relationship + (40 - c.relationship) * 0.006));
    c.concerns = concerns;
  }
}

function medianRival60(state: GameState): number {
  const rs = state.rivals.map((r) => {
    const h = r.history;
    if (h.length < 2) return 0;
    const base = h[Math.max(0, h.length - 61)].navPerUnit;
    return r.navPerUnit / base - 1;
  }).sort((a, b) => a - b);
  return rs.length ? rs[Math.floor(rs.length / 2)] : 0;
}

/** Probabilistic redemptions and top-ups after the daily confidence update. */
export function clientFlowDecisions(state: GameState) {
  const rng = new Rng(state.rng.clients);
  const d = DIFFICULTIES[state.setup.difficulty];
  const s = summarize(state);
  const navpu = s.navPerUnit;
  const ir = irPower(state);
  const r60 = trailingReturn(state, 60);
  for (const c of state.clients) {
    if (c.status === 'departed' || c.type === 'founder' || c.units <= 0) continue;
    const free = c.units - c.pendingRedemptionUnits;
    if (free <= 1e-9) continue;
    const held = state.clock.day - c.initialDay;
    let p = 0;
    if (c.confidence < 40) p = 0.03 * Math.pow((40 - c.confidence) / 40, 1.3) * c.withdrawalSensitivity * d.clientSensitivity * (1 - Math.min(0.5, ir * 0.15));
    if (held > c.horizonDays && c.confidence < 65) p += 0.002;
    // concentration mandate
    const share = (c.units / Math.max(state.fund.unitsOutstanding, 1e-9));
    if (c.mandate.maxShare && share > c.mandate.maxShare * 1.1) p += 0.05;
    if (p > 0 && rng.chance(p)) {
      const frac = c.confidence < 15 ? 1 : share > (c.mandate.maxShare ?? 1) ? Math.min(1, 1 - (c.mandate.maxShare ?? 1) / share + 0.02) : 0.25 + rng.next() * 0.4;
      const units = free * frac;
      requestRedemption(state, c, units, c.confidence < 15 ? 'Lost confidence in the fund' : share > (c.mandate.maxShare ?? 1) ? 'Concentration limit: reducing share of fund' : c.concerns[0] ?? 'Portfolio rebalancing');
      continue;
    }
    // top-ups
    if (c.confidence > 72 && r60 > c.expectedReturn * (60 / 252) && state.daily.length > 20) {
      const pt = 0.012 * ((c.confidence - 72) / 28) * (1 + ir * 0.3);
      if (rng.chance(pt)) {
        const amount = Math.round(clientValue(c, navpu) * (0.1 + rng.next() * 0.3));
        if (amount > toCents(50_000)) {
          scheduleFlow(state, c.id, 'subscription', amount, state.clock.day + 1);
          addHistory(state, c, `Committed an additional ${usd(amount)}`);
          notify(state, 'success', 'Client top-up', `${c.name} will add ${usd(amount)} at tomorrow's close.`, { link: { screen: 'clients', id: c.id }, sound: 'cash' });
        }
      }
    }
  }
}

export function requestRedemption(state: GameState, c: Client, units: number, reason: string) {
  const navpu = summarize(state).navPerUnit;
  const value = Math.round(units * navpu * 100);
  c.pendingRedemptionUnits += units;
  c.status = 'redeeming';
  scheduleFlow(state, c.id, 'redemption', units, state.clock.day + c.noticeDays);
  addHistory(state, c, `Requested redemption of ~${usd(value)} (${reason})`);
  const big = value > summarize(state).nav * 0.1;
  notify(state, big ? 'danger' : 'warning', 'Redemption notice', `${c.name} is withdrawing ~${usd(value)} in ${c.noticeDays} trading day${c.noticeDays === 1 ? '' : 's'}. Reason: ${reason}.`, { link: { screen: 'clients', id: c.id }, sound: 'alert' });
  if (big) {
    pushNews(state, { templateId: 'client_redemption', category: 'client', headline: `${c.name} pulls ${usd(value)} from ${state.setup.fundName}`, body: `${c.name}, a ${clientTypeLabel(c.type).toLowerCase()}, has submitted a redemption notice. ${reason}.`, severity: 2, tone: -1, instruments: [], sectors: [] });
  }
}

export function scheduleFlow(state: GameState, clientId: string, kind: CapitalFlow['kind'], amount: number, effectiveDay: number) {
  state.flows.push({ id: nextId(state, 'misc', 'K'), clientId, kind, amount, requestedDay: state.clock.day, effectiveDay, status: 'pending' });
}

/** Settle due flows at the closing NAV per unit. Returns totals. */
export function settleFlows(state: GameState): { subs: number; reds: number } {
  let subs = 0, reds = 0;
  for (const fl of state.flows) {
    if (fl.status !== 'pending' || fl.effectiveDay > state.clock.day) continue;
    const c = state.clients.find((x) => x.id === fl.clientId);
    if (!c) { fl.status = 'cancelled'; continue; }
    const s = summarize(state);
    const navpu = s.navPerUnit;
    if (navpu <= 0) { fl.status = 'cancelled'; continue; }
    if (fl.kind === 'subscription') {
      const amt = Math.round(fl.amount);
      const units = amt / 100 / navpu;
      state.fund.cash += amt;
      state.fund.unitsOutstanding += units;
      // blended high-water mark: new money enters at today's NAV per unit
      c.hwm = c.units > 0 ? (c.units * c.hwm + units * navpu) / (c.units + units) : navpu;
      c.units += units;
      c.netContributed += amt;
      if (c.status === 'departed') c.status = 'active';
      state.fund.totals.subscriptions += amt;
      fl.status = 'settled';
      fl.settledValue = amt;
      subs += amt;
      addHistory(state, c, `Subscription of ${usd(amt)} settled`);
    } else {
      const units = Math.min(fl.amount, c.units);
      const value = Math.round(units * navpu * 100);
      if (s.freeCash < value) {
        const raised = raiseCash(state, value - Math.max(0, s.freeCash));
        if (raised > 0) notify(state, 'warning', 'Positions sold for redemptions', `Sold ${usd(raised)} of holdings pro rata to fund client redemptions.`, { link: { screen: 'portfolio' } });
      }
      const navpu2 = summarize(state).navPerUnit; // costs of raising cash are borne by the fund
      const value2 = Math.round(units * navpu2 * 100);
      state.fund.cash -= value2;
      state.fund.unitsOutstanding -= units;
      c.units -= units;
      c.pendingRedemptionUnits = Math.max(0, c.pendingRedemptionUnits - fl.amount);
      c.netContributed -= value2;
      state.fund.totals.redemptions += value2;
      fl.status = 'settled';
      fl.settledValue = value2;
      reds += value2;
      addHistory(state, c, `Redemption of ${usd(value2)} paid`);
      if (c.units < 1e-6) {
        c.units = 0;
        c.status = 'departed';
        state.stats.lostClients++;
        addHistory(state, c, 'Relationship ended');
        logKeyEvent(state, `Lost client ${c.name}`);
      } else if (c.pendingRedemptionUnits < 1e-9) c.status = 'active';
    }
  }
  if (state.flows.length > 400) state.flows = state.flows.filter((f) => f.status === 'pending' || f.effectiveDay > state.clock.day - 120);
  return { subs, reds };
}

// ───────────── interactions ─────────────

export function canCall(state: GameState, c: Client) {
  return state.clock.day - c.lastCallDay >= BALANCE.clients.callCooldownDays;
}

export function callClient(state: GameState, clientId: string): { ok: boolean; error?: string; gain?: number } {
  const c = state.clients.find((x) => x.id === clientId);
  if (!c || c.status === 'departed' || c.type === 'founder') return { ok: false, error: 'Client unavailable.' };
  if (!canCall(state, c)) return { ok: false, error: `You spoke recently. Next call available in ${BALANCE.clients.callCooldownDays - (state.clock.day - c.lastCallDay)} days.` };
  const power = 0.35 + irPower(state, c.type);
  const gain = Math.round((2 + 5 * power + (c.confidence < 40 ? 2 : 0)) * 10) / 10;
  c.confidence = Math.min(100, c.confidence + gain);
  c.relationship = Math.min(100, c.relationship + 5);
  c.lastCallDay = state.clock.day;
  addHistory(state, c, `Update call (+${gain} confidence)`, gain);
  return { ok: true, gain };
}

export function dinnerClient(state: GameState, clientId: string): { ok: boolean; error?: string; gain?: number } {
  const c = state.clients.find((x) => x.id === clientId);
  if (!c || c.status === 'departed' || c.type === 'founder') return { ok: false, error: 'Client unavailable.' };
  if (state.clock.day - c.lastDinnerDay < BALANCE.clients.dinnerCooldownDays) return { ok: false, error: 'Too soon for another dinner.' };
  const cost = toCents(BALANCE.clients.dinnerCost);
  if (state.company.cash < cost) return { ok: false, error: 'The management company cannot afford it.' };
  companyTxn(state, 'client', -cost, `Client dinner — ${c.name}`);
  const power = 0.35 + irPower(state, c.type);
  const gain = Math.round((4 + 7 * power) * 10) / 10;
  c.confidence = Math.min(100, c.confidence + gain);
  c.relationship = Math.min(100, c.relationship + 10);
  c.lastDinnerDay = state.clock.day;
  addHistory(state, c, `Client dinner (+${gain} confidence)`, gain);
  return { ok: true, gain };
}

export function sendLetter(state: GameState): { ok: boolean; error?: string; gain?: number } {
  if (state.clock.day - state.lastLetterDay < BALANCE.clients.letterCooldownDays) return { ok: false, error: `Investor letters go out at most every ${BALANCE.clients.letterCooldownDays} days.` };
  const r = trailingReturn(state, 20);
  const gain = r > 0 ? 3 : 1.2;
  for (const c of state.clients) if (c.status !== 'departed' && c.type !== 'founder') {
    c.confidence = Math.min(100, c.confidence + gain);
    c.relationship = Math.min(100, c.relationship + 2);
    addHistory(state, c, `Received investor letter (+${gain})`, gain);
  }
  state.lastLetterDay = state.clock.day;
  return { ok: true, gain };
}

export function feeConcession(state: GameState, clientId: string): { ok: boolean; error?: string } {
  const c = state.clients.find((x) => x.id === clientId);
  if (!c || c.status === 'departed' || c.type === 'founder') return { ok: false, error: 'Client unavailable.' };
  if (state.clock.day - c.lastConcessionDay < 60) return { ok: false, error: 'You already granted a concession recently.' };
  if (c.mgmtFee <= 0.005 && c.perfFee <= 0.1) return { ok: false, error: 'Fees are already at the floor.' };
  c.mgmtFee = Math.max(0.005, c.mgmtFee - 0.0025);
  c.perfFee = Math.max(0.1, c.perfFee - 0.025);
  c.confidence = Math.min(100, c.confidence + 14);
  c.relationship = Math.min(100, c.relationship + 6);
  c.lastConcessionDay = state.clock.day;
  addHistory(state, c, `Fee concession: now ${(c.mgmtFee * 100).toFixed(2)}% / ${(c.perfFee * 100).toFixed(1)}%`, 14);
  return { ok: true };
}

// ───────────── prospects ─────────────

export function generateProspects(state: GameState) {
  const rng = new Rng(state.rng.clients);
  const open = state.prospects.filter((p) => p.status === 'open' || p.status === 'pitched');
  for (const p of state.prospects) if (p.status === 'open' && p.expiresDay < state.clock.day) p.status = 'expired';
  if (open.length >= 5) return;
  const s = summarize(state);
  const ir = irPower(state);
  const office = OFFICES[state.company.officeTier];
  const r60 = trailingReturn(state, 60);
  const marketing = state.company.marketingPerYear / toCents(250_000);
  const perfF = Math.max(0.4, Math.min(2, 1 + r60 * 4));
  const d = DIFFICULTIES[state.setup.difficulty];
  const rate = BALANCE.clients.prospectBaseRate * (0.5 + state.reputation / 100) * (1 + 0.6 * ir) * (1 + office.appeal) * (1 + 0.6 * Math.min(2, marketing)) * perfF / (0.6 + 0.4 * d.rivalMarketing);
  if (!rng.chance(rate)) return;
  const aumD = s.nav / 100;
  const types = (Object.keys(CLIENT_TYPES) as Exclude<ClientType, 'founder'>[]);
  const type = rng.weighted(types, (t) => {
    const def = CLIENT_TYPES[t];
    const reach = aumD >= def.minAum * 0.6 ? 1 : 0.15;
    return reach * { hnw: 4, family: 3, institution: 1.5, corporate: 1.5, pension: 1 }[t];
  });
  const def = CLIENT_TYPES[type];
  const maxTicket = Math.max(def.ticket[0], Math.min(def.ticket[1], aumD * (def.mandate.maxShare ?? 0.4)));
  const amount = toCents(Math.round(Math.exp(Math.log(def.ticket[0]) + rng.next() * (Math.log(Math.max(maxTicket, def.ticket[0] * 1.01)) - Math.log(def.ticket[0]))) / 10_000) * 10_000);
  const p: Prospect = {
    id: nextId(state, 'misc', 'P'),
    name: institutionName(rng, type),
    type,
    amount,
    expectedReturn: def.expRet * (0.85 + rng.next() * 0.3),
    drawdownTolerance: def.ddTol,
    riskTolerance: def.risk,
    expiresDay: state.clock.day + 6 + rng.int(0, 6),
    createdDay: state.clock.day,
    minTrackDays: def.minTrack,
    minAum: toCents(def.minAum),
    mandate: { ...def.mandate },
    mgmtFee: def.mgmt,
    perfFee: def.perf,
    status: 'open',
    note: rng.pick(['Introduced by a consultant', 'Inbound enquiry after recent coverage', 'Referral from an existing investor', 'Met at an industry conference', 'Seeking diversification from larger managers']),
  };
  state.prospects.push(p);
  if (state.prospects.length > 60) state.prospects = state.prospects.filter((x) => x.status === 'open' || x.status === 'pitched' || x.createdDay > state.clock.day - 60);
  notify(state, 'info', 'New investor prospect', `${p.name} (${def.label}) is considering a ${usd(amount)} allocation.`, { link: { screen: 'clients' } });
}

export interface PitchAssessment {
  probability: number;
  factors: { label: string; effect: number }[];
  blockers: string[];
  cost: number;
}

export function assessPitch(state: GameState, p: Prospect): PitchAssessment {
  const s = summarize(state);
  const days = state.daily.length;
  const factors: { label: string; effect: number }[] = [];
  const blockers: string[] = [];
  const def = CLIENT_TYPES[p.type as Exclude<ClientType, 'founder'>];
  let prob = 0.32;
  const irp = irPower(state, p.type);
  factors.push({ label: 'Investor relations team', effect: Math.min(0.25, 0.14 * irp) });
  factors.push({ label: 'Reputation', effect: (state.reputation - 50) / 160 });
  factors.push({ label: 'Office & brand', effect: OFFICES[state.company.officeTier].appeal * 0.35 });
  const ann = days > 5 ? annualise(trailingReturn(state, Math.min(days, 126)), Math.min(days, 126)) : 0;
  factors.push({ label: `Track record (${(ann * 100).toFixed(1)}% annualised vs ${(p.expectedReturn * 100).toFixed(0)}% sought)`, effect: Math.max(-0.25, Math.min(0.2, (ann - p.expectedReturn) * 0.8)) * Math.min(1, days / 40) });
  const dd = currentDrawdown(state);
  if (dd > p.drawdownTolerance * 0.6) factors.push({ label: `Current drawdown ${(dd * 100).toFixed(1)}%`, effect: -Math.min(0.3, (dd - p.drawdownTolerance * 0.6) * 2) });
  const better = state.rivals.filter((r) => r.history.length > 20 && r.navPerUnit / r.history[Math.max(0, r.history.length - 61)].navPerUnit - 1 > trailingReturn(state, 60)).length;
  factors.push({ label: `Competition (${better} of ${state.rivals.length} rivals ahead over 60d)`, effect: -0.035 * better * DIFFICULTIES[state.setup.difficulty].rivalMarketing });
  if (state.risk.breaches.some((b) => b.severity !== 'warning')) factors.push({ label: 'Open risk breaches', effect: -0.1 });
  if (p.mandate.maxGross && s.grossLeverage > p.mandate.maxGross) factors.push({ label: `Leverage above their ${(p.mandate.maxGross * 100).toFixed(0)}% limit`, effect: -0.15 });
  for (const f of factors) prob += f.effect;
  if (days < p.minTrackDays) blockers.push(`Requires a ${p.minTrackDays}-day track record (you have ${days}).`);
  if (s.nav < p.minAum) blockers.push(`Requires fund AUM of at least ${usd(p.minAum)}.`);
  if (p.mandate.maxShare && p.amount > (s.nav + p.amount) * p.mandate.maxShare) blockers.push(`Their ${usd(p.amount)} would exceed ${(p.mandate.maxShare * 100).toFixed(0)}% of the fund.`);
  if (blockers.length) prob = 0.03;
  return { probability: Math.max(0.03, Math.min(0.9, prob)), factors, blockers, cost: toCents(def.pitchCost) };
}

export function pitchProspect(state: GameState, prospectId: string): { ok: boolean; error?: string } {
  const p = state.prospects.find((x) => x.id === prospectId);
  if (!p || p.status !== 'open') return { ok: false, error: 'Prospect unavailable.' };
  const a = assessPitch(state, p);
  if (state.company.cash < a.cost) return { ok: false, error: `Pitching costs ${usd(a.cost)} in travel and materials.` };
  companyTxn(state, 'marketing', -a.cost, `Pitch to ${p.name}`);
  p.status = 'pitched';
  p.pitchDay = state.clock.day;
  p.resolveDay = state.clock.day + 2 + (p.type === 'pension' || p.type === 'institution' ? 2 : 0);
  return { ok: true };
}

export function declineProspect(state: GameState, prospectId: string) {
  const p = state.prospects.find((x) => x.id === prospectId);
  if (p && p.status === 'open') p.status = 'declined';
}

export function resolvePitches(state: GameState) {
  const rng = new Rng(state.rng.clients);
  for (const p of state.prospects) {
    if (p.status !== 'pitched' || (p.resolveDay ?? 0) > state.clock.day) continue;
    const a = assessPitch(state, p);
    if (rng.chance(a.probability)) {
      p.status = 'won';
      const navpu = summarize(state).navPerUnit;
      const d = DIFFICULTIES[state.setup.difficulty];
      const c = makeClient(state, rng, p.type, 0, navpu, d.clientExpectation);
      c.name = p.name;
      c.units = 0;
      c.netContributed = 0;
      c.expectedReturn = p.expectedReturn;
      c.mgmtFee = p.mgmtFee;
      c.perfFee = p.perfFee;
      c.mandate = { ...p.mandate };
      c.history = [{ day: state.clock.day, date: state.clock.date, text: `Won mandate: ${usd(p.amount)} committed` }];
      state.clients.push(c);
      scheduleFlow(state, c.id, 'subscription', p.amount, state.clock.day + 1);
      state.stats.wonClients++;
      notify(state, 'success', 'Mandate won!', `${p.name} will invest ${usd(p.amount)} at tomorrow's close.`, { link: { screen: 'clients', id: c.id }, sound: 'cash' });
      logKeyEvent(state, `Won ${usd(p.amount)} mandate from ${p.name}`);
      pushNews(state, { templateId: 'client_win', category: 'client', headline: `${p.name} allocates ${usd(p.amount)} to ${state.setup.fundName}`, body: `${state.setup.fundName} has won a new mandate from ${p.name}, a ${clientTypeLabel(p.type).toLowerCase()}.`, severity: 1, tone: 1, instruments: [], sectors: [] });
      state.reputation = Math.min(100, state.reputation + 0.5);
    } else {
      p.status = 'lost';
      const worst = [...a.factors].sort((x, y) => x.effect - y.effect)[0];
      notify(state, 'warning', 'Pitch unsuccessful', `${p.name} chose not to invest.${worst && worst.effect < 0 ? ` Main concern: ${worst.label}.` : ''}`, { link: { screen: 'clients' } });
    }
  }
}

/** Large unhappy clients ask for fee cuts; extended breaches trigger an institutional review. */
export function clientDecisions(state: GameState) {
  const rng = new Rng(state.rng.clients);
  if (state.decisions.some((d) => d.kind === 'feeRequest')) return;
  const navpu = summarize(state).navPerUnit;
  const nav = summarize(state).nav;
  const cands = state.clients.filter((c) => c.status === 'active' && c.type !== 'founder' && c.confidence < 48 && c.confidence > 20 && clientValue(c, navpu) > nav * 0.12 && state.clock.day - c.lastConcessionDay > 60);
  if (cands.length && rng.chance(0.08)) {
    const c = rng.pick(cands);
    state.decisions.push({
      id: nextId(state, 'misc', 'D'), kind: 'feeRequest', title: `${c.name} requests a fee reduction`,
      text: `${c.name} (${usd(clientValue(c, navpu))}, confidence ${Math.round(c.confidence)}) wants lower fees to stay invested. Current terms: ${(c.mgmtFee * 100).toFixed(2)}% management / ${(c.perfFee * 100).toFixed(1)}% performance.`,
      day: state.clock.day, expiresDay: state.clock.day + 3, subject: c.id,
      options: [
        { id: 'accept', label: 'Grant concession', detail: '−0.25% management, −2.5% performance fee. Confidence +14.' },
        { id: 'refuse', label: 'Hold firm on fees', detail: 'Keeps revenue, but confidence −8 and redemption risk rises.' },
      ],
    });
    notify(state, 'warning', 'Client request', `${c.name} is asking for a fee reduction.`, { link: { screen: 'business' }, sound: 'alert' });
  }
}
