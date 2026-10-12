/**
 * Central game-balance parameters. Everything tunable lives here or in
 * difficulty.ts / presets.ts / sectors.ts so balancing never requires
 * hunting through simulation modules.
 */
export const BALANCE = {
  tradingDaysPerYear: 252,
  /** days of synthetic daily history generated before the first playable day */
  preHistoryDays: 260,
  /** days run through the full minute engine before the first playable day */
  warmupDays: 3,

  market: {
    /** daily vol of the market factor */
    marketVol: 0.0085,
    /** daily vol of each sector factor */
    sectorVol: 0.0065,
    /** baseline daily equity drift (~7.5%/yr) */
    baseDrift: 0.0003,
    /** fraction of fair-value gap closed per day */
    fairValuePull: 0.01,
    /** max |log-return| from noise in a single minute */
    maxMinuteMove: 0.06,
    /** overnight noise as fraction of daily vol */
    overnightVolFrac: 0.35,
    /** ETF tracking noise (daily) */
    etfTrackingVol: 0.0008,
    /** minimum price floor */
    minPrice: 0.5,
  },

  trading: {
    /** commission in basis points of notional */
    commissionBps: 1.5,
    /** minimum commission in dollars */
    minCommission: 1,
    /** square-root impact coefficient (fraction of daily vol per sqrt(participation of ADV)) */
    impactCoef: 0.6,
    /** max order size as fraction of ADV */
    maxAdvFraction: 0.1,
    /** annual financing rate spread over policy rate for margin debit */
    financingSpread: 0.015,
    /** fraction of policy rate paid on positive free cash */
    cashInterestShare: 0.6,
  },

  margin: {
    equity: { initial: 0.5, maintenance: 0.3, shortInitial: 0.5, shortMaintenance: 0.35 },
    etf: { initial: 0.4, maintenance: 0.25, shortInitial: 0.45, shortMaintenance: 0.3 },
    commodity: { initial: 0.2, maintenance: 0.15, shortInitial: 0.2, shortMaintenance: 0.15 },
  },

  risk: {
    maxPositionWeight: 0.2,
    maxSectorWeight: 0.4,
    maxMarginUtilisation: 0.8,
    minLiquidity: 0.05,
  },

  fees: {
    managementFee: 0.02,
    performanceFee: 0.2,
    /** crystallisation period for performance fees, in trading days */
    performancePeriod: 21,
  },

  company: {
    techCostPerYear: 18_000,
    /** per-employee tech/benefit overhead (annual) */
    perHeadOverhead: 12_000,
    severanceMonths: 2,
    signingBonusFrac: 0.1,
    creditLineMultiple: 0.5, // of annual revenue run-rate, min 250k
    creditLineRate: 0.12,
  },

  clients: {
    callCooldownDays: 10,
    dinnerCooldownDays: 20,
    dinnerCost: 6_000,
    letterCooldownDays: 20,
    prospectBaseRate: 0.09,
    /** minimum fund size before collapse wind-down */
    minViableFund: 1_000_000,
  },

  autosaveEveryMinutes: 60,
  newsCap: 400,
  orderHistoryCap: 3000,
  notificationsCap: 120,
} as const;

export const OFFICES = [
  { tier: 0, name: 'Co-working desk', rentPerYear: 30_000, capacity: 2, appeal: 0, reputation: 0, fitOut: 0 },
  { tier: 1, name: 'Boutique office', rentPerYear: 110_000, capacity: 5, appeal: 0.1, reputation: 3, fitOut: 60_000 },
  { tier: 2, name: 'Midtown floor', rentPerYear: 360_000, capacity: 10, appeal: 0.22, reputation: 7, fitOut: 220_000 },
  { tier: 3, name: 'Tower suite', rentPerYear: 950_000, capacity: 18, appeal: 0.36, reputation: 12, fitOut: 700_000 },
  { tier: 4, name: 'Global headquarters', rentPerYear: 2_600_000, capacity: 32, appeal: 0.5, reputation: 18, fitOut: 2_000_000 },
] as const;

export type AutomationId = 'riskMonitor' | 'autoRebalance' | 'stopProtection' | 'dailyReview';

export const AUTOMATIONS: Record<AutomationId, { name: string; description: string; setup: number; perYear: number; requiresPm: boolean }> = {
  riskMonitor: { name: 'Risk monitor', description: 'Blocks orders that would breach position, sector or exposure limits, and auto-trims margin breaches before the prime broker does (avoiding forced-liquidation penalties).', setup: 25_000, perYear: 30_000, requiresPm: false },
  autoRebalance: { name: 'Auto-rebalancer', description: 'At each open, places market orders to bring holdings back within the drift band of your target allocations.', setup: 40_000, perYear: 45_000, requiresPm: true },
  stopProtection: { name: 'Stop protection', description: 'Automatically attaches a protective stop order to every new position at your chosen distance.', setup: 15_000, perYear: 20_000, requiresPm: false },
  dailyReview: { name: 'Portfolio review desk', description: 'A daily review flags concentrated positions, upcoming earnings on holdings and large unrealised losses in the end-of-day report.', setup: 10_000, perYear: 15_000, requiresPm: true },
};
