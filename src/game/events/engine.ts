import { BALANCE } from '../../config/balance';
import { DIFFICULTIES } from '../../config/difficulty';
import { SECTORS, SECTOR_BY_ID, type SectorId } from '../../config/sectors';
import { toCents } from '../accounting';
import { clockLabel } from '../calendar';
import { policyTarget } from '../macro';
import { personName } from '../names';
import { nextId, notify } from '../notify';
import { Rng } from '../rng';
import type { GameState, Instrument, NewsCategory, NewsItem, ScheduledEvent } from '../types';
import { TEMPLATES, TEMPLATE_BY_ID, type EventTemplate, type TemplateCtx } from './catalog';
import { adjustFundamentals, hit, hitMarket, hitRates, hitSector, shiftMacro, type EffectCtx } from './effects';
import { BROKERS, COUNTRIES, CUSTOMERS, DRUG_PREFIX, DRUG_SUFFIX, GUIDANCE_REASONS, ISSUES, PROBE_TOPICS, PRODUCT_WORDS, REGIONS, SHORT_SELLERS } from './vocab';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function newsMinute(state: GameState): number {
  return state.clock.phase === 'open' ? state.clock.minute : state.clock.phase === 'pre' ? -1 : 390;
}

export function pushNews(state: GameState, n: Omit<NewsItem, 'id' | 'day' | 'date' | 'minute' | 'read'> & { minute?: number }): NewsItem {
  const item: NewsItem = { id: nextId(state, 'news', 'W'), day: state.clock.day, date: state.clock.date, read: false, ...n, minute: n.minute ?? newsMinute(state) };
  state.news.push(item);
  if (state.news.length > BALANCE.newsCap) state.news.splice(0, state.news.length - BALANCE.newsCap);
  const held = item.instruments.some((id) => state.fund.positions[id]);
  if (item.severity >= 3 || (held && item.severity >= 2)) {
    notify(state, item.severity >= 4 ? 'danger' : 'info', item.severity >= 4 ? 'BREAKING' : held ? 'News on a holding' : 'Major news', item.headline, { link: { screen: 'news', id: item.id }, sound: 'news', toast: true });
  }
  return item;
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k);
}

function money(x: number) {
  if (x >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(0)}M`;
  return `$${Math.round(x).toLocaleString('en-US')}`;
}

function defaultVars(rng: Rng, inst?: Instrument, other?: Instrument, sector?: SectorId): Record<string, string> {
  const root = inst ? inst.name.split(' ')[0] : 'Project';
  return {
    co: inst?.name ?? '', tk: inst?.id ?? '', ind: inst?.industry ?? '',
    sec: sector ? SECTOR_BY_ID[sector].name : inst && SECTOR_BY_ID[inst.sector as SectorId] ? SECTOR_BY_ID[inst.sector as SectorId].name : '',
    person: personName(rng), broker: rng.pick(BROKERS), product: `${root} ${rng.pick(PRODUCT_WORDS)}`,
    drug: `${rng.pick(DRUG_PREFIX)}${rng.pick(DRUG_SUFFIX)}`, region: rng.pick(REGIONS), country: rng.pick(COUNTRIES),
    issue: rng.pick(ISSUES), topic: rng.pick(PROBE_TOPICS), reason: rng.pick(GUIDANCE_REASONS), customer: rng.pick(CUSTOMERS),
    shortseller: rng.pick(SHORT_SELLERS), commodity: inst?.name.toLowerCase() ?? '', acq: other?.name ?? 'a rival', acqtk: other?.id ?? '',
    debt: inst?.fundamentals ? money(inst.fundamentals.debt) : '',
  };
}

export interface FireOptions {
  inst?: Instrument;
  sector?: SectorId;
  payload?: Record<string, number | string>;
  storyId?: string;
}

/** Fire an event template: render narrative, apply effects, record news, schedule follow-ups. */
export function fireTemplate(state: GameState, t: EventTemplate, o: FireOptions = {}): NewsItem | null {
  const rng = new Rng(state.rng.events);
  const payload = { ...(o.payload ?? {}) };
  const other = typeof payload.acq === 'string' ? state.instruments.find((i) => i.id === payload.acq) : undefined;
  const ctx: TemplateCtx = {
    state, rng, newsId: `W${state.counters.news + 1}`, affected: new Set(), sectors: new Set(), macro: new Set(),
    inst: o.inst, other, sector: o.sector, vars: {}, payload,
  };
  if (t.scope === 'commodity' && !ctx.inst) {
    const pick = rng.pick(t.commodities ?? []);
    ctx.inst = state.instruments.find((i) => i.id === pick);
    if (!ctx.inst) return null;
  }
  if (t.scope === 'sector' && !ctx.sector) ctx.sector = rng.pick(SECTORS).id;
  ctx.vars = defaultVars(rng, ctx.inst, ctx.other, ctx.sector);
  // keep narrative details consistent across a story
  for (const k of ['product', 'drug', 'topic', 'issue', 'reason', 'shortseller', 'customer']) if (typeof payload[k] === 'string') ctx.vars[k] = payload[k] as string;
  t.setup?.(ctx);
  if (ctx.other) { ctx.vars.acq = ctx.other.name; ctx.vars.acqtk = ctx.other.id; }
  if (ctx.sector) ctx.vars.sec = SECTOR_BY_ID[ctx.sector].name;
  if ((t.id === 'mna_rumor' || t.id === 'partnership' || t.id === 'merger_direct') && !ctx.other) return null;
  t.apply(ctx);
  if (ctx.inst && (t.scope === 'company' || t.scope === 'commodity')) ctx.affected.add(ctx.inst.id);
  if (ctx.other) ctx.affected.add(ctx.other.id);
  const headline = render(rng.pick(t.headline), ctx.vars);
  const body = render(rng.pick(t.body), ctx.vars);
  let storyId = o.storyId;
  const item = pushNews(state, {
    templateId: t.id, category: t.category, headline, body, severity: t.severity, tone: t.tone,
    instruments: [...ctx.affected], sectors: [...new Set([...ctx.sectors, ...(ctx.inst && t.scope === 'company' ? [ctx.inst.sector as SectorId] : [])])],
    macro: [...ctx.macro], explanation: t.explanation, storyId,
  });
  // follow-ups
  if (t.followUps?.length) {
    const r = rng.next();
    let acc = 0;
    let chosen: { id: string; prob: number; delay: [number, number] } | undefined;
    for (const fu of t.followUps) {
      acc += fu.prob;
      if (r < acc) { chosen = fu; break; }
    }
    if (chosen) {
      storyId = storyId ?? `S${item.id}`;
      item.storyId = storyId;
      const delay = rng.int(chosen.delay[0], chosen.delay[1]);
      const keep: Record<string, number | string> = { ...payload };
      for (const k of ['product', 'drug', 'topic', 'issue', 'reason', 'shortseller', 'customer']) keep[k] = ctx.vars[k];
      state.scheduled.push({
        id: nextId(state, 'misc', 'Q'), kind: 'followup', day: state.clock.day + delay, minute: rng.chance(0.5) ? -1 : rng.int(10, 360),
        instrument: ctx.inst?.id, templateId: chosen.id, storyId, payload: keep, label: 'Developing story',
      });
      if (ctx.inst) ctx.inst.activeStory = storyId;
    } else if (ctx.inst && storyId) ctx.inst.activeStory = null;
  } else if (ctx.inst && storyId) {
    ctx.inst.activeStory = null;
  }
  return item;
}

function eligibleCompany(state: GameState, t: EventTemplate, inst: Instrument): boolean {
  if (inst.kind !== 'equity') return false;
  if (inst.activeStory) return false;
  if (state.clock.day - inst.lastEventDay < 3) return false;
  if (t.sectors && !t.sectors.includes(inst.sector as SectorId)) return false;
  if (t.condition && !t.condition(inst, state)) return false;
  return true;
}

/** Try to fire one random event. */
export function randomEvent(state: GameState): NewsItem | null {
  const rng = new Rng(state.rng.events);
  const d = DIFFICULTIES[state.setup.difficulty];
  const pool = TEMPLATES.filter((t) => t.weight > 0 && (!t.hardOnly || d.crises));
  // single draw: if the chosen template has no eligible subject, no event fires (keeps category mix honest)
  const t = rng.weighted(pool, (x) => x.weight * (x.hardOnly ? (state.macro.regime === 'crisis' ? 0.3 : 1) : 1));
  if (t.scope === 'company') {
    const cands = state.instruments.filter((i) => eligibleCompany(state, t, i));
    if (!cands.length) return null;
    return fireTemplate(state, t, { inst: rng.pick(cands) });
  }
  if (t.condition && !t.condition(state.instruments[0], state)) return null;
  return fireTemplate(state, t);
}

/** Per-minute random news hazard. */
export function maybeRandomEvent(state: GameState) {
  const rng = new Rng(state.rng.events);
  const d = DIFFICULTIES[state.setup.difficulty];
  const p = (6 / 390) * d.eventFreq;
  if (rng.chance(p)) randomEvent(state);
}

/** Process scheduled follow-ups for the current time slot (-1 overnight, 0..389 intraday, 390 after close). */
export function processScheduled(state: GameState, slot: number) {
  const due = state.scheduled.filter((s) => s.day < state.clock.day || (s.day === state.clock.day && (s.minute <= slot)));
  if (!due.length) return;
  const dueIds = new Set(due.map((d) => d.id));
  state.scheduled = state.scheduled.filter((s) => !dueIds.has(s.id));
  for (const ev of due) {
    if (ev.kind !== 'followup' || !ev.templateId) continue;
    const t = TEMPLATE_BY_ID[ev.templateId];
    if (!t) continue;
    const inst = ev.instrument ? state.instruments.find((i) => i.id === ev.instrument) : undefined;
    fireTemplate(state, t, { inst, payload: ev.payload, storyId: ev.storyId });
  }
}

// ───────────────────────── Earnings ─────────────────────────

/** Deterministic analyst preview of an upcoming report. Accuracy scales with coverage (0-100). */
export function earningsPreview(inst: Instrument, coverage: number, seed: number): { beatProb: number; view: 'beat' | 'inline' | 'miss'; confidence: string } | null {
  const f = inst.fundamentals;
  if (!f || coverage <= 0) return null;
  const r = new Rng([seed >>> 0, 0x9e3779b9, (inst.idx * 2654435761) >>> 0, f.nextEarningsDay >>> 0]);
  const noise = r.normal() * (1.4 - coverage / 80);
  const signal = f.trend * 2.2 + noise;
  const beatProb = clamp(1 / (1 + Math.exp(-signal)), 0.05, 0.95);
  return {
    beatProb,
    view: beatProb > 0.6 ? 'beat' : beatProb < 0.4 ? 'miss' : 'inline',
    confidence: coverage > 70 ? 'High' : coverage > 45 ? 'Medium' : 'Low',
  };
}

export function releaseEarnings(state: GameState, inst: Instrument) {
  const f = inst.fundamentals!;
  const rng = new Rng(state.rng.events);
  const ctx: EffectCtx = { state, rng, newsId: `W${state.counters.news + 1}`, affected: new Set(), sectors: new Set(), macro: new Set() };
  const surprise = clamp(f.trend * 0.06 + rng.normal() * 0.04, -0.35, 0.35);
  const est = f.consensusEps;
  const act = est >= 0 ? est * (1 + surprise) : est + Math.abs(est) * surprise;
  const gScore = f.trend * 2 + rng.normal() * 0.9;
  const guidance: 'raised' | 'maintained' | 'cut' = gScore > 0.9 ? 'raised' : gScore < -0.9 ? 'cut' : 'maintained';
  // valuation: stretched names are punished more on misses and rewarded less on beats
  const stretch = clamp(Math.log(inst.price / f.fairValue), -0.4, 0.4);
  let move = clamp(surprise * 1.5, -0.14, 0.14);
  move *= move > 0 ? 1 - stretch : 1 + stretch;
  move += guidance === 'raised' ? 0.035 : guidance === 'cut' ? -0.06 : -0.004;
  if (state.macro.regime === 'bear' || state.macro.regime === 'crisis') move -= 0.01;
  move += rng.normal() * 0.012;
  hit(ctx, inst, move, { immediate: 0.75, minutes: 60, volBoost: 2, days: Math.abs(move) > 0.06 ? 2 : 0, dailyDrift: Math.sign(move) * 0.004, spread: 0.05 });
  // update fundamentals
  const revGrowthQ = f.revGrowth / 4 + surprise * 0.25;
  f.revenue *= 1 + revGrowthQ;
  const prevQ = f.quarterlyEps;
  f.quarterlyEps = act;
  f.earnings = act * 4 * f.sharesOut;
  f.margin = f.revenue > 0 ? f.earnings / f.revenue : 0;
  f.epsGrowth = prevQ !== 0 ? clamp((act - prevQ) / Math.abs(prevQ) * 4, -1, 2) : 0;
  f.revGrowth = clamp(f.revGrowth * 0.8 + revGrowthQ * 4 * 0.2, -0.3, 0.6);
  const gAdj = guidance === 'raised' ? 0.03 : guidance === 'cut' ? -0.05 : 0;
  f.consensusEps = act * (1 + f.growthExpect / 4 + gAdj + f.trend * 0.01);
  adjustFundamentals(inst, { fair: surprise * 0.4 + gAdj, trend: guidance === 'cut' ? -0.12 : guidance === 'raised' ? 0.06 : 0 });
  f.earningsHistory.push({ day: state.clock.day, date: state.clock.date, est, act, guidance });
  if (f.earningsHistory.length > 12) f.earningsHistory.shift();
  f.nextEarningsDay = state.clock.day + 63;
  f.earningsTiming = rng.chance(0.5) ? 'pre' : 'post';

  // quarterly dividend paid on the report date
  if (f.dividendYield > 0) payDividend(state, inst, (inst.price * f.dividendYield) / 4);

  const beat = surprise > 0.015, miss = surprise < -0.015;
  const verb = beat ? 'beats' : miss ? 'misses' : 'matches';
  const gText = guidance === 'raised' ? 'raises outlook' : guidance === 'cut' ? 'cuts outlook' : 'reaffirms outlook';
  const twist = beat && guidance === 'cut' ? ' — but warns on the year ahead' : miss && guidance === 'raised' ? ' — yet sounds upbeat on recovery' : '';
  const headline = `${inst.name} ${verb} estimates, ${gText}${twist}`;
  const body = `${inst.name} reported quarterly earnings of $${act.toFixed(2)} per share versus consensus of $${est.toFixed(2)} (${surprise >= 0 ? '+' : ''}${(surprise * 100).toFixed(1)}% surprise). ` +
    `Revenue grew ${(revGrowthQ * 4 * 100).toFixed(1)}% annualised. Management ${guidance === 'raised' ? 'raised' : guidance === 'cut' ? 'lowered' : 'maintained'} full-year guidance. ` +
    (stretch > 0.15 ? 'With the shares already richly valued, expectations were high. ' : stretch < -0.15 ? 'The shares had been trading at a discount going into the report. ' : '');
  const item = pushNews(state, {
    templateId: 'earnings', category: 'earnings', headline, body,
    severity: Math.abs(move) > 0.08 ? 3 : Math.abs(move) > 0.03 ? 2 : 1, tone: Math.sign(move),
    instruments: [inst.id], sectors: [inst.sector as SectorId],
    explanation: 'Prices react to results versus expectations, guidance about the future, and how much optimism was already in the price. A beat with a guidance cut can still fall.',
  });
  // big miss / cut can start an analyst-reaction story
  if ((surprise < -0.06 || guidance === 'cut') && !inst.activeStory && rng.chance(0.5)) {
    state.scheduled.push({ id: nextId(state, 'misc', 'Q'), kind: 'followup', day: state.clock.day + 1, minute: rng.int(5, 120), instrument: inst.id, templateId: 'analyst_downgrade_fu', storyId: `S${item.id}`, label: 'Analyst reaction' });
    inst.activeStory = `S${item.id}`;
    item.storyId = inst.activeStory;
  }
}

function payDividend(state: GameState, inst: Instrument, dps: number) {
  const pos = state.fund.positions[inst.id];
  if (pos) {
    const cash = toCents(pos.qty * dps); // shorts pay the dividend
    state.fund.cash += cash;
    state.fund.totals.dividends += cash;
    state.fund.instrumentPnl[inst.id] = (state.fund.instrumentPnl[inst.id] ?? 0) + cash;
  }
  // ex-dividend price adjustment
  state.impacts.push({ idx: inst.idx, remaining: Math.log(1 - Math.min(0.2, dps / inst.price)), rate: 1, daysLeft: 0, dailyDrift: 0, source: 'dividend' });
}

// ───────────────────────── Macro releases ─────────────────────────

function macroCtx(state: GameState): EffectCtx {
  return { state, rng: new Rng(state.rng.events), newsId: `W${state.counters.news + 1}`, affected: new Set(), sectors: new Set(), macro: new Set() };
}

export function rateDecisionOutlook(state: GameState): { expectedChange: number; label: string } {
  const m = state.macro;
  const gap = policyTarget(m) - m.policyRate;
  const exp = Math.abs(gap) < 0.2 ? 0 : clamp(Math.round(gap / 0.25) * 0.25 * 0.5, -0.5, 0.5);
  const e = Math.round(exp / 0.25) * 0.25;
  return { expectedChange: e, label: e === 0 ? 'Hold expected' : `${e > 0 ? 'Hike' : 'Cut'} of ${Math.abs(e * 100)}bp expected` };
}

export function releaseRateDecision(state: GameState) {
  const ctx = macroCtx(state);
  const m = state.macro;
  const { expectedChange } = rateDecisionOutlook(state);
  const gap = policyTarget(m) - m.policyRate;
  let change = 0;
  if (Math.abs(gap) >= 0.2) change = clamp(Math.round(gap / 0.25) * 0.25 * (ctx.rng.chance(0.25) ? 1 : 0.5), -0.5, 0.5);
  change = Math.round(change / 0.25) * 0.25;
  if (ctx.rng.chance(0.12)) change += ctx.rng.chance(0.5) ? 0.25 : -0.25; // genuine surprise
  if (m.policyRate + change < 0) change = -m.policyRate;
  m.policyRate = Math.round((m.policyRate + change) * 100) / 100;
  const surprise = change - expectedChange;
  const tone = ctx.rng.normal() * 0.05; // statement hawkish/dovish
  hitRates(ctx, surprise + tone);
  hitSector(ctx, 'financials', (change > 0 ? 0.004 : -0.004) + surprise * 0.01);
  shiftMacro(ctx, { sentiment: -surprise * 0.3 });
  m.nextRateDay = state.clock.day + 30 + ctx.rng.int(0, 5);
  m.expectedRate = m.policyRate;
  const action = change === 0 ? 'holds rates' : change > 0 ? `raises rates by ${change * 100}bp` : `cuts rates by ${-change * 100}bp`;
  const surpriseText = Math.abs(surprise) < 0.01 ? 'as expected' : surprise > 0 ? 'in a hawkish surprise' : 'in a dovish surprise';
  pushNews(state, {
    templateId: 'rate_decision', category: 'centralbank',
    headline: `Central bank ${action} to ${m.policyRate.toFixed(2)}%, ${surpriseText}`,
    body: `The central bank ${action}, taking its policy rate to ${m.policyRate.toFixed(2)}%. Markets had priced ${expectedChange === 0 ? 'no change' : `a ${expectedChange > 0 ? 'hike' : 'cut'} of ${Math.abs(expectedChange * 100)}bp`}. ` +
      `Policymakers cited inflation of ${m.inflation.toFixed(1)}% and growth of ${m.growth.toFixed(1)}%. ${tone > 0.03 ? 'The statement struck a hawkish tone.' : tone < -0.03 ? 'The statement leaned dovish.' : ''}`,
    severity: Math.abs(surprise) > 0.1 ? 3 : 2, tone: -Math.sign(surprise),
    instruments: [], sectors: ['financials', 'utilities', 'realestate'], macro: ['rates'],
    explanation: 'Surprise hikes hurt rate-sensitive assets (utilities, real estate, long-duration growth stocks, gold) and help bank margins. Expected moves are already priced in.',
  });
}

export function releaseCpi(state: GameState) {
  const ctx = macroCtx(state);
  const m = state.macro;
  const actual = Math.round(m.inflation * 10) / 10;
  const consensus = Math.round((m.inflation + ctx.rng.normal() * 0.15) * 10) / 10;
  const s = actual - consensus;
  hitRates(ctx, s * 0.6);
  hitMarket(ctx, -s * 0.03);
  shiftMacro(ctx, { inflShock: s * 0.0015, expectedRate: s * 0.5 });
  m.nextCpiDay = state.clock.day + 21;
  pushNews(state, {
    templateId: 'cpi', category: 'economic',
    headline: `Inflation ${s > 0.05 ? 'runs hotter than expected' : s < -0.05 ? 'cools more than expected' : 'in line with forecasts'} at ${actual.toFixed(1)}%`,
    body: `Consumer prices rose ${actual.toFixed(1)}% from a year earlier, versus economists' forecast of ${consensus.toFixed(1)}%. ${s > 0.05 ? 'The hot reading raises the odds of tighter monetary policy.' : s < -0.05 ? 'Softer inflation could give the central bank room to ease.' : ''}`,
    severity: Math.abs(s) >= 0.2 ? 3 : 2, tone: -Math.sign(s), instruments: [], sectors: [], macro: ['inflation'],
    explanation: 'Inflation surprises shift expected interest rates. Hot prints hurt bonds-like equities and growth stocks; cool prints help them.',
  });
}

export function releaseJobs(state: GameState) {
  const ctx = macroCtx(state);
  const m = state.macro;
  const consensus = Math.round(150 + (m.growth - 2) * 60 + ctx.rng.normal() * 15);
  const actual = Math.round(consensus + ctx.rng.normal() * 70 + (m.growth - 2) * 30);
  const z = (actual - consensus) / 70;
  m.unemployment = clamp(m.unemployment - z * 0.05, 2.5, 12);
  shiftMacro(ctx, { growthShock: z * 0.0005, growth: z * 0.06 });
  const goodIsBad = m.inflation > 3.3;
  hitMarket(ctx, goodIsBad ? -0.003 * z : 0.004 * z);
  hitRates(ctx, z * 0.06);
  m.nextJobsDay = state.clock.day + 21;
  pushNews(state, {
    templateId: 'jobs', category: 'economic',
    headline: `Economy ${actual >= 0 ? 'adds' : 'sheds'} ${Math.abs(actual)}K jobs vs ${consensus}K expected`,
    body: `Payrolls ${actual >= 0 ? 'rose' : 'fell'} by ${Math.abs(actual)},000 last month against expectations of ${consensus},000. Unemployment is ${m.unemployment.toFixed(1)}%. ${goodIsBad && z > 0.5 ? 'With inflation elevated, a strong report fuels fears of higher rates.' : ''}`,
    severity: Math.abs(z) > 1.2 ? 3 : 2, tone: goodIsBad ? -Math.sign(z) : Math.sign(z), instruments: [], sectors: [], macro: ['growth', 'employment'],
    explanation: 'Strong jobs data signals growth, which helps cyclicals — but when inflation is high, it can mean higher rates, which hurts valuations.',
  });
}

export function releaseGdp(state: GameState) {
  const ctx = macroCtx(state);
  const m = state.macro;
  const consensus = Math.round((m.growth + ctx.rng.normal() * 0.2) * 10) / 10;
  const actual = Math.round((m.growth + ctx.rng.normal() * 0.35) * 10) / 10;
  const s = actual - consensus;
  shiftMacro(ctx, { growthShock: s * 0.001, sentiment: s * 0.15 });
  hitMarket(ctx, s * 0.012);
  for (const sec of ['industrials', 'materials', 'discretionary'] as SectorId[]) hitSector(ctx, sec, s * 0.012);
  m.nextGdpDay = state.clock.day + 63;
  pushNews(state, {
    templateId: 'gdp', category: 'economic',
    headline: `Economy grew at ${actual.toFixed(1)}% annualised pace, ${s > 0.1 ? 'beating' : s < -0.1 ? 'missing' : 'matching'} forecasts`,
    body: `Gross domestic product expanded at an annualised ${actual.toFixed(1)}% last quarter, compared with a consensus estimate of ${consensus.toFixed(1)}%.`,
    severity: Math.abs(s) > 0.4 ? 3 : 2, tone: Math.sign(s), instruments: [], sectors: ['industrials', 'materials', 'discretionary'], macro: ['growth'],
    explanation: 'GDP surprises shift growth expectations, mostly affecting cyclical sectors.',
  });
}

/** Run macro releases scheduled for the current slot. */
export function processMacroReleases(state: GameState, slot: number) {
  const m = state.macro;
  const day = state.clock.day;
  if (slot === -1) {
    if (m.nextCpiDay <= day) releaseCpi(state);
    if (m.nextJobsDay <= day) releaseJobs(state);
    if (m.nextGdpDay <= day) releaseGdp(state);
  }
  if (slot === 270 && m.nextRateDay <= day) releaseRateDecision(state);
}

/** Earnings due in this slot: pre-market at -1, post-close at 390. */
export function processEarnings(state: GameState, slot: number) {
  for (const inst of state.instruments) {
    const f = inst.fundamentals;
    if (!f || f.nextEarningsDay > state.clock.day) continue;
    if (f.nextEarningsDay < state.clock.day || (slot === -1 && f.earningsTiming === 'pre') || (slot === 390 && f.earningsTiming === 'post')) releaseEarnings(state, inst);
  }
}

export interface CalendarEntry {
  day: number;
  slot: number;
  kind: ScheduledEvent['kind'];
  label: string;
  instrument?: string;
  detail?: string;
}

/** Upcoming scheduled events (earnings, macro releases) for the next `days` trading days. */
export function upcomingEvents(state: GameState, days: number): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  const d0 = state.clock.day;
  const m = state.macro;
  const inWin = (d: number) => d >= d0 && d <= d0 + days;
  for (const inst of state.instruments) {
    const f = inst.fundamentals;
    if (f && inWin(f.nextEarningsDay)) {
      out.push({ day: f.nextEarningsDay, slot: f.earningsTiming === 'pre' ? -1 : 390, kind: 'earnings', label: `${inst.id} earnings`, instrument: inst.id, detail: `Consensus EPS $${f.consensusEps.toFixed(2)} · ${f.earningsTiming === 'pre' ? 'before open' : 'after close'}` });
    }
  }
  if (inWin(m.nextCpiDay)) out.push({ day: m.nextCpiDay, slot: -1, kind: 'cpi', label: 'Inflation (CPI) report', detail: `Last reading ${m.inflation.toFixed(1)}% · 08:30` });
  if (inWin(m.nextJobsDay)) out.push({ day: m.nextJobsDay, slot: -1, kind: 'jobs', label: 'Employment report', detail: `Unemployment ${m.unemployment.toFixed(1)}% · 08:30` });
  if (inWin(m.nextGdpDay)) out.push({ day: m.nextGdpDay, slot: -1, kind: 'gdp', label: 'GDP release', detail: `Growth running ${m.growth.toFixed(1)}% · 08:30` });
  if (inWin(m.nextRateDay)) out.push({ day: m.nextRateDay, slot: 270, kind: 'rate', label: 'Central bank decision', detail: `${rateDecisionOutlook(state).label} · ${clockLabel(270)}` });
  out.sort((a, b) => a.day - b.day || a.slot - b.slot);
  return out;
}

export function newsCategoryLabel(c: NewsCategory): string {
  return {
    breaking: 'Breaking', corporate: 'Corporate', earnings: 'Earnings', economic: 'Economy', centralbank: 'Central bank', sector: 'Sector',
    commodity: 'Commodities', competitor: 'Competitors', client: 'Clients', market: 'Markets', firm: 'Your firm',
  }[c];
}
