import { toCents } from './accounting';
import { notify } from './notify';
import { sinceInception, trailingReturn } from './performance';
import type { GameState } from './types';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  check: (s: GameState, nav: number) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_trade', name: 'Open for Business', description: 'Execute your first trade.', check: (s) => s.stats.trades > 0 },
  { id: 'first_profit_day', name: 'In the Green', description: 'Finish a trading day with a positive return.', check: (s) => s.stats.profitableDays > 0 },
  { id: 'first_short', name: 'Bear Necessities', description: 'Open your first short position.', check: (s) => s.stats.shorts > 0 },
  { id: 'first_hire', name: 'Building the Team', description: 'Hire your first employee.', check: (s) => s.stats.hires > 0 },
  { id: 'first_client', name: 'Trusted Steward', description: 'Win a new investor mandate.', check: (s) => s.stats.wonClients > 0 },
  { id: 'profit_1m', name: 'Seven Figures', description: 'Generate $1 million of cumulative investment profit.', check: (s) => s.fund.totals.realized + unrealizedApprox(s) >= toCents(1_000_000) },
  { id: 'fees_1m', name: 'First Million in Fees', description: 'Earn $1 million of fee revenue for the management company.', check: (s) => s.company.totals.revenue >= toCents(1_000_000) },
  { id: 'aum_10m', name: 'Ten Million Club', description: 'Reach $10 million in AUM.', check: (s, nav) => grew(s, nav, 10e6) },
  { id: 'aum_50m', name: 'Serious Money', description: 'Reach $50 million in AUM.', check: (s, nav) => grew(s, nav, 50e6) },
  { id: 'aum_100m', name: 'Nine Figures', description: 'Reach $100 million in AUM.', check: (s, nav) => grew(s, nav, 100e6) },
  { id: 'aum_500m', name: 'Institutional Grade', description: 'Reach $500 million in AUM.', check: (s, nav) => grew(s, nav, 500e6) },
  { id: 'aum_1b', name: 'Billion-Dollar Fund', description: 'Reach $1 billion in AUM.', check: (s, nav) => grew(s, nav, 1e9) },
  { id: 'recovery', name: 'Comeback', description: 'Recover from a drawdown of at least 10% to a new high.', check: (s) => s.stats.recoveredFromDrawdown },
  { id: 'annual_25', name: 'Stellar Year', description: 'Return 25% or more over any 252-day window.', check: (s) => s.daily.length >= 252 && trailingReturn(s, 252) >= 0.25 },
  { id: 'beat_bench', name: 'Alpha Generator', description: 'Beat the benchmark by 5% since inception (after 60 days).', check: (s) => s.daily.length >= 60 && sinceInception(s) - benchSince(s) > 0.05 },
  { id: 'survive_63', name: 'One Quarter Down', description: 'Survive 63 trading days.', check: (s) => s.daily.length >= 63 },
  { id: 'survive_252', name: 'First Anniversary', description: 'Survive a full year (252 trading days).', check: (s) => s.daily.length >= 252 },
  { id: 'survive_756', name: 'Seasoned Manager', description: 'Survive three years (756 trading days).', check: (s) => s.daily.length >= 756 },
  { id: 'clean_month', name: 'Disciplined', description: 'Go 21 trading days without a risk breach.', check: (s) => s.risk.cleanDays >= 21 && s.daily.length >= 21 },
  { id: 'top_rival', name: 'Top of the Table', description: 'Lead every rival on 60-day return (after 60 days).', check: (s) => s.daily.length >= 60 && s.rivals.every((r) => r.history.length > 60 && trailingReturn(s, 60) > r.navPerUnit / r.history[r.history.length - 61].navPerUnit - 1) },
  { id: 'office_3', name: 'Corner Office', description: 'Move into a Tower suite.', check: (s) => s.company.officeTier >= 3 },
  { id: 'trades_100', name: 'Active Trader', description: 'Execute 100 trades.', check: (s) => s.stats.trades >= 100 },
  { id: 'crisis_survivor', name: 'Storm Survivor', description: 'Finish a day during a financial crisis with a positive return (Hard).', check: (s) => s.macro.regime === 'crisis' && (s.daily[s.daily.length - 1]?.dailyReturn ?? 0) > 0 },
  { id: 'pension', name: 'Pension Approved', description: 'Win a pension fund as a client.', check: (s) => s.clients.some((c) => c.type === 'pension' && c.status !== 'departed') },
];

/** AUM milestone reached through growth, not simply by starting above it. */
function grew(s: GameState, nav: number, dollars: number) {
  return nav >= toCents(dollars) && s.stats.startNav < toCents(dollars);
}

function unrealizedApprox(s: GameState) {
  let u = 0;
  for (const p of Object.values(s.fund.positions)) {
    const inst = s.instruments.find((i) => i.id === p.instrument);
    if (inst) u += Math.round(p.qty * (inst.price - p.avgPrice) * 100);
  }
  return u;
}

function benchSince(s: GameState) {
  const first = s.daily[0];
  if (!first) return 0;
  const base = first.benchmark / (1 + first.benchmarkReturn);
  return s.instruments[s.benchmarkIdx].price / base - 1;
}

/** Check and unlock achievements; returns newly unlocked ids. */
export function checkAchievements(state: GameState, nav: number): string[] {
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements.includes(a.id)) continue;
    try {
      if (a.check(state, nav)) {
        state.achievements.push(a.id);
        unlocked.push(a.id);
        notify(state, 'achievement', `Achievement unlocked: ${a.name}`, a.description, { link: { screen: 'achievements' }, sound: 'achievement' });
      }
    } catch {
      /* ignore checks on partial state */
    }
  }
  return unlocked;
}
