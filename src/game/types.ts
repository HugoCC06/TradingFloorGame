import type { DifficultyId } from '../config/difficulty';
import type { PresetId } from '../config/presets';
import type { SectorId } from '../config/sectors';
import type { AutomationId } from '../config/balance';
import type { RngState } from './rng';
import type { SeriesData } from './series';

/** Money is held in integer cents throughout the ledgers. */
export type Cents = number;

export type InstrumentKind = 'equity' | 'etf' | 'commodity';
export type Phase = 'pre' | 'open' | 'closed';
export type GameStatus = 'active' | 'failed' | 'closed';

export interface Fundamentals {
  sharesOut: number;
  revenue: number; // annual, dollars
  earnings: number; // annual net income, dollars
  revGrowth: number; // trailing yoy
  epsGrowth: number;
  margin: number;
  debt: number;
  cash: number;
  dividendYield: number;
  /** 0-100 composite of margin, balance sheet and consistency */
  quality: number;
  /** market-implied long-run growth expectation */
  growthExpect: number;
  rateSens: number;
  growthSens: number;
  inflationSens: number;
  /** hidden intrinsic value per share the price slowly gravitates to */
  fairValue: number;
  /** hidden underlying business momentum (-1..1); drives earnings surprises */
  trend: number;
  /** consensus EPS for next quarterly report */
  consensusEps: number;
  /** trading day index of next earnings report */
  nextEarningsDay: number;
  earningsTiming: 'pre' | 'post';
  earningsHistory: { day: number; date: string; est: number; act: number; guidance: 'raised' | 'maintained' | 'cut' }[];
  /** quarterly EPS run-rate */
  quarterlyEps: number;
}

export interface EtfInfo {
  constituents: { idx: number; w: number }[];
  theme: string;
  expenseRatio: number;
}

export interface CommodityInfo {
  unit: string;
  driver: 'gold' | 'silver' | 'oil' | 'gas' | 'copper' | 'wheat';
  description: string;
  /** slowly-moving equilibrium price the commodity mean-reverts toward */
  anchor: number;
}

export interface Instrument {
  idx: number;
  id: string; // ticker
  kind: InstrumentKind;
  name: string;
  sector: SectorId | 'broad' | 'commodity';
  industry: string;
  description: string;
  price: number;
  prevClose: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  dayVolume: number;
  /** average daily volume (units) */
  adv: number;
  /** daily volatility (fraction) */
  vol: number;
  beta: number;
  sectorLoading: number;
  halfSpreadBps: number;
  shortable: boolean;
  /** annualised borrow fee for shorts */
  borrowFee: number;
  /** transient volatility multiplier from news; decays toward 1 */
  volBoost: number;
  /** -1..1 recent news tone, for display */
  newsTone: number;
  lastEventDay: number;
  /** systematic log-return accumulated today (market/sector/link/macro), rolled into fair value at close */
  sysAcc: number;
  /** id of an active multi-day story, suppresses unrelated random stories */
  activeStory: string | null;
  /** optional linkage to a commodity factor (e.g. oil for energy, gold for miners) */
  link?: { idx: number; load: number };
  fundamentals?: Fundamentals;
  etf?: EtfInfo;
  commodity?: CommodityInfo;
}

export interface MacroState {
  growth: number; // annual real GDP growth %, ~2
  inflation: number; // yoy %, ~2.5
  policyRate: number; // %, ~3
  expectedRate: number; // market-implied next policy rate
  sentiment: number; // -1..1
  credit: number; // credit spread %, ~1.5
  regime: 'bull' | 'neutral' | 'bear' | 'crisis';
  regimeDays: number;
  unemployment: number;
  /** extra drift (daily log) being applied to the broad market from recent macro shocks, decays */
  shockDrift: number;
  /** decaying daily drift factors from macro surprises, scaled by each company's sensitivities */
  rateShock: number;
  inflShock: number;
  growthShock: number;
  /** extra volatility multiplier from macro, decays toward 1 */
  volShock: number;
  oilSupply: number; // -1..1 supply tightness
  geopolitics: number; // 0..1 tension
  nextCpiDay: number;
  nextJobsDay: number;
  nextGdpDay: number;
  nextRateDay: number;
  history: { day: number; growth: number; inflation: number; policyRate: number; sentiment: number }[];
}

export interface SectorState {
  sentiment: number; // -1..1
  /** extra daily drift from sector events, decays */
  shockDrift: number;
}

export interface PendingImpact {
  idx: number; // instrument index
  /** remaining log-return still to be absorbed */
  remaining: number;
  /** fraction of remaining absorbed per minute */
  rate: number;
  /** multi-day residual daily drift (log) to apply at each subsequent open, decays */
  daysLeft: number;
  dailyDrift: number;
  source: string; // news id
}

export type NewsCategory =
  | 'breaking' | 'corporate' | 'earnings' | 'economic' | 'centralbank' | 'sector'
  | 'commodity' | 'competitor' | 'client' | 'market' | 'firm';

export interface NewsItem {
  id: string;
  templateId: string;
  category: NewsCategory;
  headline: string;
  body: string;
  day: number;
  date: string;
  minute: number; // -1 = overnight / pre-market, 390 = after close
  severity: 1 | 2 | 3 | 4; // minor, notable, major, critical
  tone: number; // -1..1 intended direction for primary subject
  instruments: string[]; // tickers affected
  sectors: SectorId[];
  macro?: string[];
  explanation?: string;
  storyId?: string;
  read: boolean;
}

export interface ScheduledEvent {
  id: string;
  kind: 'earnings' | 'cpi' | 'jobs' | 'gdp' | 'rate' | 'followup';
  day: number;
  /** minute index; -1 = before open (gap), 390 = after close */
  minute: number;
  instrument?: string;
  templateId?: string;
  storyId?: string;
  payload?: Record<string, number | string>;
  label: string;
}

export type OrderType = 'market' | 'limit' | 'stop';
export type OrderSide = 'buy' | 'sell' | 'short' | 'cover';
export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'rejected' | 'expired';
export type OrderOrigin = 'player' | 'auto-rebalance' | 'stop-protection' | 'forced-liquidation' | 'redemption' | 'risk-monitor';

export interface Order {
  id: string;
  instrument: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  tif: 'day' | 'gtc';
  status: OrderStatus;
  createdDay: number;
  createdMinute: number;
  createdDate: string;
  filledDay?: number;
  filledMinute?: number;
  fillPrice?: number;
  commission?: Cents;
  slippageCost?: Cents;
  reason?: string;
  origin: OrderOrigin;
  triggered?: boolean;
  /** price at submission for audit */
  refPrice: number;
}

export interface Fill {
  id: string;
  orderId: string;
  instrument: string;
  side: OrderSide;
  quantity: number;
  price: number;
  notional: Cents;
  commission: Cents;
  /** cost vs mid price from spread+impact, informational (already in price) */
  slippageCost: Cents;
  realizedPnl: Cents;
  day: number;
  minute: number;
  date: string;
  origin: OrderOrigin;
}

export interface Position {
  instrument: string;
  /** signed quantity: positive long, negative short */
  qty: number;
  /** average entry price per unit */
  avgPrice: number;
  realized: Cents;
  openedDay: number;
}

export interface FundLedger {
  /**
   * Fund cash in cents. Includes short-sale proceeds, which are restricted as
   * collateral (see shortCollateral()). Free cash = cash - collateral; negative free cash is a margin loan.
   */
  cash: Cents;
  positions: Record<string, Position>;
  unitsOutstanding: number;
  lastCrystallisationDay: number;
  /** cumulative accounting (cents) */
  totals: {
    realized: Cents;
    commissions: Cents;
    slippage: Cents;
    borrowFees: Cents;
    financing: Cents;
    interestEarned: Cents;
    managementFees: Cents;
    performanceFees: Cents;
    subscriptions: Cents;
    redemptions: Cents;
    dividends: Cents;
  };
  /** NAV per unit at previous close, for daily return */
  prevNavPerUnit: number;
  peakNavPerUnit: number;
  peakNav: Cents;
  /** instrument-level realised P&L history for best/worst investment */
  instrumentPnl: Record<string, Cents>;
}

export interface DailyRecord {
  day: number;
  date: string;
  nav: Cents;
  navPerUnit: number;
  benchmark: number; // benchmark level (index)
  dailyReturn: number;
  benchmarkReturn: number;
  drawdown: number;
  grossExposure: Cents;
  netExposure: Cents;
  subscriptions: Cents;
  redemptions: Cents;
  mgmtFees: Cents;
  perfFees: Cents;
  companyCash: Cents;
  companyRevenue: Cents;
  companyExpenses: Cents;
  clients: number;
  reputation: number;
  pnl: Cents;
  /** cumulative index of a representative 2/20 investor's net-of-fee return */
  netIndex: number;
}

export type ClientType = 'hnw' | 'family' | 'pension' | 'institution' | 'corporate' | 'founder';

export interface ClientEvent {
  day: number;
  date: string;
  text: string;
  delta?: number;
}

export interface Client {
  id: string;
  name: string;
  type: ClientType;
  units: number;
  /** total contributed capital net of redemptions (cents) for display */
  netContributed: Cents;
  initialDay: number;
  riskTolerance: number; // 0..1
  expectedReturn: number; // annual fraction
  drawdownTolerance: number; // fraction
  withdrawalSensitivity: number; // 0.5..2
  horizonDays: number;
  noticeDays: number;
  confidence: number; // 0..100
  relationship: number; // 0..100 quality of personal relationship
  mgmtFee: number;
  perfFee: number;
  /** per-client high-water mark (NAV per unit) for performance fees */
  hwm: number;
  status: 'active' | 'redeeming' | 'departed';
  concerns: string[];
  history: ClientEvent[];
  lastCallDay: number;
  lastDinnerDay: number;
  /** structured mandate terms the client monitors (shown as restrictions) */
  mandate: { maxGross?: number; maxDrawdown?: number; maxShare?: number };
  lastConcessionDay: number;
  /** units already requested for redemption (pending) */
  pendingRedemptionUnits: number;
}

export interface Prospect {
  id: string;
  name: string;
  type: ClientType;
  amount: Cents;
  expectedReturn: number;
  drawdownTolerance: number;
  riskTolerance: number;
  expiresDay: number;
  createdDay: number;
  minTrackDays: number;
  minAum: Cents;
  mandate: { maxGross?: number; maxDrawdown?: number; maxShare?: number };
  mgmtFee: number;
  perfFee: number;
  status: 'open' | 'pitched' | 'won' | 'lost' | 'declined' | 'expired';
  pitchDay?: number;
  /** decision settles on this day after a pitch */
  resolveDay?: number;
  note: string;
}

export interface CapitalFlow {
  id: string;
  clientId: string;
  kind: 'subscription' | 'redemption';
  /** for subscriptions: cents; for redemptions: units */
  amount: number;
  requestedDay: number;
  effectiveDay: number;
  status: 'pending' | 'settled' | 'cancelled';
  settledValue?: Cents;
}

export type RivalStrategy = 'conservative' | 'growth' | 'value' | 'macro' | 'tech' | 'momentum' | 'quant';

export interface Rival {
  id: string;
  name: string;
  short: string;
  color: string;
  strategy: RivalStrategy;
  description: string;
  manager: string;
  aum: Cents;
  navPerUnit: number;
  peakNavPerUnit: number;
  reputation: number;
  riskAppetite: number; // gross leverage target
  holdings: { idx: number; w: number }[];
  lastRebalanceDay: number;
  rebalanceEvery: number;
  clients: number;
  history: { day: number; navPerUnit: number; aum: Cents }[];
  /** annual fee drag */
  feeDrag: number;
  /** risk-off flag when cutting exposure */
  derisked: boolean;
}

export type StaffRole = 'analyst' | 'pm' | 'ir';

export interface Employee {
  id: string;
  name: string;
  role: StaffRole;
  skill: number; // 1-100
  potential: number;
  experience: number; // years
  salary: Cents; // annual
  specialisations: string[];
  hiredDay: number;
  level: number; // 1 junior .. 4 partner
}

export interface Candidate extends Omit<Employee, 'hiredDay'> {
  hiringCost: Cents;
  expiresDay: number;
}

export interface CompanyTxn {
  day: number;
  date: string;
  kind: 'mgmtFee' | 'perfFee' | 'salary' | 'rent' | 'tech' | 'marketing' | 'hiring' | 'severance' | 'upgrade' | 'automation' | 'client' | 'credit' | 'interest' | 'other';
  amount: Cents; // signed
  memo: string;
}

export interface CompanyLedger {
  cash: Cents;
  officeTier: number;
  creditDrawn: Cents;
  creditLimit: Cents;
  marketingPerYear: Cents;
  insolventDays: number;
  ledger: CompanyTxn[];
  totals: { revenue: Cents; mgmtFees: Cents; perfFees: Cents; expenses: Cents };
  automations: Partial<Record<AutomationId, { enabled: boolean; installedDay: number }>>;
  stopProtectionPct: number;
  rebalanceBand: number;
}

export interface RiskLimits {
  maxPositionWeight: number;
  maxSectorWeight: number;
  maxGross: number;
  maxMarginUtilisation: number;
  minLiquidity: number;
}

export interface RiskBreach {
  id: string;
  rule: 'position' | 'sector' | 'gross' | 'margin' | 'liquidity' | 'drawdown';
  severity: 'warning' | 'breach' | 'critical';
  title: string;
  detail: string;
  instruments: string[];
  value: number;
  limit: number;
  actions: string[];
}

export interface RiskState {
  limits: RiskLimits;
  enforcePreTrade: boolean;
  breaches: RiskBreach[];
  breachStreak: number;
  totalBreachDays: number;
  cleanDays: number;
  marginCalls: number;
  lastMarginCallDay: number;
}

export interface Notification {
  id: string;
  day: number;
  minute: number;
  kind: 'info' | 'success' | 'warning' | 'danger' | 'achievement';
  title: string;
  text: string;
  link?: { screen: string; id?: string };
  /** UI hint for an accompanying sound effect */
  sound?: 'order' | 'reject' | 'news' | 'open' | 'close' | 'alert' | 'achievement' | 'cash';
  /** whether the UI should raise a toast for it */
  toast: boolean;
  read: boolean;
}

export interface Decision {
  id: string;
  kind: 'poach' | 'feeRequest' | 'review' | 'winddown';
  title: string;
  text: string;
  day: number;
  expiresDay: number;
  subject?: string;
  options: { id: string; label: string; detail: string }[];
}

export interface EodReport {
  day: number;
  date: string;
  navStart: Cents;
  navEnd: Cents;
  pnl: Cents;
  dailyReturn: number;
  benchmarkReturn: number;
  winners: { id: string; pnl: Cents; change: number }[];
  losers: { id: string; pnl: Cents; change: number }[];
  marketMovers: { id: string; change: number }[];
  news: string[]; // news ids
  fills: string[]; // fill ids
  riskNotes: string[];
  clientNotes: string[];
  companyNotes: string[];
  rivalNotes: { id: string; ret: number }[];
  upcoming: string[]; // scheduled event ids
  reviewNotes: string[];
}

export interface RunStats {
  /** NAV on the first day, for growth-based milestones */
  startNav: Cents;
  peakNav: Cents;
  peakAum: Cents;
  maxDrawdown: number;
  bestDay: number;
  worstDay: number;
  trades: number;
  shorts: number;
  profitableDays: number;
  daysPlayed: number;
  wonClients: number;
  lostClients: number;
  hires: number;
  recoveredFromDrawdown: boolean;
  maxDrawdownSinceHigh: number;
  keyEvents: { day: number; date: string; text: string }[];
}

export interface FailureReport {
  reason: string;
  cause: 'drawdown' | 'margin' | 'redemptions' | 'insolvency' | 'confidence' | 'voluntary' | 'tooSmall';
  day: number;
  date: string;
}

export interface GameSetup {
  fundName: string;
  description: string;
  logo: { mark: string; color: string; accent: string };
  difficulty: DifficultyId;
  preset: PresetId;
  tutorial: boolean;
  seed: number;
}

export interface Clock {
  day: number;
  date: string;
  minute: number; // minutes elapsed in the session (0..390)
  phase: Phase;
}

export interface MarketHistory {
  /** 1-minute bars: current + previous session */
  m1: SeriesData[];
  /** 15-minute bars: ~10 sessions */
  m15: SeriesData[];
  /** hourly bars: ~60 sessions */
  h1: SeriesData[];
  /** daily bars: full history */
  d1: SeriesData[];
}

export interface GameState {
  schema: number;
  id: string;
  createdAt: number;
  updatedAt: number;
  setup: GameSetup;
  rng: { market: RngState; events: RngState; clients: RngState; misc: RngState };
  clock: Clock;
  startDay: number;
  macro: MacroState;
  sectors: Record<string, SectorState>;
  instruments: Instrument[];
  history: MarketHistory;
  benchmarkIdx: number;
  news: NewsItem[];
  scheduled: ScheduledEvent[];
  impacts: PendingImpact[];
  fund: FundLedger;
  orders: Order[];
  fills: Fill[];
  company: CompanyLedger;
  clients: Client[];
  prospects: Prospect[];
  flows: CapitalFlow[];
  rivals: Rival[];
  staff: Employee[];
  candidates: Candidate[];
  risk: RiskState;
  targets: Record<string, number>;
  watchlist: string[];
  daily: DailyRecord[];
  lastReport: EodReport | null;
  notifications: Notification[];
  decisions: Decision[];
  reputation: number;
  stats: RunStats;
  achievements: string[];
  status: GameStatus;
  failure: FailureReport | null;
  counters: { order: number; news: number; fill: number; misc: number };
  /** today's intraday NAV samples for the terminal sparkline */
  intradayNav: { minute: number; nav: Cents }[];
  /** NAV at today's open, for intraday P&L */
  navAtOpen: Cents;
  /** fund-wide letter cooldown */
  lastLetterDay: number;
  tutorialStep: number;
  /** consecutive-day counters for recoverable wind-down conditions */
  watch: { smallDays: number; lowConfidenceDays: number };
}
