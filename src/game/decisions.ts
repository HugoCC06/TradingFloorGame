import { feeConcession } from './clients';
import { notify, logKeyEvent } from './notify';
import type { GameState } from './types';

export function resolveDecision(state: GameState, decisionId: string, optionId: string): { ok: boolean; error?: string } {
  const d = state.decisions.find((x) => x.id === decisionId);
  if (!d) return { ok: false, error: 'Decision no longer pending.' };
  state.decisions = state.decisions.filter((x) => x.id !== decisionId);
  switch (d.kind) {
    case 'poach': {
      const e = state.staff.find((x) => x.id === d.subject);
      if (!e) break;
      if (optionId === 'match') {
        e.salary = Math.round(e.salary * 1.25);
        notify(state, 'info', 'Offer matched', `${e.name} stays with a 25% raise.`, { link: { screen: 'team' } });
      } else {
        state.staff = state.staff.filter((x) => x.id !== e.id);
        notify(state, 'warning', 'Employee departed', `${e.name} has joined a rival fund.`, { link: { screen: 'team' } });
        logKeyEvent(state, `${e.name} was poached by a rival`);
      }
      break;
    }
    case 'feeRequest': {
      const c = state.clients.find((x) => x.id === d.subject);
      if (!c) break;
      if (optionId === 'accept') {
        c.lastConcessionDay = -999;
        feeConcession(state, c.id);
      } else {
        c.confidence = Math.max(0, c.confidence - 8);
        c.history.push({ day: state.clock.day, date: state.clock.date, text: 'Fee reduction request refused (−8)', delta: -8 });
      }
      break;
    }
    case 'review': {
      if (optionId === 'commit') {
        state.risk.enforcePreTrade = true;
        for (const c of state.clients) if (c.status !== 'departed' && c.type !== 'founder') c.confidence = Math.min(100, c.confidence + 4);
        notify(state, 'info', 'Limits enforced', 'Pre-trade risk checks will now block orders that breach limits.', { link: { screen: 'risk' } });
      } else {
        for (const c of state.clients) if (['pension', 'institution', 'corporate'].includes(c.type)) c.confidence = Math.max(0, c.confidence - 6);
        state.reputation = Math.max(0, state.reputation - 2);
      }
      break;
    }
    case 'winddown':
      break;
  }
  return { ok: true };
}

/** Auto-resolve expired decisions with their default (passive) option. */
export function expireDecisions(state: GameState) {
  for (const d of [...state.decisions]) {
    if (d.expiresDay >= state.clock.day) continue;
    const passive = d.kind === 'poach' ? 'release' : d.kind === 'feeRequest' ? 'refuse' : 'defend';
    resolveDecision(state, d.id, passive);
    notify(state, 'warning', 'Decision expired', `No response to "${d.title}". The default outcome applied.`, { link: { screen: 'business' } });
  }
}
