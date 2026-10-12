import { summarize } from '../game/accounting';
import type { GameState } from '../game/types';
import { idbGet, idbWrite, STORES } from './idb';

export interface CareerEntry {
  gameId: string;
  fundName: string;
  difficulty: string;
  preset: string;
  logo?: GameState['setup']['logo'];
  startedAt: number;
  updatedAt: number;
  status: string;
  cause?: string;
  reason?: string;
  days: number;
  finalNav: number;
  peakAum: number;
  totalReturn: number;
  maxDrawdown: number;
  bestInvestment?: { id: string; pnl: number };
  worstInvestment?: { id: string; pnl: number };
}

export interface Profile {
  version: 1;
  achievements: Record<string, { unlockedAt: number; fund: string }>;
  career: CareerEntry[];
  updatedAt: number;
}

const KEY = 'profile';

export function emptyProfile(): Profile {
  return { version: 1, achievements: {}, career: [], updatedAt: Date.now() };
}

export async function loadProfile(): Promise<Profile> {
  try {
    const p = await idbGet<Profile>(STORES.profile, KEY);
    if (p && p.version === 1 && Array.isArray(p.career)) return p;
  } catch { /* fall through */ }
  return emptyProfile();
}

export async function saveProfile(p: Profile): Promise<void> {
  p.updatedAt = Date.now();
  await idbWrite(STORES.profile, [{ put: [KEY, p] }]);
}

export function careerEntryFor(state: GameState): CareerEntry {
  const s = summarize(state);
  const pnl = Object.entries(state.fund.instrumentPnl);
  for (const p of s.positions) {
    const i = pnl.findIndex(([id]) => id === p.id);
    if (i >= 0) pnl[i] = [p.id, pnl[i][1] + p.unrealized];
    else pnl.push([p.id, p.unrealized]);
  }
  pnl.sort((a, b) => b[1] - a[1]);
  return {
    gameId: state.id, fundName: state.setup.fundName, difficulty: state.setup.difficulty, preset: state.setup.preset, logo: state.setup.logo,
    startedAt: state.createdAt, updatedAt: Date.now(), status: state.status, cause: state.failure?.cause, reason: state.failure?.reason,
    days: state.daily.length, finalNav: s.nav, peakAum: state.stats.peakAum, totalReturn: s.navPerUnit / 100 - 1, maxDrawdown: state.stats.maxDrawdown,
    bestInvestment: pnl.length ? { id: pnl[0][0], pnl: pnl[0][1] } : undefined,
    worstInvestment: pnl.length ? { id: pnl[pnl.length - 1][0], pnl: pnl[pnl.length - 1][1] } : undefined,
  };
}

/** Merge a run's achievements and career record into the persistent profile. */
export function mergeRun(p: Profile, state: GameState): Profile {
  for (const a of state.achievements) if (!p.achievements[a]) p.achievements[a] = { unlockedAt: Date.now(), fund: state.setup.fundName };
  const e = careerEntryFor(state);
  const i = p.career.findIndex((c) => c.gameId === e.gameId);
  if (i >= 0) p.career[i] = { ...e, startedAt: p.career[i].startedAt };
  else p.career.push(e);
  return p;
}
