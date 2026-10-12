import { BALANCE, OFFICES } from '../config/balance';
import { DIFFICULTIES } from '../config/difficulty';
import { SECTORS } from '../config/sectors';
import { toCents } from './accounting';
import { personName } from './names';
import { nextId, notify, logKeyEvent } from './notify';
import { Rng } from './rng';
import type { Candidate, Employee, GameState, StaffRole } from './types';
import { companyTxn } from './company';

export const ROLE_INFO: Record<StaffRole, { name: string; plural: string; benefit: string }> = {
  analyst: { name: 'Analyst', plural: 'Analysts', benefit: 'Research coverage: fair-value estimates, ratings and earnings previews for covered sectors. Higher skill = more accurate.' },
  pm: { name: 'Portfolio Manager', plural: 'Portfolio Managers', benefit: 'Better execution (lower spread and impact costs), unlocks auto-rebalancing and the review desk, and risk oversight reassures clients.' },
  ir: { name: 'Investor Relations', plural: 'Investor Relations', benefit: 'More and better investor prospects, higher pitch success, stronger client calls and lower redemption risk.' },
};

const PM_SPECS = ['execution', 'risk', 'macro'];
const IR_SPECS = ['institutional', 'private wealth', 'consultants'];

export function salaryFor(role: StaffRole, skill: number, experience: number): number {
  const base = { analyst: 85_000 + skill * 2_100 + experience * 5_500, pm: 130_000 + skill * 3_000 + experience * 8_000, ir: 75_000 + skill * 1_900 + experience * 5_000 }[role];
  return Math.round(base / 1000) * 1000;
}

export function generateCandidate(state: GameState, rng: Rng, role?: StaffRole, skillHint?: number): Candidate {
  const r: StaffRole = role ?? rng.pick(['analyst', 'analyst', 'pm', 'ir'] as StaffRole[]);
  const office = OFFICES[state.company.officeTier];
  const draw = 35 + office.tier * 5 + (state.reputation - 40) * 0.2 + rng.normal() * 14;
  const skill = Math.round(Math.max(15, Math.min(92, skillHint ?? draw)));
  const experience = Math.max(1, Math.round(skill / 10 + rng.normal() * 2.5));
  const specs: string[] = [];
  if (r === 'analyst') {
    const a = rng.pick(SECTORS).id;
    specs.push(a);
    if (rng.chance(0.45)) {
      const b = rng.pick(SECTORS).id;
      if (b !== a) specs.push(b);
    }
  } else if (r === 'pm') specs.push(rng.pick(PM_SPECS));
  else specs.push(rng.pick(IR_SPECS));
  const salary = salaryFor(r, skill, experience) * (0.9 + rng.next() * 0.25);
  const sal = Math.round(salary / 1000) * 1000;
  return {
    id: nextId(state, 'misc', 'E'),
    name: personName(rng),
    role: r,
    skill,
    potential: Math.min(98, skill + Math.round(5 + rng.next() * 20 - experience * 0.5)),
    experience,
    salary: toCents(sal),
    specialisations: specs,
    level: skill > 75 ? 3 : skill > 55 ? 2 : 1,
    hiringCost: toCents(sal * BALANCE.company.signingBonusFrac + 4_000),
    expiresDay: state.clock.day + 5 + rng.int(0, 5),
  };
}

export function refreshCandidates(state: GameState, force = false) {
  const rng = new Rng(state.rng.misc);
  state.candidates = state.candidates.filter((c) => c.expiresDay > state.clock.day);
  const want = 6;
  if (force) state.candidates = [];
  let guard = 0;
  while (state.candidates.length < want && guard++ < 20) {
    const roleCounts = { analyst: 0, pm: 0, ir: 0 };
    for (const c of state.candidates) roleCounts[c.role]++;
    const role: StaffRole | undefined = roleCounts.analyst === 0 ? 'analyst' : roleCounts.pm === 0 ? 'pm' : roleCounts.ir === 0 ? 'ir' : undefined;
    state.candidates.push(generateCandidate(state, rng, role));
  }
}

export function headcountCapacity(state: GameState): number {
  return OFFICES[state.company.officeTier].capacity;
}

export function hire(state: GameState, candidateId: string): { ok: boolean; error?: string } {
  const c = state.candidates.find((x) => x.id === candidateId);
  if (!c) return { ok: false, error: 'Candidate is no longer available.' };
  if (state.staff.length >= headcountCapacity(state)) return { ok: false, error: `Office is at capacity (${headcountCapacity(state)} staff). Upgrade your office first.` };
  if (state.company.cash < c.hiringCost) return { ok: false, error: 'The management company cannot afford the hiring cost.' };
  companyTxn(state, 'hiring', -c.hiringCost, `Hired ${c.name} (${ROLE_INFO[c.role].name})`);
  const { hiringCost: _h, expiresDay: _e, ...rest } = c;
  const emp: Employee = { ...rest, hiredDay: state.clock.day };
  state.staff.push(emp);
  state.candidates = state.candidates.filter((x) => x.id !== candidateId);
  state.stats.hires++;
  notify(state, 'success', 'New hire', `${emp.name} joins as ${ROLE_INFO[emp.role].name}.`, { link: { screen: 'team' }, sound: 'cash' });
  logKeyEvent(state, `Hired ${emp.name} (${ROLE_INFO[emp.role].name}, skill ${emp.skill})`);
  return { ok: true };
}

export function severanceFor(e: Employee): number {
  return Math.round((e.salary * BALANCE.company.severanceMonths) / 12);
}

export function dismiss(state: GameState, employeeId: string): { ok: boolean; error?: string } {
  const e = state.staff.find((x) => x.id === employeeId);
  if (!e) return { ok: false, error: 'Employee not found.' };
  const sev = severanceFor(e);
  companyTxn(state, 'severance', -sev, `Severance for ${e.name}`);
  state.staff = state.staff.filter((x) => x.id !== employeeId);
  notify(state, 'info', 'Employee dismissed', `${e.name} has left the firm.`, { link: { screen: 'team' } });
  return { ok: true };
}

export function promotionCost(e: Employee): number {
  return Math.round(e.salary * 0.2);
}

export function promote(state: GameState, employeeId: string): { ok: boolean; error?: string } {
  const e = state.staff.find((x) => x.id === employeeId);
  if (!e) return { ok: false, error: 'Employee not found.' };
  if (e.level >= 4) return { ok: false, error: 'Already at partner level.' };
  if (state.clock.day - e.hiredDay < 20) return { ok: false, error: 'Employees need at least 20 trading days at the firm before promotion.' };
  e.level++;
  e.salary += promotionCost(e);
  e.skill = Math.min(99, e.skill + 3);
  e.potential = Math.min(99, e.potential + 4);
  notify(state, 'success', 'Promotion', `${e.name} promoted to ${levelName(e.level)}.`, { link: { screen: 'team' } });
  return { ok: true };
}

export function levelName(level: number) {
  return ['Associate', 'Associate', 'Vice President', 'Director', 'Partner'][level] ?? 'Associate';
}

// ---- benefit functions (the only place staff effects are defined) ----

/** Best analyst coverage quality (0-100) for a sector. Specialists count fully; others at 40%. */
export function analystCoverage(state: GameState, sector: string): number {
  let best = 0;
  for (const e of state.staff) {
    if (e.role !== 'analyst') continue;
    const s = e.specialisations.includes(sector) ? e.skill : e.skill * 0.4;
    if (s > best) best = s;
  }
  return best;
}

/** Fractional reduction in spread and impact costs from portfolio managers. */
export function executionDiscount(state: GameState): number {
  let d = 0;
  for (const e of state.staff) if (e.role === 'pm') d += e.skill * (e.specialisations.includes('execution') ? 0.0055 : 0.0035);
  return Math.min(0.45, d);
}

export function irPower(state: GameState, clientType?: string): number {
  let p = 0;
  for (const e of state.staff) {
    if (e.role !== 'ir') continue;
    let w = e.skill / 100;
    if (clientType && ((e.specialisations.includes('institutional') && ['pension', 'institution', 'corporate'].includes(clientType)) || (e.specialisations.includes('private wealth') && ['hnw', 'family'].includes(clientType)))) w *= 1.4;
    if (e.specialisations.includes('consultants')) w *= 1.15;
    p += w;
  }
  return p;
}

export function riskOversight(state: GameState): number {
  let r = 0;
  for (const e of state.staff) if (e.role === 'pm') r += (e.skill / 100) * (e.specialisations.includes('risk') ? 1.5 : 0.6);
  return Math.min(1.5, r);
}

export function hasRole(state: GameState, role: StaffRole) {
  return state.staff.some((e) => e.role === role);
}

export function payrollPerYear(state: GameState): number {
  return state.staff.reduce((a, e) => a + e.salary, 0);
}

/** Daily staff development and rival poaching attempts. */
export function staffDaily(state: GameState) {
  const rng = new Rng(state.rng.misc);
  for (const e of state.staff) {
    e.skill = Math.min(e.potential, e.skill + Math.max(0, (e.potential - e.skill) * 0.003));
    e.experience += 1 / 252;
  }
  const d = DIFFICULTIES[state.setup.difficulty];
  if (state.staff.length && rng.chance(d.poachRate * state.staff.length) && !state.decisions.some((x) => x.kind === 'poach')) {
    const target = [...state.staff].sort((a, b) => b.skill - a.skill)[rng.int(0, Math.min(1, state.staff.length - 1))];
    const rival = rng.pick(state.rivals);
    const raise = Math.round(target.salary * 0.25);
    state.decisions.push({
      id: nextId(state, 'misc', 'D'),
      kind: 'poach',
      title: `${rival.name} is poaching ${target.name}`,
      text: `${rival.name} has offered ${target.name} (${ROLE_INFO[target.role].name}, skill ${Math.round(target.skill)}) a substantial package. Match it with a ${fmtUsd(raise / 100)} raise, or let them go.`,
      day: state.clock.day,
      expiresDay: state.clock.day + 2,
      subject: target.id,
      options: [
        { id: 'match', label: `Match offer (+${fmtUsd(raise / 100)}/yr)`, detail: 'Salary rises 25%. They stay.' },
        { id: 'release', label: 'Let them go', detail: 'They leave immediately; no severance due.' },
      ],
    });
    notify(state, 'warning', 'Poaching attempt', `${rival.name} wants to hire ${target.name}. Decide within 2 days.`, { link: { screen: 'business' }, sound: 'alert' });
  }
  if (state.clock.day % 5 === 0) refreshCandidates(state);
}

export function fmtUsd(x: number) {
  return '$' + Math.round(x).toLocaleString('en-US');
}
