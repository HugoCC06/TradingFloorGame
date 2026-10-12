import { SECTORS, type SectorId } from '../config/sectors';
import type { Rng } from './rng';
import type { Fundamentals, Instrument } from './types';
import { companyName, makeTicker } from './names';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function baseInstrument(partial: Partial<Instrument> & Pick<Instrument, 'idx' | 'id' | 'kind' | 'name' | 'sector' | 'industry' | 'price'>): Instrument {
  return {
    description: '',
    prevClose: partial.price,
    dayOpen: partial.price,
    dayHigh: partial.price,
    dayLow: partial.price,
    dayVolume: 0,
    adv: 1_000_000,
    vol: 0.02,
    beta: 1,
    sectorLoading: 1,
    halfSpreadBps: 3,
    shortable: true,
    borrowFee: 0.005,
    volBoost: 1,
    newsTone: 0,
    lastEventDay: -999,
    sysAcc: 0,
    activeStory: null,
    ...partial,
  };
}

const DESCRIPTORS: Record<SectorId, string[]> = {
  tech: ['enterprise software platforms', 'cloud infrastructure services', 'cybersecurity products', 'data analytics tools', 'developer tooling'],
  semis: ['advanced logic chips', 'memory products', 'semiconductor manufacturing equipment', 'power semiconductors', 'networking silicon'],
  health: ['medical devices', 'diagnostic testing', 'outpatient care networks', 'health insurance plans', 'surgical robotics'],
  pharma: ['oncology therapies', 'generic medicines', 'vaccines', 'rare-disease treatments', 'biologic drugs'],
  financials: ['retail and commercial banking', 'asset management', 'payments processing', 'property and casualty insurance', 'brokerage services'],
  discretionary: ['electric and combustion vehicles', 'leisure resorts', 'premium apparel', 'home furnishings', 'casual dining restaurants'],
  staples: ['packaged foods', 'soft drinks', 'household cleaning products', 'personal care brands', 'dairy and bakery products'],
  industrials: ['heavy machinery', 'construction services', 'electrical equipment', 'industrial automation', 'HVAC systems'],
  energy: ['integrated oil and gas operations', 'shale exploration and production', 'fuel refining', 'oilfield services', 'pipeline networks'],
  utilities: ['regulated electricity distribution', 'water utilities', 'natural gas distribution', 'power generation'],
  telecom: ['wireless networks', 'fibre broadband', 'communications towers', 'satellite connectivity'],
  realestate: ['office buildings', 'apartment communities', 'logistics warehouses', 'data centres', 'shopping centres'],
  materials: ['specialty chemicals', 'copper and iron ore mining', 'steel production', 'packaging materials', 'gold mining'],
  transport: ['passenger airlines', 'freight rail', 'trucking and logistics', 'container shipping'],
  renewables: ['solar panels and installation', 'wind farms', 'grid-scale batteries', 'green hydrogen'],
  aerospace: ['commercial aircraft components', 'defence systems', 'satellite launch services', 'avionics'],
  entertainment: ['video streaming', 'video games', 'film studios', 'live events', 'social media apps'],
  retail: ['e-commerce marketplaces', 'department stores', 'discount retail', 'specialty retail', 'grocery chains'],
};

/** Fixed tickers for sector ETFs (reserved before equities are named). */
export const SECTOR_ETF: Record<SectorId, string> = {
  tech: 'FTEC', semis: 'FSEM', health: 'FHLT', pharma: 'FPHM', financials: 'FFIN', discretionary: 'FDSC', staples: 'FSTP',
  industrials: 'FIND', energy: 'FNRG', utilities: 'FUTL', telecom: 'FTEL', realestate: 'FREI', materials: 'FMAT',
  transport: 'FTRN', renewables: 'FRNW', aerospace: 'FAER', entertainment: 'FENT', retail: 'FRTL',
};

export interface Universe {
  instruments: Instrument[];
  benchmarkIdx: number;
}

/**
 * Procedurally generate the full instrument universe from the seeded RNG.
 * Fundamentals are generated to be internally coherent: quality drives margins
 * and balance-sheet strength, growth drives valuation multiples, and volatility
 * reflects size, leverage and growth.
 */
export function generateUniverse(rng: Rng, startDay: number): Universe {
  const usedNames = new Set<string>();
  const usedTickers = new Set<string>(['GOLD', 'SILV', 'CRUD', 'NGAS', 'COPR', 'WHET', 'TFX', 'TFEW', 'AIQ', 'CLNE', 'DIVY', 'SMLC', 'QUAL', 'DEFN', ...Object.values(SECTOR_ETF)]);
  const instruments: Instrument[] = [];

  // --- Commodities first so equities can link to them ---
  const commodityDefs: { id: string; name: string; driver: NonNullable<Instrument['commodity']>['driver']; price: number; unit: string; vol: number; beta: number; desc: string }[] = [
    { id: 'GOLD', name: 'Gold', driver: 'gold', price: 1950, unit: 'troy oz', vol: 0.011, beta: 0.05, desc: 'Precious metal. Tends to rise when real interest rates fall, inflation runs hot or geopolitical tension spikes.' },
    { id: 'SILV', name: 'Silver', driver: 'silver', price: 24.5, unit: 'troy oz', vol: 0.019, beta: 0.3, desc: 'Precious and industrial metal; trades partly like gold, partly like copper.' },
    { id: 'CRUD', name: 'Crude Oil', driver: 'oil', price: 78, unit: 'barrel', vol: 0.021, beta: 0.45, desc: 'Benchmark crude. Driven by global growth, producer supply decisions and geopolitical disruption.' },
    { id: 'NGAS', name: 'Natural Gas', driver: 'gas', price: 3.2, unit: 'MMBtu', vol: 0.032, beta: 0.15, desc: 'Highly volatile energy commodity sensitive to weather, storage and supply shocks.' },
    { id: 'COPR', name: 'Copper', driver: 'copper', price: 4.1, unit: 'lb', vol: 0.015, beta: 0.6, desc: 'Industrial metal and bellwether for global growth and construction demand.' },
    { id: 'WHET', name: 'Wheat', driver: 'wheat', price: 6.2, unit: 'bushel', vol: 0.018, beta: 0.1, desc: 'Agricultural staple. Sensitive to harvest reports, weather and export disruptions.' },
  ];
  for (const c of commodityDefs) {
    const idx = instruments.length;
    const link = c.id === 'SILV' ? { idx: 0, load: 0.55 } : undefined;
    instruments.push(baseInstrument({
      idx, id: c.id, kind: 'commodity', name: c.name, sector: 'commodity', industry: 'Commodity', price: c.price,
      description: c.desc, vol: c.vol, beta: c.beta, sectorLoading: 0, halfSpreadBps: 2.5, adv: Math.round(4e9 / c.price / 20),
      borrowFee: 0.01, link, commodity: { unit: c.unit, driver: c.driver, description: c.desc, anchor: c.price },
    }));
  }
  const cIdx = (id: string) => instruments.findIndex((i) => i.id === id);

  // --- Equities ---
  for (const sec of SECTORS) {
    for (let k = 0; k < sec.count; k++) {
      const name = companyName(rng, sec.id, usedNames);
      const ticker = makeTicker(name, usedTickers, rng);
      const quality = clamp(50 + 20 * rng.normal(), 5, 98);
      const q = quality / 100;
      const sizeZ = rng.normal();
      const mcap = clamp(Math.exp(Math.log(14e9) + 1.25 * sizeZ), 3e8, 9e11);
      const growthT = clamp(rng.next() * 0.8 + q * 0.2 + rng.normal() * 0.1, 0, 1);
      const revGrowth = lerp(sec.revGrowth[0], sec.revGrowth[1], growthT) + rng.normal() * 0.02;
      const margin = clamp(lerp(sec.margin[0], sec.margin[1], clamp(q * 0.75 + rng.next() * 0.35, 0, 1)), sec.margin[0] - 0.05, sec.margin[1] + 0.03);
      const psT = clamp(growthT * 0.6 + q * 0.4 + rng.normal() * 0.12, 0, 1);
      const ps = lerp(sec.ps[0], sec.ps[1], psT);
      const revenue = mcap / ps;
      const earnings = revenue * margin;
      const price = clamp(Math.exp(Math.log(55) + 0.85 * rng.normal()), 4, 900);
      const sharesOut = mcap / price;
      const debt = revenue * lerp(sec.debtToRev[0], sec.debtToRev[1], clamp(1 - q + rng.normal() * 0.2, 0, 1));
      const cash = revenue * clamp(0.05 + 0.3 * q * rng.next() + 0.05 * rng.next(), 0.02, 0.6);
      const dividendYield = margin > 0.03 && revGrowth < 0.15 && rng.chance(0.75) ? lerp(sec.dividend[0], sec.dividend[1], rng.next()) : 0;
      const smallCap = clamp((Math.log(20e9) - Math.log(mcap)) / 3, -0.5, 1);
      const leverage = debt / Math.max(revenue, 1);
      const vol = 0.88 * sec.vol * (0.8 + 0.35 * rng.next()) * (1 + 0.25 * smallCap + 0.25 * growthT + 0.2 * (1 - q) + (margin < 0 ? 0.25 : 0));
      const beta = clamp(sec.beta * (0.85 + 0.3 * rng.next()) + 0.15 * growthT + 0.1 * Math.min(leverage, 2) - 0.1, 0.25, 2.4);
      const halfSpreadBps = clamp(1 + 9 * clamp(smallCap, 0, 1) + (1 - q) * 3 + rng.next() * 2, 1, 18);
      const turnover = 0.004 + rng.next() * 0.01 + growthT * 0.004;
      const adv = Math.round(sharesOut * turnover);
      const htb = rng.chance(0.08 + 0.15 * (1 - q) * clamp(smallCap, 0, 1));
      const shortable = !(htb && rng.chance(0.25)) && mcap > 5e8;
      const borrowFee = htb ? 0.04 + rng.next() * 0.2 : 0.003 + rng.next() * 0.007;
      const industry = rng.pick(sec.industries);
      const eps = earnings / sharesOut;
      const trend = clamp(rng.normal() * 0.45 + (growthT - 0.5) * 0.3, -1, 1);
      const growthExpect = clamp(revGrowth * 0.7 + rng.normal() * 0.02, -0.05, 0.4);
      const fundamentals: Fundamentals = {
        sharesOut, revenue, earnings, revGrowth, epsGrowth: revGrowth * (1 + rng.normal() * 0.6) + (margin < 0 ? -0.1 : 0),
        margin, debt, cash, dividendYield, quality,
        growthExpect,
        rateSens: sec.rateSens * (0.7 + 0.6 * rng.next()) * (1 + 0.4 * Math.min(leverage, 2) / 2),
        growthSens: sec.growthSens * (0.7 + 0.6 * rng.next()),
        inflationSens: sec.inflationSens * (0.7 + 0.6 * rng.next()),
        fairValue: price * Math.exp(rng.normal() * 0.12 + trend * 0.05),
        trend,
        consensusEps: (eps / 4) * (1 + growthExpect / 4),
        nextEarningsDay: startDay + rng.int(2, 62),
        earningsTiming: rng.chance(0.5) ? 'pre' : 'post',
        earningsHistory: [],
        quarterlyEps: eps / 4,
      };
      const idx = instruments.length;
      let link: Instrument['link'];
      if (sec.id === 'energy') link = { idx: cIdx('CRUD'), load: 0.55 + rng.next() * 0.3 };
      else if (industry === 'Gold Mining') link = { idx: cIdx('GOLD'), load: 1.2 + rng.next() * 0.6 };
      else if (industry === 'Metals & Mining') link = { idx: cIdx('COPR'), load: 0.7 + rng.next() * 0.4 };
      else if (industry === 'Airlines') link = { idx: cIdx('CRUD'), load: -(0.3 + rng.next() * 0.25) };
      else if (sec.id === 'staples' && industry === 'Food Products') link = { idx: cIdx('WHET'), load: -(0.1 + rng.next() * 0.15) };
      const descriptor = rng.pick(DESCRIPTORS[sec.id]);
      const description = `${name} is a ${mcap > 50e9 ? 'large' : mcap > 5e9 ? 'mid-sized' : 'smaller'} ${sec.name.toLowerCase()} company focused on ${descriptor}. ` +
        `${q > 0.7 ? 'It is regarded as a high-quality operator with a strong balance sheet.' : q < 0.35 ? 'Investors worry about its thin margins and balance sheet.' : 'It has a solid but unremarkable track record.'} ` +
        `${growthT > 0.7 ? 'The market expects rapid growth.' : growthT < 0.3 ? 'Growth has been sluggish.' : ''}`.trim();
      instruments.push(baseInstrument({
        idx, id: ticker, kind: 'equity', name, sector: sec.id, industry, price, description,
        adv, vol, beta, sectorLoading: 0.6 + rng.next() * 0.6, halfSpreadBps, shortable, borrowFee, fundamentals, link,
      }));
    }
  }

  const equities = instruments.filter((i) => i.kind === 'equity');
  const mcapOf = (i: Instrument) => i.price * (i.fundamentals?.sharesOut ?? 0);

  // --- ETFs ---
  const etfDefs: { id: string; name: string; theme: string; pick: Instrument[]; weight: 'cap' | 'equal'; price: number }[] = [];
  etfDefs.push({ id: 'TFX', name: 'TF Composite Index ETF', theme: 'Broad market (cap-weighted) — the game benchmark', pick: equities, weight: 'cap', price: 420 });
  etfDefs.push({ id: 'TFEW', name: 'TF Equal Weight ETF', theme: 'Broad market (equal-weighted)', pick: equities, weight: 'equal', price: 160 });
  for (const sec of SECTORS) {
    const members = equities.filter((e) => e.sector === sec.id);
    const id = SECTOR_ETF[sec.id];
    etfDefs.push({ id, name: `${sec.name} Select ETF`, theme: `${sec.name} sector`, pick: members, weight: 'cap', price: 40 + rng.next() * 120 });
  }
  const top = (arr: Instrument[], n: number, key: (i: Instrument) => number) => [...arr].sort((a, b) => key(b) - key(a)).slice(0, n);
  const f = (i: Instrument) => i.fundamentals!;
  const themed: [string, string, string, Instrument[]][] = [
    ['AIQ', 'Intelligent Computing ETF', 'High-growth software & semiconductors', top(equities.filter((e) => e.sector === 'tech' || e.sector === 'semis'), 15, (e) => f(e).revGrowth)],
    ['CLNE', 'Clean Transition ETF', 'Renewables, storage & clean utilities', top(equities.filter((e) => e.sector === 'renewables' || e.sector === 'utilities'), 14, (e) => f(e).revGrowth)],
    ['DIVY', 'Dividend Income ETF', 'Highest dividend yields across sectors', top(equities, 25, (e) => f(e).dividendYield)],
    ['SMLC', 'Small Cap ETF', 'Smallest 40 listed companies', top(equities, 40, (e) => -mcapOf(e))],
    ['QUAL', 'Quality Leaders ETF', 'Top 30 companies by business quality', top(equities, 30, (e) => f(e).quality)],
    ['DEFN', 'Defensive Sectors ETF', 'Staples, utilities & healthcare', equities.filter((e) => ['staples', 'utilities', 'health'].includes(e.sector))],
  ];
  for (const [id, name, theme, pick] of themed) {
    etfDefs.push({ id, name, theme, pick, weight: id === 'SMLC' ? 'equal' : 'cap', price: 30 + rng.next() * 90 });
  }

  let benchmarkIdx = -1;
  for (const def of etfDefs) {
    const idx = instruments.length;
    const ws = def.pick.map((e) => (def.weight === 'cap' ? mcapOf(e) : 1));
    const tot = ws.reduce((a, b) => a + b, 0);
    const constituents = def.pick.map((e, k) => ({ idx: e.idx, w: ws[k] / tot }));
    const beta = constituents.reduce((a, c) => a + c.w * instruments[c.idx].beta, 0);
    const avgVol = constituents.reduce((a, c) => a + c.w * instruments[c.idx].vol, 0);
    const vol = avgVol * Math.min(1, 0.45 + 2.2 / Math.sqrt(constituents.length + 1));
    const etfSector = (def.pick.every((p) => p.sector === def.pick[0].sector) ? def.pick[0].sector : 'broad') as Instrument['sector'];
    if (def.id === 'TFX') benchmarkIdx = idx;
    instruments.push(baseInstrument({
      idx, id: def.id, kind: 'etf', name: def.name, sector: etfSector, industry: 'Exchange-Traded Fund', price: Math.round(def.price * 100) / 100,
      description: `${def.name} tracks a basket of ${constituents.length} companies: ${def.theme.toLowerCase()}.`,
      vol, beta, sectorLoading: 0, halfSpreadBps: def.id === 'TFX' ? 0.5 : 1.5 + rng.next() * 2, adv: Math.round((def.id === 'TFX' ? 3e9 : 2e8 + rng.next() * 3e8) / def.price),
      borrowFee: 0.004, etf: { constituents, theme: def.theme, expenseRatio: def.id === 'TFX' ? 0.0005 : 0.0035 },
    }));
  }

  return { instruments, benchmarkIdx };
}
