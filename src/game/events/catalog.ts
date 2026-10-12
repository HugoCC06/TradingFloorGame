/**
 * Data-driven event catalogue. Each template declares its category, scope,
 * frequency weight, severity, eligibility, narrative text (with placeholders),
 * an explicit effect, and optional follow-up branches forming multi-day stories.
 *
 * To add an event: append a template here. Follow-up-only templates use weight 0.
 */
import type { SectorId } from '../../config/sectors';
import type { GameState, Instrument, NewsCategory } from '../types';
import { adjustFundamentals, hit, hitMarket, hitRates, hitSector, setRegime, shiftMacro, type EffectCtx } from './effects';

export interface TemplateCtx extends EffectCtx {
  inst?: Instrument;
  other?: Instrument;
  sector?: SectorId;
  vars: Record<string, string>;
  payload: Record<string, number | string>;
}

export interface EventTemplate {
  id: string;
  category: NewsCategory;
  scope: 'company' | 'sector' | 'commodity' | 'macro' | 'market';
  weight: number;
  severity: 1 | 2 | 3 | 4;
  tone: number;
  hardOnly?: boolean;
  sectors?: SectorId[];
  commodities?: string[];
  condition?: (inst: Instrument, state: GameState) => boolean;
  setup?: (ctx: TemplateCtx) => void;
  headline: string[];
  body: string[];
  explanation: string;
  apply: (ctx: TemplateCtx) => void;
  followUps?: { id: string; prob: number; delay: [number, number] }[];
}

const f = (i: Instrument) => i.fundamentals!;
const lev = (i: Instrument) => f(i).debt / Math.max(f(i).revenue, 1);
const byId = (st: GameState, id: string) => st.instruments.find((x) => x.id === id)!;
const commodity = (st: GameState, id: string) => byId(st, id);
const pickPeer = (ctx: TemplateCtx, pred: (i: Instrument) => boolean) => {
  const peers = ctx.state.instruments.filter((i) => i.kind === 'equity' && i !== ctx.inst && pred(i));
  return peers.length ? ctx.rng.pick(peers) : undefined;
};
const pctStr = (x: number) => `${Math.round(x)}`;

export const TEMPLATES: EventTemplate[] = [
  // ───────────────────────── Company: guidance & operations ─────────────────────────
  {
    id: 'guidance_raise', category: 'corporate', scope: 'company', weight: 6, severity: 2, tone: 1,
    condition: (i) => f(i).trend > -0.2,
    headline: ['{co} raises full-year outlook', '{co} lifts guidance as orders accelerate', '{tk} jumps after upbeat outlook revision'],
    body: ['{co} raised its full-year revenue and profit guidance, citing stronger-than-expected demand in its {ind} business. Management said momentum carried into the current quarter.',
      'In an unscheduled update, {co} told investors it now expects results at the top end of its range. Analysts are revising estimates higher.'],
    explanation: 'Upward guidance revisions lift earnings expectations; the stock re-rates and analysts often follow with higher estimates over several days.',
    apply: (c) => { hit(c, c.inst!, 0.045, { days: 2, dailyDrift: 0.006, volBoost: 1.6 }); adjustFundamentals(c.inst!, { trend: 0.15, fair: 0.05, growth: 0.01 }); f(c.inst!).consensusEps *= 1.03; },
  },
  {
    id: 'guidance_cut', category: 'corporate', scope: 'company', weight: 6, severity: 2, tone: -1,
    condition: (i) => f(i).trend < 0.3,
    headline: ['{co} cuts guidance, citing {reason}', '{co} warns on profits as {reason} bite', '{tk} slides after profit warning'],
    body: ['{co} lowered its full-year outlook, blaming {reason}. The company said it is reviewing costs across its {ind} operations.',
      'A surprise profit warning from {co} sent shares lower. Management cited {reason} and declined to say when conditions would improve.'],
    explanation: 'Profit warnings reset expectations lower. Weak names often keep drifting as analysts cut estimates over following sessions.',
    apply: (c) => { hit(c, c.inst!, -0.075, { days: 3, dailyDrift: -0.008, volBoost: 1.8 }); adjustFundamentals(c.inst!, { trend: -0.2, fair: -0.07, growth: -0.015 }); f(c.inst!).consensusEps *= 0.95; },
    followUps: [{ id: 'analyst_downgrade_fu', prob: 0.5, delay: [1, 2] }],
  },
  {
    id: 'product_launch', category: 'corporate', scope: 'company', weight: 5, severity: 1, tone: 1,
    sectors: ['tech', 'semis', 'discretionary', 'entertainment', 'health', 'telecom', 'aerospace', 'staples', 'retail'],
    headline: ['{co} unveils {product}', '{co} launches {product} to strong early reviews', 'First look: {co} debuts {product}'],
    body: ['{co} unveiled {product}, its most ambitious {ind} offering in years. Early reviews were positive, though analysts cautioned that pricing will determine success.',
      'At a packed launch event, {co} introduced {product}. Pre-orders reportedly exceeded internal targets.'],
    explanation: 'Successful launches support revenue growth expectations, but the effect is usually modest unless the product is transformative.',
    apply: (c) => { hit(c, c.inst!, 0.025, { volBoost: 1.3 }); adjustFundamentals(c.inst!, { trend: 0.06, fair: 0.02 }); },
  },
  {
    id: 'product_flop', category: 'corporate', scope: 'company', weight: 3, severity: 1, tone: -1,
    sectors: ['tech', 'semis', 'discretionary', 'entertainment', 'telecom', 'staples', 'retail'],
    headline: ['{co}\'s {product} launch disappoints', 'Lukewarm demand for {co}\'s {product}', '{tk} falls as {product} sales lag'],
    body: ['Early sales data for {co}\'s {product} came in well below expectations, according to industry trackers. Several retailers have reportedly cut orders.',
      'Reviewers panned {co}\'s {product}, calling it overpriced and underpowered. The company said it remains confident in the product roadmap.'],
    explanation: 'A failed launch raises doubts about growth plans and can weigh on estimates for several quarters.',
    apply: (c) => { hit(c, c.inst!, -0.045, { volBoost: 1.4 }); adjustFundamentals(c.inst!, { trend: -0.08, fair: -0.03 }); },
  },
  {
    id: 'product_recall', category: 'corporate', scope: 'company', weight: 2.5, severity: 2, tone: -1,
    sectors: ['discretionary', 'health', 'staples', 'industrials', 'aerospace', 'pharma'],
    headline: ['{co} recalls {product} over safety concerns', 'Safety regulator orders {co} recall', '{co} pulls {product} from shelves'],
    body: ['{co} announced a voluntary recall of {product} after reports of defects. The company has not yet estimated the cost of the recall.',
      'Following an inquiry by safety regulators, {co} said it would recall affected units of {product}. Analysts estimate the cost could run into the hundreds of millions.'],
    explanation: 'Recalls bring direct costs and reputational damage. Markets watch for lawsuits or a quick, contained fix.',
    apply: (c) => { hit(c, c.inst!, -0.07, { days: 1, dailyDrift: -0.005, volBoost: 1.8 }); adjustFundamentals(c.inst!, { trend: -0.1, fair: -0.04 }); },
    followUps: [{ id: 'recall_lawsuit', prob: 0.4, delay: [2, 6] }, { id: 'recall_resolved', prob: 0.6, delay: [3, 8] }],
  },
  {
    id: 'recall_lawsuit', category: 'corporate', scope: 'company', weight: 0, severity: 2, tone: -1,
    headline: ['Class action filed against {co} over recall', '{co} faces mounting lawsuits after {product} recall'],
    body: ['Plaintiffs\' lawyers filed a class action against {co}, alleging the company knew of the {product} defect before the recall. Legal experts say damages could be significant.'],
    explanation: 'Litigation extends the recall story and adds an uncertain liability to the balance sheet.',
    apply: (c) => { hit(c, c.inst!, -0.045, { volBoost: 1.5 }); adjustFundamentals(c.inst!, { fair: -0.03 }); },
  },
  {
    id: 'recall_resolved', category: 'corporate', scope: 'company', weight: 0, severity: 1, tone: 1,
    headline: ['{co} says recall costs smaller than feared', '{co} completes fix for {product}'],
    body: ['{co} said the recall of {product} is largely complete and costs will be well below early estimates. Shares recovered part of their losses.'],
    explanation: 'When a feared liability turns out smaller, part of the earlier decline often reverses.',
    apply: (c) => { hit(c, c.inst!, 0.035); adjustFundamentals(c.inst!, { fair: 0.02, trend: 0.05 }); },
  },
  {
    id: 'ceo_departure', category: 'corporate', scope: 'company', weight: 3, severity: 2, tone: -1,
    headline: ['{co} CEO {person} steps down unexpectedly', 'Shock exit: {co} chief executive resigns', '{co} begins search for new CEO'],
    body: ['{co} said chief executive {person} has stepped down with immediate effect. The board has appointed an interim leader while it searches for a permanent replacement.',
      'In a brief statement, {co} announced the departure of CEO {person}, citing "personal reasons". The timing surprised investors.'],
    explanation: 'Unexpected leadership changes create uncertainty about strategy until a successor is named.',
    apply: (c) => { hit(c, c.inst!, -0.055, { volBoost: 1.7 }); },
    followUps: [{ id: 'successor_named', prob: 0.85, delay: [2, 7] }],
  },
  {
    id: 'successor_named', category: 'corporate', scope: 'company', weight: 0, severity: 1, tone: 1,
    headline: ['{co} names {person} as chief executive', '{co} taps industry veteran {person} as CEO'],
    body: ['{co} appointed {person}, a respected industry veteran, as chief executive, ending a brief period of uncertainty. Investors welcomed the appointment.'],
    explanation: 'A credible successor removes the leadership discount.',
    apply: (c) => { hit(c, c.inst!, 0.035); adjustFundamentals(c.inst!, { trend: 0.05 }); },
  },
  {
    id: 'cfo_departure', category: 'corporate', scope: 'company', weight: 2.5, severity: 1, tone: -1,
    headline: ['{co} finance chief resigns', '{co} CFO {person} to depart'],
    body: ['{co} said chief financial officer {person} will leave the company at the end of the month. No reason was given.'],
    explanation: 'CFO departures can hint at internal problems, but often have limited lasting impact.',
    apply: (c) => { hit(c, c.inst!, -0.025); },
  },
  {
    id: 'activist_stake', category: 'corporate', scope: 'company', weight: 2.5, severity: 2, tone: 1,
    condition: (i) => f(i).quality < 65,
    headline: ['Activist investor builds stake in {co}', '{co} shares jump as activist pushes for change'],
    body: ['An activist investor has disclosed a significant stake in {co} and is pushing for a strategic review, cost cuts and potential asset sales.'],
    explanation: 'Activists can unlock value through restructuring or a sale, so markets often price in part of the upside.',
    apply: (c) => { hit(c, c.inst!, 0.06, { days: 2, dailyDrift: 0.004, volBoost: 1.5 }); adjustFundamentals(c.inst!, { fair: 0.05 }); },
  },
  {
    id: 'mna_rumor', category: 'corporate', scope: 'company', weight: 3, severity: 2, tone: 1,
    condition: (i) => i.price * f(i).sharesOut < 80e9,
    setup: (c) => {
      const acq = pickPeer(c, (i) => (i.sector === c.inst!.sector || c.rng.chance(0.25)) && i.price * f(i).sharesOut > c.inst!.price * f(c.inst!).sharesOut * 1.5);
      if (acq) { c.other = acq; c.payload.acq = acq.id; }
      c.payload.premium = 0.22 + c.rng.next() * 0.15;
    },
    headline: ['Reports: {acq} exploring bid for {co}', '{co} soars on takeover speculation', '{acq} said to approach {co} about a deal'],
    body: ['{co} shares jumped after reports that {acq} has approached the company about a potential acquisition. Neither company commented. People familiar with the matter cautioned that talks are at an early stage and may not lead to a deal.'],
    explanation: 'Takeover rumours partially price in a bid premium. If the deal is confirmed the stock converges toward the offer; if talks collapse, the premium unwinds.',
    apply: (c) => { hit(c, c.inst!, 0.08, { volBoost: 2 }); if (c.other) hit(c, c.other, -0.015); },
    followUps: [{ id: 'mna_confirmed', prob: 0.45, delay: [1, 5] }, { id: 'mna_collapse', prob: 0.55, delay: [2, 7] }],
  },
  {
    id: 'mna_confirmed', category: 'corporate', scope: 'company', weight: 0, severity: 3, tone: 1,
    headline: ['{acq} agrees to buy {co} at {pct}% premium', 'It\'s official: {acq} to acquire {co}'],
    body: ['{acq} has agreed to acquire {co} in a deal valuing the company at a {pct}% premium to its undisturbed share price. The boards of both companies have approved the transaction, which is expected to close within months.'],
    explanation: 'Once a deal is agreed, the target trades just below the offer price (a merger-arbitrage spread). Acquirers often fall on concerns about overpaying.',
    apply: (c) => {
      const prem = Number(c.payload.premium ?? 0.25);
      hit(c, c.inst!, prem - 0.07, { spread: 0.1, scaleVol: false, immediate: 0.8, volBoost: 0.6 });
      c.inst!.volBoost = 0.5;
      adjustFundamentals(c.inst!, { fair: Math.log(1 + prem) });
      if (c.other) hit(c, c.other, -0.035);
    },
    setup: (c) => { c.vars.pct = pctStr(Number(c.payload.premium ?? 0.25) * 100); },
  },
  {
    id: 'mna_collapse', category: 'corporate', scope: 'company', weight: 0, severity: 2, tone: -1,
    headline: ['{acq}–{co} talks collapse', '{co} tumbles as takeover hopes fade'],
    body: ['Discussions between {acq} and {co} have ended without agreement, according to a statement from {co}. The shares gave back their takeover premium.'],
    explanation: 'The rumour premium unwinds when talks fail.',
    apply: (c) => { hit(c, c.inst!, -0.075, { volBoost: 1.6 }); if (c.other) hit(c, c.other, 0.01); },
  },
  {
    id: 'merger_direct', category: 'corporate', scope: 'company', weight: 1, severity: 3, tone: 1,
    condition: (i) => i.price * f(i).sharesOut < 40e9,
    setup: (c) => {
      const acq = pickPeer(c, (i) => i.price * f(i).sharesOut > c.inst!.price * f(c.inst!).sharesOut * 2);
      if (acq) { c.other = acq; c.payload.acq = acq.id; }
      c.payload.premium = 0.25 + c.rng.next() * 0.15;
      c.vars.pct = pctStr(Number(c.payload.premium) * 100);
    },
    headline: ['{acq} to acquire {co} in surprise deal', '{co} agrees {pct}% premium takeover by {acq}'],
    body: ['In a surprise announcement before the bell, {acq} said it will acquire {co} for cash at a {pct}% premium. The deal requires regulatory approval.'],
    explanation: 'Agreed takeovers re-price the target close to the offer price immediately.',
    apply: (c) => {
      const prem = Number(c.payload.premium ?? 0.3);
      hit(c, c.inst!, prem - 0.03, { spread: 0.08, scaleVol: false, immediate: 0.85 });
      c.inst!.volBoost = 0.5;
      adjustFundamentals(c.inst!, { fair: Math.log(1 + prem) });
      if (c.other) hit(c, c.other, -0.04);
    },
  },
  {
    id: 'regulatory_probe', category: 'corporate', scope: 'company', weight: 3, severity: 2, tone: -1,
    headline: ['Regulators open investigation into {co}\'s {topic}', '{co} under investigation over {topic}', '{tk} slides on regulatory probe'],
    body: ['{co} disclosed that regulators have opened a formal investigation into its {topic}. The company said it is cooperating fully. Analysts warned that fines could be material.'],
    explanation: 'Investigations create an open-ended liability. Outcomes range from a modest settlement to formal charges.',
    apply: (c) => { hit(c, c.inst!, -0.065, { volBoost: 1.7 }); adjustFundamentals(c.inst!, { fair: -0.03 }); },
    followUps: [{ id: 'probe_settled', prob: 0.55, delay: [4, 10] }, { id: 'probe_charges', prob: 0.45, delay: [4, 10] }],
  },
  {
    id: 'probe_settled', category: 'corporate', scope: 'company', weight: 0, severity: 1, tone: 1,
    headline: ['{co} settles regulatory probe for modest fine', '{co} resolves investigation'],
    body: ['{co} agreed to pay a fine to settle the investigation into its {topic}, without admitting wrongdoing. The amount was well below analyst estimates.'],
    explanation: 'Settlements remove uncertainty; if the penalty is smaller than feared, the stock recovers.',
    apply: (c) => { hit(c, c.inst!, 0.035); adjustFundamentals(c.inst!, { fair: 0.02 }); },
  },
  {
    id: 'probe_charges', category: 'corporate', scope: 'company', weight: 0, severity: 3, tone: -1,
    headline: ['Regulators bring charges against {co}', '{co} faces formal charges over {topic}'],
    body: ['Regulators filed formal charges against {co} relating to its {topic}, seeking substantial penalties and operating restrictions.'],
    explanation: 'Formal charges escalate the liability and can restrict the business.',
    apply: (c) => { hit(c, c.inst!, -0.1, { days: 2, dailyDrift: -0.008, volBoost: 2 }); adjustFundamentals(c.inst!, { fair: -0.08, trend: -0.1 }); },
  },
  {
    id: 'debt_concern', category: 'corporate', scope: 'company', weight: 3, severity: 2, tone: -1,
    condition: (i) => lev(i) > 0.9 || f(i).margin < 0.04 || f(i).quality < 35,
    headline: ['{co} bonds slide on refinancing fears', 'Debt worries mount at {co}', '{co} hires restructuring advisers, sources say'],
    body: ['{co}\'s bonds fell sharply amid concerns about its ability to refinance debt maturing next year. The company has {debt} of debt against thin margins.',
      'Credit analysts flagged {co}\'s rising leverage and weakening cash flow. The company insists it has adequate liquidity.'],
    explanation: 'Highly indebted companies are vulnerable when credit tightens. Equity holders rank last if things go wrong.',
    apply: (c) => { hit(c, c.inst!, -0.08, { days: 2, dailyDrift: -0.01, volBoost: 2 }); adjustFundamentals(c.inst!, { fair: -0.06, trend: -0.1 }); },
    followUps: [{ id: 'refinancing_success', prob: 0.5, delay: [3, 8] }, { id: 'credit_downgrade', prob: 0.5, delay: [2, 6] }],
  },
  {
    id: 'refinancing_success', category: 'corporate', scope: 'company', weight: 0, severity: 1, tone: 1,
    headline: ['{co} secures refinancing, easing debt fears', '{co} extends debt maturities'],
    body: ['{co} completed a refinancing that pushes its major maturities out by several years. Shares rebounded as default fears faded.'],
    explanation: 'Successful refinancing removes near-term default risk.',
    apply: (c) => { hit(c, c.inst!, 0.06); adjustFundamentals(c.inst!, { fair: 0.04 }); },
  },
  {
    id: 'credit_downgrade', category: 'corporate', scope: 'company', weight: 0, severity: 2, tone: -1,
    headline: ['{co} downgraded deeper into junk', 'Rating agency cuts {co}'],
    body: ['A rating agency downgraded {co}, citing weak cash generation and elevated leverage. The move raises the company\'s borrowing costs.'],
    explanation: 'Downgrades raise funding costs and can force some bondholders to sell.',
    apply: (c) => { hit(c, c.inst!, -0.06, { volBoost: 1.8 }); adjustFundamentals(c.inst!, { fair: -0.05, debtMult: 1.05 }); },
    followUps: [{ id: 'restructuring', prob: 0.35, delay: [3, 8] }],
  },
  {
    id: 'restructuring', category: 'corporate', scope: 'company', weight: 0, severity: 3, tone: -1,
    headline: ['{co} announces sweeping restructuring and equity raise', '{co} to issue shares to shore up balance sheet'],
    body: ['{co} unveiled a restructuring plan including job cuts, asset sales and a large discounted share issue to reduce debt. Existing shareholders face significant dilution.'],
    explanation: 'Dilutive equity raises transfer value from existing shareholders to creditors and new investors.',
    apply: (c) => { hit(c, c.inst!, -0.14, { volBoost: 2.2 }); adjustFundamentals(c.inst!, { fair: -0.1, debtMult: 0.7 }); f(c.inst!).sharesOut *= 1.15; },
  },
  {
    id: 'major_contract', category: 'corporate', scope: 'company', weight: 4, severity: 1, tone: 1,
    sectors: ['industrials', 'aerospace', 'tech', 'semis', 'telecom', 'energy', 'transport', 'health'],
    setup: (c) => { c.vars.amt = String(Math.round((f(c.inst!).revenue * (0.03 + c.rng.next() * 0.08)) / 1e6)); },
    headline: ['{co} wins ${amt}M contract from {customer}', '{co} lands multi-year deal with {customer}'],
    body: ['{co} announced a ${amt} million multi-year contract with {customer}, one of the largest in its history.'],
    explanation: 'Large contracts improve revenue visibility; the reaction depends on contract size relative to revenue.',
    apply: (c) => { hit(c, c.inst!, 0.035); adjustFundamentals(c.inst!, { trend: 0.08, fair: 0.025 }); },
  },
  {
    id: 'contract_loss', category: 'corporate', scope: 'company', weight: 2, severity: 1, tone: -1,
    sectors: ['industrials', 'aerospace', 'tech', 'semis', 'telecom', 'transport', 'health'],
    headline: ['{co} loses key customer', '{customer} drops {co} as supplier'],
    body: ['{co} said {customer} will not renew a major contract, removing a meaningful share of expected revenue.'],
    explanation: 'Losing a key customer directly cuts revenue forecasts.',
    apply: (c) => { hit(c, c.inst!, -0.05); adjustFundamentals(c.inst!, { trend: -0.1, fair: -0.035 }); },
  },
  {
    id: 'buyback', category: 'corporate', scope: 'company', weight: 3, severity: 1, tone: 1,
    condition: (i) => f(i).quality > 50 && f(i).margin > 0.06,
    setup: (c) => { c.vars.amt = ((c.inst!.price * f(c.inst!).sharesOut * (0.03 + c.rng.next() * 0.05)) / 1e9).toFixed(1); },
    headline: ['{co} announces ${amt}B share buyback', '{co} to return cash with new repurchase plan'],
    body: ['{co} authorised a ${amt} billion share repurchase programme, signalling confidence in its cash generation.'],
    explanation: 'Buybacks reduce share count and signal management confidence.',
    apply: (c) => { hit(c, c.inst!, 0.025); f(c.inst!).sharesOut *= 0.98; },
  },
  {
    id: 'dividend_hike', category: 'corporate', scope: 'company', weight: 2, severity: 1, tone: 1,
    condition: (i) => f(i).dividendYield > 0 && f(i).trend > -0.3,
    setup: (c) => { c.vars.pct = String(5 + c.rng.int(0, 15)); },
    headline: ['{co} lifts dividend by {pct}%', '{co} raises payout'],
    body: ['{co} increased its quarterly dividend by {pct}%, extending its record of shareholder returns.'],
    explanation: 'Dividend increases signal confidence in sustainable cash flow.',
    apply: (c) => { hit(c, c.inst!, 0.015); f(c.inst!).dividendYield *= 1 + Number(c.vars.pct) / 100; },
  },
  {
    id: 'dividend_cut', category: 'corporate', scope: 'company', weight: 1.5, severity: 2, tone: -1,
    condition: (i) => f(i).dividendYield > 0.015 && (f(i).quality < 50 || f(i).trend < -0.2),
    headline: ['{co} slashes dividend to conserve cash', '{co} cuts payout as profits slide'],
    body: ['{co} cut its dividend by half, saying it needs to preserve cash. Income investors are likely to sell.'],
    explanation: 'Dividend cuts often trigger selling from income-focused holders and signal financial stress.',
    apply: (c) => { hit(c, c.inst!, -0.07, { days: 1, dailyDrift: -0.006 }); f(c.inst!).dividendYield *= 0.5; adjustFundamentals(c.inst!, { fair: -0.03 }); },
  },
  {
    id: 'analyst_upgrade', category: 'corporate', scope: 'company', weight: 5, severity: 1, tone: 1,
    condition: (i) => f(i).fairValue > i.price * 0.95,
    headline: ['{broker} upgrades {co} to Buy', '{co} upgraded on improving outlook', '{broker} turns bullish on {tk}'],
    body: ['{broker} upgraded {co} to Buy, arguing the market underestimates its earnings power. The broker set a price target roughly 20% above the current price.'],
    explanation: 'Broker upgrades can move prices modestly, especially for less-covered companies.',
    apply: (c) => { hit(c, c.inst!, 0.02, { minutes: 90 }); },
  },
  {
    id: 'analyst_downgrade', category: 'corporate', scope: 'company', weight: 5, severity: 1, tone: -1,
    condition: (i) => f(i).fairValue < i.price * 1.05,
    headline: ['{broker} downgrades {co} to Sell', '{co} cut to Underweight', '{broker} sours on {tk}'],
    body: ['{broker} downgraded {co} to Sell, warning that consensus estimates look too optimistic.'],
    explanation: 'Downgrades can weigh on a stock, particularly if they question the earnings outlook.',
    apply: (c) => { hit(c, c.inst!, -0.025, { minutes: 90 }); },
  },
  {
    id: 'analyst_downgrade_fu', category: 'corporate', scope: 'company', weight: 0, severity: 1, tone: -1,
    headline: ['Analysts slash {co} targets after warning', 'Brokers cut {co} estimates'],
    body: ['Several brokers cut their price targets on {co} following its profit warning, with {broker} moving to Sell.'],
    explanation: 'After a warning, estimate cuts tend to follow over days, keeping pressure on the shares.',
    apply: (c) => { hit(c, c.inst!, -0.025, { days: 1, dailyDrift: -0.004 }); },
  },
  {
    id: 'short_report', category: 'corporate', scope: 'company', weight: 1.5, severity: 3, tone: -1,
    condition: (i) => f(i).quality < 60 && i.price * f(i).sharesOut < 60e9,
    headline: ['Short seller {shortseller} targets {co}, alleging {issue}', '{co} plunges after damning short report'],
    body: ['{shortseller} published a report accusing {co} of {issue} and disclosed a short position. {co} called the allegations "baseless" and promised a detailed rebuttal.'],
    explanation: 'Activist short reports cause sharp drops. The stock recovers if the rebuttal is convincing, or keeps falling if allegations are confirmed.',
    apply: (c) => { hit(c, c.inst!, -0.11, { volBoost: 2.5 }); },
    followUps: [{ id: 'short_rebuttal', prob: 0.6, delay: [1, 4] }, { id: 'short_vindicated', prob: 0.4, delay: [3, 9] }],
  },
  {
    id: 'short_rebuttal', category: 'corporate', scope: 'company', weight: 0, severity: 1, tone: 1,
    headline: ['{co} rebuts short seller, shares rebound', 'Auditor backs {co} after short attack'],
    body: ['{co} published a detailed rebuttal of the short report, backed by its auditor. Shares recovered much of the decline.'],
    explanation: 'A credible rebuttal unwinds much of the short-report discount.',
    apply: (c) => { hit(c, c.inst!, 0.07, { volBoost: 1.5 }); },
  },
  {
    id: 'short_vindicated', category: 'corporate', scope: 'company', weight: 0, severity: 3, tone: -1,
    headline: ['{co} restates results, vindicating short seller', '{co} admits accounting problems'],
    body: ['{co} said it will restate prior results after an internal review found problems related to {issue}. The chief financial officer has been placed on leave.'],
    explanation: 'Confirmed accounting problems destroy credibility; expect a sharp and lasting re-rating.',
    apply: (c) => { hit(c, c.inst!, -0.2, { days: 2, dailyDrift: -0.01, volBoost: 2.5 }); adjustFundamentals(c.inst!, { fair: -0.2, trend: -0.3, marginAdd: -0.02 }); },
  },
  {
    id: 'accounting_review', category: 'corporate', scope: 'company', weight: 0.8, severity: 3, tone: -1,
    condition: (i) => f(i).quality < 40,
    headline: ['{co} delays filing, flags accounting review', '{co} postpones results amid audit questions'],
    body: ['{co} said it will delay its quarterly filing while its audit committee reviews certain accounting matters. The company gave no timetable.'],
    explanation: 'Filing delays are a red flag; uncertainty is high until the review concludes.',
    apply: (c) => { hit(c, c.inst!, -0.12, { volBoost: 2.2 }); adjustFundamentals(c.inst!, { fair: -0.05 }); },
  },
  {
    id: 'data_breach', category: 'corporate', scope: 'company', weight: 2, severity: 2, tone: -1,
    sectors: ['tech', 'telecom', 'retail', 'financials', 'health', 'entertainment'],
    headline: ['{co} discloses major data breach', 'Hackers steal customer data from {co}'],
    body: ['{co} said attackers accessed records belonging to millions of customers. Regulators are expected to scrutinise its security practices.'],
    explanation: 'Breaches bring remediation costs, fines and customer churn.',
    apply: (c) => { hit(c, c.inst!, -0.05, { volBoost: 1.5 }); adjustFundamentals(c.inst!, { fair: -0.02 }); },
  },
  {
    id: 'labour_strike', category: 'corporate', scope: 'company', weight: 2, severity: 1, tone: -1,
    sectors: ['industrials', 'transport', 'aerospace', 'materials', 'discretionary', 'retail'],
    headline: ['Workers strike at {co} facilities', 'Strike halts production at {co}'],
    body: ['Unionised workers at {co} walked out after wage talks broke down, halting operations at several sites.'],
    explanation: 'Strikes disrupt output and can raise long-term labour costs.',
    apply: (c) => { hit(c, c.inst!, -0.03); adjustFundamentals(c.inst!, { marginAdd: -0.004 }); },
  },
  {
    id: 'drug_approval', category: 'corporate', scope: 'company', weight: 2, severity: 2, tone: 1,
    sectors: ['pharma'],
    headline: ['{co} wins approval for {drug}', 'Regulators clear {co}\'s {drug}'],
    body: ['Health regulators approved {co}\'s {drug}, opening a market analysts estimate at several billion dollars a year.'],
    explanation: 'Approvals convert pipeline hopes into revenue; the size of the move depends on how much was already priced in.',
    apply: (c) => { hit(c, c.inst!, 0.1, { volBoost: 1.8, days: 1, dailyDrift: 0.006 }); adjustFundamentals(c.inst!, { trend: 0.2, fair: 0.08, growth: 0.02 }); },
  },
  {
    id: 'trial_failure', category: 'corporate', scope: 'company', weight: 1.5, severity: 3, tone: -1,
    sectors: ['pharma'],
    headline: ['{co}\'s late-stage {drug} trial fails', '{co} plunges as {drug} misses primary endpoint'],
    body: ['{co} said its late-stage trial of {drug} failed to meet its primary goal. The drug accounted for a large share of the company\'s pipeline value.'],
    explanation: 'Trial failures can erase a large share of a drug developer\'s value overnight.',
    apply: (c) => { hit(c, c.inst!, -0.18, { volBoost: 2.4 }); adjustFundamentals(c.inst!, { trend: -0.3, fair: -0.16, growth: -0.03 }); },
  },
  {
    id: 'index_inclusion', category: 'market', scope: 'company', weight: 1.5, severity: 1, tone: 1,
    headline: ['{co} to be added to Quality Leaders ETF', 'Index rebalance: {co} joins major benchmark'],
    body: ['{co} will be added to a major index at the next rebalance, forcing tracker funds to buy the shares.'],
    explanation: 'Index additions create mechanical buying from passive funds, a temporary demand shock.',
    apply: (c) => { hit(c, c.inst!, 0.035, { minutes: 150 }); },
  },
  {
    id: 'insider_buying', category: 'corporate', scope: 'company', weight: 2.5, severity: 1, tone: 1,
    headline: ['{co} directors buy shares', 'Insiders load up on {tk}'],
    body: ['Several {co} directors, including the chief executive, bought shares in the open market this week, according to filings.'],
    explanation: 'Insider buying can signal management confidence, but the effect is typically small.',
    apply: (c) => { hit(c, c.inst!, 0.012); },
  },
  {
    id: 'lawsuit', category: 'corporate', scope: 'company', weight: 2, severity: 1, tone: -1,
    setup: (c) => { c.vars.amt = String(Math.round((f(c.inst!).revenue * (0.01 + c.rng.next() * 0.04)) / 1e6)); },
    headline: ['{co} hit with ${amt}M lawsuit', 'Court rules against {co} in ${amt}M case'],
    body: ['A court ordered {co} to pay ${amt} million in damages. The company said it will appeal.'],
    explanation: 'Legal judgments create one-off costs; the impact depends on size relative to the business.',
    apply: (c) => { hit(c, c.inst!, -0.025); adjustFundamentals(c.inst!, { fair: -0.01 }); },
  },
  {
    id: 'expansion', category: 'corporate', scope: 'company', weight: 2.5, severity: 1, tone: 1,
    headline: ['{co} announces expansion into {region}', '{co} unveils growth push in {region}'],
    body: ['{co} said it will invest heavily to expand into {region}, targeting a large untapped market.'],
    explanation: 'Expansion plans can lift growth expectations, though they also bring execution risk and costs.',
    apply: (c) => { hit(c, c.inst!, 0.018); adjustFundamentals(c.inst!, { growth: 0.01 }); },
  },
  {
    id: 'plant_fire', category: 'corporate', scope: 'company', weight: 1.5, severity: 2, tone: -1,
    sectors: ['materials', 'energy', 'industrials', 'semis'],
    headline: ['Fire halts production at {co} plant', 'Outage at {co} facility disrupts supply'],
    body: ['A fire at one of {co}\'s main facilities has halted production. The company said it is assessing the damage. Rivals may benefit from tighter supply.'],
    explanation: 'Production outages hurt the affected company but can help competitors through tighter supply.',
    apply: (c) => { hit(c, c.inst!, -0.055, { volBoost: 1.6 }); adjustFundamentals(c.inst!, { trend: -0.05 }); hitSector(c, c.inst!.sector as SectorId, 0.01, {}, c.inst!.id); },
  },
  {
    id: 'partnership', category: 'corporate', scope: 'company', weight: 2, severity: 1, tone: 1,
    setup: (c) => { const o = pickPeer(c, (i) => i.sector !== c.inst!.sector); if (o) { c.other = o; c.payload.acq = o.id; } },
    headline: ['{co} and {acq} announce strategic partnership', '{co} teams up with {acq}'],
    body: ['{co} and {acq} unveiled a long-term partnership combining their technologies and distribution.'],
    explanation: 'Partnerships can open new markets for both parties; reactions are usually modest.',
    apply: (c) => { hit(c, c.inst!, 0.025); if (c.other) hit(c, c.other, 0.015); },
  },
  {
    id: 'spinoff', category: 'corporate', scope: 'company', weight: 1, severity: 1, tone: 1,
    condition: (i) => i.price * f(i).sharesOut > 10e9,
    headline: ['{co} plans to spin off {ind} unit', '{co} to split into two companies'],
    body: ['{co} said it will separate its {ind} business into an independently listed company, arguing the parts are worth more than the whole.'],
    explanation: 'Break-ups can unlock a "conglomerate discount".',
    apply: (c) => { hit(c, c.inst!, 0.045); adjustFundamentals(c.inst!, { fair: 0.04 }); },
  },

  // ───────────────────────── Sector ─────────────────────────
  {
    id: 'sector_boom', category: 'sector', scope: 'sector', weight: 3, severity: 2, tone: 1,
    headline: ['{sec} stocks rally on strong demand outlook', 'Investors pile into {sec}', '{sec} shares surge on upbeat industry data'],
    body: ['{sec} companies rallied after an industry survey showed demand accelerating. Fund managers have been rotating into the sector.'],
    explanation: 'Sector-wide news moves most companies in the industry together, with high-beta names moving most.',
    apply: (c) => { hitSector(c, c.sector!, 0.025, { days: 2, dailyDrift: 0.003 }); c.state.sectors[c.sector!].shockDrift += 0.002; },
  },
  {
    id: 'sector_slump', category: 'sector', scope: 'sector', weight: 3, severity: 2, tone: -1,
    headline: ['{sec} sector slides as demand weakens', 'Selling sweeps through {sec} stocks', '{sec} hit by downbeat industry data'],
    body: ['{sec} stocks fell broadly after industry data pointed to a slowdown in orders. Several brokers cut sector estimates.'],
    explanation: 'Sector downturns hit the whole industry; diversified portfolios feel less of the effect.',
    apply: (c) => { hitSector(c, c.sector!, -0.03, { days: 2, dailyDrift: -0.003 }); c.state.sectors[c.sector!].shockDrift -= 0.002; },
  },
  {
    id: 'chip_shortage', category: 'sector', scope: 'sector', weight: 1.2, severity: 2, tone: 0,
    setup: (c) => { c.sector = 'semis'; },
    headline: ['Chip shortage deepens, hitting automakers', 'Semiconductor supply crunch spreads'],
    body: ['Lead times for key chips have stretched to record levels. Chipmakers are raising prices while carmakers and electronics firms warn of lost production.'],
    explanation: 'Shortages raise prices for suppliers (good for semiconductors) and hurt downstream manufacturers.',
    apply: (c) => { hitSector(c, 'semis', 0.025); hitSector(c, 'discretionary', -0.02); hitSector(c, 'tech', -0.008); },
    followUps: [{ id: 'shortage_eases', prob: 0.75, delay: [5, 12] }],
  },
  {
    id: 'shortage_eases', category: 'sector', scope: 'sector', weight: 0, severity: 1, tone: 0,
    setup: (c) => { c.sector = 'semis'; },
    headline: ['Chip supply improves as new capacity comes online', 'Semiconductor shortage shows signs of easing'],
    body: ['Industry data suggests the chip shortage is easing as new factories ramp up. Downstream manufacturers expect production to normalise.'],
    explanation: 'As shortages ease, the earlier winners and losers partly reverse.',
    apply: (c) => { hitSector(c, 'semis', -0.012); hitSector(c, 'discretionary', 0.015); },
  },
  {
    id: 'sector_regulation', category: 'sector', scope: 'sector', weight: 1.5, severity: 2, tone: -1,
    setup: (c) => { c.sector = c.rng.pick(['financials', 'tech', 'pharma', 'energy', 'entertainment', 'telecom'] as SectorId[]); },
    headline: ['Lawmakers unveil tougher rules for {sec}', 'Regulatory crackdown looms over {sec}'],
    body: ['A cross-party group of lawmakers proposed sweeping new rules for the {sec} industry, including stricter oversight and higher compliance costs.'],
    explanation: 'New regulation raises costs and can limit growth across an industry.',
    apply: (c) => { hitSector(c, c.sector!, -0.025, { days: 1, dailyDrift: -0.002 }); },
  },
  {
    id: 'sector_subsidy', category: 'sector', scope: 'sector', weight: 1.5, severity: 2, tone: 1,
    setup: (c) => { c.sector = c.rng.pick(['renewables', 'semis', 'aerospace', 'transport', 'utilities'] as SectorId[]); },
    headline: ['Government unveils subsidies for {sec}', 'New incentives boost {sec} outlook'],
    body: ['The government announced a multi-year package of tax credits and grants to support the {sec} industry.'],
    explanation: 'Subsidies improve the economics of an industry and support investment.',
    apply: (c) => { hitSector(c, c.sector!, 0.035, { days: 2, dailyDrift: 0.003 }); },
  },
  {
    id: 'drug_pricing', category: 'sector', scope: 'sector', weight: 1, severity: 2, tone: -1,
    setup: (c) => { c.sector = 'pharma'; },
    headline: ['Drug pricing reform plan rattles pharma stocks', 'Proposed price caps hit drugmakers'],
    body: ['A proposal to cap prices on widely used medicines sent pharmaceutical and healthcare shares lower.'],
    explanation: 'Price controls directly reduce expected revenues for drugmakers.',
    apply: (c) => { hitSector(c, 'pharma', -0.035); hitSector(c, 'health', -0.012); },
  },
  {
    id: 'housing_data', category: 'sector', scope: 'sector', weight: 1.5, severity: 1, tone: 0,
    setup: (c) => { c.sector = 'realestate'; c.payload.up = c.rng.chance(0.5) ? 1 : -1; c.vars.dir = Number(c.payload.up) > 0 ? 'jump' : 'slump'; },
    headline: ['Housing starts {dir}, moving property stocks', 'Home sales {dir} unexpectedly'],
    body: ['Housing data surprised economists, with activity showing a sharp {dir}. Real-estate, banking and home-goods stocks reacted.'],
    explanation: 'Housing activity drives property values, mortgage lending and home-related spending.',
    apply: (c) => { const u = Number(c.payload.up); hitSector(c, 'realestate', 0.018 * u); hitSector(c, 'financials', 0.008 * u); hitSector(c, 'discretionary', 0.008 * u); },
  },
  {
    id: 'tech_breakthrough', category: 'sector', scope: 'sector', weight: 1.2, severity: 2, tone: 1,
    setup: (c) => { c.sector = c.rng.pick(['semis', 'tech', 'renewables'] as SectorId[]); },
    headline: ['Breakthrough in {sec} research sparks rally', 'Researchers unveil major advance, lifting {sec}'],
    body: ['A widely publicised research breakthrough could reshape the {sec} industry. Investors bid up companies seen as likely beneficiaries.'],
    explanation: 'Technological breakthroughs raise growth expectations for an entire industry.',
    apply: (c) => { hitSector(c, c.sector!, 0.03, { days: 2, dailyDrift: 0.003 }); },
  },
  {
    id: 'consumer_confidence', category: 'economic', scope: 'sector', weight: 0.8, severity: 1, tone: 0,
    setup: (c) => { c.sector = 'retail'; c.payload.up = c.rng.chance(0.5) ? 1 : -1; c.vars.dir = Number(c.payload.up) > 0 ? 'rises' : 'falls'; },
    headline: ['Consumer confidence {dir} sharply', 'Shoppers\' mood {dir} to multi-month extreme'],
    body: ['A closely watched survey of consumer sentiment showed confidence {dir}, with households reporting changing spending plans.'],
    explanation: 'Consumer confidence feeds into spending on discretionary goods and retail.',
    apply: (c) => { const u = Number(c.payload.up); hitSector(c, 'retail', 0.015 * u); hitSector(c, 'discretionary', 0.018 * u); shiftMacro(c, { growth: 0.08 * u }); },
  },
  {
    id: 'travel_demand', category: 'sector', scope: 'sector', weight: 1, severity: 1, tone: 0,
    setup: (c) => { c.sector = 'transport'; c.payload.up = c.rng.chance(0.5) ? 1 : -1; c.vars.dir = Number(c.payload.up) > 0 ? 'record' : 'weak'; },
    headline: ['Airlines report {dir} bookings', 'Travel demand: {dir} season ahead'],
    body: ['Industry data showed {dir} forward bookings for the coming season, a key indicator for transport and leisure companies.'],
    explanation: 'Travel demand drives airline and leisure earnings.',
    apply: (c) => { const u = Number(c.payload.up); hitSector(c, 'transport', 0.022 * u); hitSector(c, 'entertainment', 0.008 * u); },
  },
  {
    id: 'defence_budget', category: 'sector', scope: 'sector', weight: 1, severity: 1, tone: 1,
    setup: (c) => { c.sector = 'aerospace'; },
    headline: ['Defence budget boost lifts aerospace stocks', 'Lawmakers approve record defence spending'],
    body: ['Lawmakers approved a significant increase in defence spending, with funds earmarked for aircraft, missiles and space systems.'],
    explanation: 'Higher defence budgets underpin multi-year revenue for contractors.',
    apply: (c) => { hitSector(c, 'aerospace', 0.025, { days: 1, dailyDrift: 0.003 }); },
  },
  {
    id: 'streaming_war', category: 'sector', scope: 'sector', weight: 1, severity: 1, tone: -1,
    setup: (c) => { c.sector = 'entertainment'; },
    headline: ['Price war erupts in streaming', 'Media stocks fall as competition intensifies'],
    body: ['Major streaming services cut subscription prices in a bid for market share, raising fears of a margin squeeze across media.'],
    explanation: 'Price wars compress margins across an industry.',
    apply: (c) => { hitSector(c, 'entertainment', -0.025); },
  },
  {
    id: 'bank_stress_test', category: 'sector', scope: 'sector', weight: 1, severity: 1, tone: 0,
    setup: (c) => { c.sector = 'financials'; c.payload.up = c.rng.chance(0.65) ? 1 : -1; c.vars.dir = Number(c.payload.up) > 0 ? 'pass' : 'struggle in'; },
    headline: ['Banks {dir} annual stress tests', 'Stress test results: lenders {dir} severe scenario'],
    body: ['The central bank published stress-test results. Most lenders {dir} the severe scenario, with implications for dividends and buybacks.'],
    explanation: 'Stress tests determine how much capital banks can return to shareholders.',
    apply: (c) => { hitSector(c, 'financials', 0.015 * Number(c.payload.up)); },
  },

  // ───────────────────────── Commodities ─────────────────────────
  {
    id: 'opec_cut', category: 'commodity', scope: 'commodity', weight: 1.5, severity: 3, tone: 1, commodities: ['CRUD'],
    headline: ['Oil producers agree surprise output cut', 'Crude surges as producers slash supply'],
    body: ['The major oil-producing nations agreed to cut output by more than expected, tightening global supply. Energy shares rallied while airlines fell.'],
    explanation: 'Supply cuts raise oil prices: good for producers, bad for fuel-intensive businesses, and inflationary.',
    apply: (c) => { hit(c, c.inst!, 0.075, { days: 2, dailyDrift: 0.008, volBoost: 1.8 }); shiftMacro(c, { oilSupply: 0.35, inflShock: 0.0005 }); hitSector(c, 'energy', 0.02); },
  },
  {
    id: 'oil_glut', category: 'commodity', scope: 'commodity', weight: 1.5, severity: 2, tone: -1, commodities: ['CRUD'],
    headline: ['Oil slumps as inventories swell', 'Crude glut deepens as demand falters'],
    body: ['Crude prices fell sharply after inventory data showed a large unexpected build. Analysts warned of oversupply.'],
    explanation: 'Oversupply pushes oil lower, hurting producers and helping consumers.',
    apply: (c) => { hit(c, c.inst!, -0.06, { days: 1, dailyDrift: -0.006 }); shiftMacro(c, { oilSupply: -0.3, inflShock: -0.0003 }); hitSector(c, 'energy', -0.018); },
  },
  {
    id: 'pipeline_outage', category: 'commodity', scope: 'commodity', weight: 1.2, severity: 1, tone: 1, commodities: ['CRUD', 'NGAS'],
    headline: ['Major pipeline outage disrupts {commodity} supply', 'Supply disruption lifts {commodity}'],
    body: ['An unplanned outage on a major pipeline has disrupted {commodity} flows. Repairs could take weeks.'],
    explanation: 'Supply disruptions lift prices temporarily until flows resume.',
    apply: (c) => { hit(c, c.inst!, 0.045, { volBoost: 1.5 }); shiftMacro(c, { oilSupply: 0.1 }); },
  },
  {
    id: 'mine_strike', category: 'commodity', scope: 'commodity', weight: 1.2, severity: 1, tone: 1, commodities: ['COPR'],
    headline: ['Strike shuts world\'s largest copper mine', 'Copper jumps on mine disruption'],
    body: ['Workers at one of the largest copper mines have walked out, removing a meaningful share of global supply.'],
    explanation: 'Mine outages tighten supply of industrial metals.',
    apply: (c) => { hit(c, c.inst!, 0.04); },
  },
  {
    id: 'gold_buying', category: 'commodity', scope: 'commodity', weight: 1.2, severity: 1, tone: 1, commodities: ['GOLD'],
    headline: ['Central banks step up gold purchases', 'Gold climbs on official-sector buying'],
    body: ['Data showed central banks bought gold at the fastest pace in years, diversifying reserves away from currencies.'],
    explanation: 'Sustained official buying supports gold prices.',
    apply: (c) => { hit(c, c.inst!, 0.022, { days: 2, dailyDrift: 0.002 }); },
  },
  {
    id: 'gold_selloff', category: 'commodity', scope: 'commodity', weight: 1, severity: 1, tone: -1, commodities: ['GOLD', 'SILV'],
    headline: ['{commodity} slides as investors chase yield', 'Investors dump {commodity} holdings'],
    body: ['{commodity} fell as rising real yields made non-yielding assets less attractive.'],
    explanation: 'Precious metals pay no income, so higher real yields reduce their appeal.',
    apply: (c) => { hit(c, c.inst!, -0.03); },
  },
  {
    id: 'harvest_failure', category: 'commodity', scope: 'commodity', weight: 1, severity: 2, tone: 1, commodities: ['WHET'],
    headline: ['Drought slashes wheat harvest forecasts', 'Wheat soars on crop failure'],
    body: ['A severe drought in key growing regions has cut harvest forecasts, sending wheat prices sharply higher. Food producers face higher costs.'],
    explanation: 'Crop failures raise food input costs and add to inflation.',
    apply: (c) => { hit(c, c.inst!, 0.08, { days: 2, dailyDrift: 0.006 }); shiftMacro(c, { inflShock: 0.0002 }); hitSector(c, 'staples', -0.008); },
  },
  {
    id: 'bumper_harvest', category: 'commodity', scope: 'commodity', weight: 1, severity: 1, tone: -1, commodities: ['WHET'],
    headline: ['Bumper harvest sends wheat lower', 'Record crop weighs on grain prices'],
    body: ['Favourable weather produced a record harvest, pushing wheat prices to multi-month lows.'],
    explanation: 'Abundant supply lowers prices.',
    apply: (c) => { hit(c, c.inst!, -0.05); },
  },
  {
    id: 'cold_snap', category: 'commodity', scope: 'commodity', weight: 1, severity: 2, tone: 1, commodities: ['NGAS'],
    headline: ['Cold snap sends natural gas soaring', 'Gas prices spike as temperatures plunge'],
    body: ['Forecasts for an extended cold spell have sent natural gas prices sharply higher as heating demand surges.'],
    explanation: 'Weather-driven demand spikes are a major driver of gas prices.',
    apply: (c) => { hit(c, c.inst!, 0.1, { volBoost: 2 }); hitSector(c, 'utilities', -0.006); },
  },
  {
    id: 'gas_storage', category: 'commodity', scope: 'commodity', weight: 1, severity: 1, tone: -1, commodities: ['NGAS'],
    headline: ['Natural gas falls on bigger storage build', 'Mild weather and full storage weigh on gas'],
    body: ['Weekly data showed a larger-than-expected build in gas storage, pushing prices lower.'],
    explanation: 'Full storage reduces the risk of shortages.',
    apply: (c) => { hit(c, c.inst!, -0.06); },
  },

  // ───────────────────────── Macro (unscheduled) ─────────────────────────
  {
    id: 'growth_revision', category: 'economic', scope: 'macro', weight: 0.6, severity: 2, tone: 0,
    setup: (c) => { c.payload.up = c.state.macro.growth > 2 ? (c.rng.chance(0.65) ? 1 : -1) : c.rng.chance(0.35) ? 1 : -1; c.vars.dir = Number(c.payload.up) > 0 ? 'upgrade' : 'cut'; },
    headline: ['Economists {dir} growth forecasts', 'International body {dir}s outlook for the economy'],
    body: ['A major forecasting body published a revised outlook, with an {dir} to expected growth for the coming year. Cyclical sectors are most exposed.'],
    explanation: 'Growth expectations matter most for cyclical sectors such as industrials, materials and consumer discretionary.',
    apply: (c) => { const u = Number(c.payload.up); shiftMacro(c, { growth: 0.25 * u, growthShock: 0.0008 * u, sentiment: 0.08 * u }); hitMarket(c, 0.006 * u); },
  },
  {
    id: 'trade_deal', category: 'economic', scope: 'macro', weight: 0.4, severity: 2, tone: 1,
    headline: ['Breakthrough trade deal lifts markets', 'Major economies agree tariff cuts'],
    body: ['Negotiators announced a broad trade agreement that will reduce tariffs on industrial goods and commodities.'],
    explanation: 'Lower trade barriers support global growth, especially for exporters and industrial firms.',
    apply: (c) => { hitMarket(c, 0.012); hitSector(c, 'industrials', 0.012); hitSector(c, 'materials', 0.012); shiftMacro(c, { sentiment: 0.15, geopolitics: -0.1, growth: 0.1 }); },
  },
  {
    id: 'trade_tension', category: 'economic', scope: 'macro', weight: 0.5, severity: 2, tone: -1,
    headline: ['Trade tensions escalate with new tariffs', 'Tariff threats rattle global markets'],
    body: ['Two major economies announced retaliatory tariffs, reigniting fears of a trade war. Exporters and semiconductor companies were hit hardest.'],
    explanation: 'Trade wars disrupt supply chains and weigh on growth and sentiment.',
    apply: (c) => { hitMarket(c, -0.015); hitSector(c, 'semis', -0.015); hitSector(c, 'industrials', -0.01); shiftMacro(c, { sentiment: -0.15, geopolitics: 0.12, growth: -0.1, volShock: 0.15 }); },
  },
  {
    id: 'fiscal_stimulus', category: 'economic', scope: 'macro', weight: 0.35, severity: 2, tone: 1,
    headline: ['Government unveils major spending package', 'Stimulus plan boosts growth hopes'],
    body: ['The government announced a large fiscal package focused on infrastructure and household support.'],
    explanation: 'Stimulus supports growth but can add to inflation and push up bond yields.',
    apply: (c) => { hitMarket(c, 0.01); hitSector(c, 'industrials', 0.015); hitSector(c, 'materials', 0.012); shiftMacro(c, { growth: 0.2, inflation: 0.1, sentiment: 0.1 }); },
  },
  {
    id: 'bond_selloff', category: 'economic', scope: 'macro', weight: 0.5, severity: 2, tone: -1,
    headline: ['Bond yields spike in sharp sell-off', 'Rising yields pressure rate-sensitive stocks'],
    body: ['Government bond yields jumped as investors demanded more compensation for inflation risk. Utilities, real estate and growth stocks fell.'],
    explanation: 'Higher yields reduce the present value of distant earnings and make bond-like stocks less attractive.',
    apply: (c) => { hitRates(c, 0.2); shiftMacro(c, { sentiment: -0.05 }); },
  },
  {
    id: 'relief_rally', category: 'market', scope: 'market', weight: 0.5, severity: 1, tone: 1,
    condition: (_i, st) => st.macro.sentiment < 0,
    headline: ['Stocks stage broad relief rally', 'Bargain hunters lift beaten-down market'],
    body: ['Stocks rallied across the board as investors judged recent selling overdone.'],
    explanation: 'After sharp declines, short covering and bargain hunting can drive broad rebounds.',
    apply: (c) => { hitMarket(c, 0.012); shiftMacro(c, { sentiment: 0.12 }); },
  },
  {
    id: 'risk_off', category: 'market', scope: 'market', weight: 0.5, severity: 2, tone: -1,
    headline: ['Risk-off mood grips markets', 'Volatility jumps as investors seek safety'],
    body: ['Investors moved into cash and gold as a series of worrying data points and headlines weighed on sentiment.'],
    explanation: 'Broad risk aversion hits high-beta assets hardest and supports safe havens.',
    apply: (c) => { hitMarket(c, -0.014); hit(c, commodity(c.state, 'GOLD'), 0.012); shiftMacro(c, { sentiment: -0.12, volShock: 0.2 }); },
  },

  // ───────────────────────── Hard-only crises ─────────────────────────
  {
    id: 'banking_crisis', category: 'breaking', scope: 'company', weight: 0.25, severity: 4, tone: -1, hardOnly: true, sectors: ['financials'],
    headline: ['{co} collapses as depositors flee', 'BREAKING: Run on {co} sparks banking panic'],
    body: ['Regulators seized {co} after a dramatic run on deposits. Contagion fears swept through the financial system, with lenders posting their worst day in years and credit spreads blowing out.'],
    explanation: 'A bank failure can trigger contagion: credit tightens, financials crash and the wider economy suffers. Safe havens rally.',
    apply: (c) => {
      hit(c, c.inst!, -0.55, { immediate: 0.8, volBoost: 3 });
      adjustFundamentals(c.inst!, { fair: -0.6, trend: -0.6 });
      hitSector(c, 'financials', -0.1, { days: 3, dailyDrift: -0.01 }, c.inst!.id);
      hitMarket(c, -0.045, { days: 3, dailyDrift: -0.006 });
      hit(c, commodity(c.state, 'GOLD'), 0.04);
      shiftMacro(c, { credit: 2, sentiment: -0.5, volShock: 1.0, growth: -0.8 });
      setRegime(c, 'crisis');
    },
    followUps: [{ id: 'emergency_cut', prob: 0.8, delay: [1, 3] }],
  },
  {
    id: 'geopolitical_conflict', category: 'breaking', scope: 'macro', weight: 0.25, severity: 4, tone: -1, hardOnly: true,
    headline: ['Armed conflict erupts in {region}', 'BREAKING: Military escalation in {region} roils markets'],
    body: ['Fighting broke out in {region}, threatening key shipping lanes and energy supplies. Oil and gold surged while equities sold off sharply.'],
    explanation: 'Geopolitical shocks raise energy prices and risk premiums, hitting equities and supporting safe havens and defence stocks.',
    apply: (c) => {
      hitMarket(c, -0.04, { days: 2, dailyDrift: -0.004 });
      hit(c, commodity(c.state, 'CRUD'), 0.13, { volBoost: 2.5 });
      hit(c, commodity(c.state, 'GOLD'), 0.05);
      hit(c, commodity(c.state, 'WHET'), 0.07);
      hitSector(c, 'aerospace', 0.05);
      hitSector(c, 'transport', -0.05);
      shiftMacro(c, { geopolitics: 0.6, sentiment: -0.4, volShock: 0.8, oilSupply: 0.5 });
      if (c.state.macro.regime !== 'crisis') setRegime(c, 'bear');
    },
  },
  {
    id: 'sovereign_default', category: 'breaking', scope: 'macro', weight: 0.2, severity: 4, tone: -1, hardOnly: true,
    headline: ['{country} defaults on its debt', 'BREAKING: {country} misses bond payment'],
    body: ['{country} failed to make a scheduled bond payment, triggering a sovereign default. Banks with exposure tumbled and investors fled to safety.'],
    explanation: 'Sovereign defaults hit lenders and spread fear through credit markets.',
    apply: (c) => { hitMarket(c, -0.03); hitSector(c, 'financials', -0.06); hit(c, commodity(c.state, 'GOLD'), 0.03); shiftMacro(c, { credit: 1, sentiment: -0.3, volShock: 0.5 }); },
  },
  {
    id: 'pandemic_scare', category: 'breaking', scope: 'macro', weight: 0.2, severity: 4, tone: -1, hardOnly: true,
    headline: ['Novel virus outbreak triggers lockdown fears', 'BREAKING: Health emergency declared as outbreak spreads'],
    body: ['Health authorities declared an emergency as a fast-spreading virus prompted travel restrictions. Travel and leisure stocks collapsed while vaccine makers soared.'],
    explanation: 'Pandemics devastate travel and in-person businesses while helping healthcare and some technology firms.',
    apply: (c) => {
      hitMarket(c, -0.04, { days: 3, dailyDrift: -0.005 });
      hitSector(c, 'transport', -0.12); hitSector(c, 'entertainment', -0.05); hitSector(c, 'pharma', 0.07); hitSector(c, 'health', 0.03);
      hit(c, commodity(c.state, 'CRUD'), -0.1);
      shiftMacro(c, { growth: -1.0, sentiment: -0.5, volShock: 1.0 });
      setRegime(c, 'crisis');
    },
    followUps: [{ id: 'emergency_cut', prob: 0.7, delay: [2, 5] }],
  },
  {
    id: 'flash_crash', category: 'breaking', scope: 'market', weight: 0.3, severity: 4, tone: -1, hardOnly: true,
    headline: ['Flash crash: stocks plunge in minutes', 'BREAKING: Algorithmic selling triggers market plunge'],
    body: ['Equities plunged in a matter of minutes as automated selling overwhelmed liquidity. Trading was briefly halted in several names.'],
    explanation: 'Flash crashes are liquidity events; prices often partly recover once order books refill.',
    apply: (c) => { hitMarket(c, -0.06, { immediate: 0.9, minutes: 10, volBoost: 2.5 }); shiftMacro(c, { volShock: 0.8, sentiment: -0.2 }); },
    followUps: [{ id: 'flash_recovery', prob: 0.85, delay: [1, 1] }],
  },
  {
    id: 'flash_recovery', category: 'market', scope: 'market', weight: 0, severity: 2, tone: 1,
    headline: ['Markets claw back flash-crash losses', 'Stocks rebound after yesterday\'s plunge'],
    body: ['Stocks recovered much of the previous session\'s sudden plunge as liquidity returned and regulators reviewed the trading data.'],
    explanation: 'Liquidity-driven drops tend to partially reverse.',
    apply: (c) => { hitMarket(c, 0.035); shiftMacro(c, { sentiment: 0.15 }); },
  },
  {
    id: 'emergency_cut', category: 'centralbank', scope: 'macro', weight: 0, severity: 4, tone: 1,
    headline: ['Central bank announces emergency rate cut', 'BREAKING: Policymakers slash rates in surprise move'],
    body: ['In an unscheduled meeting, the central bank cut its policy rate by half a percentage point and pledged to provide liquidity to stabilise markets.'],
    explanation: 'Emergency easing lowers funding costs and supports asset prices, though it signals how serious conditions are.',
    apply: (c) => { c.state.macro.policyRate = Math.max(0, c.state.macro.policyRate - 0.5); hitRates(c, -0.5); hitMarket(c, 0.02); shiftMacro(c, { sentiment: 0.2 }); },
  },
];

export const TEMPLATE_BY_ID: Record<string, EventTemplate> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
