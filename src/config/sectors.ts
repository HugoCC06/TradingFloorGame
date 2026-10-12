export type SectorId =
  | 'tech' | 'semis' | 'health' | 'pharma' | 'financials' | 'discretionary' | 'staples'
  | 'industrials' | 'energy' | 'utilities' | 'telecom' | 'realestate' | 'materials'
  | 'transport' | 'renewables' | 'aerospace' | 'entertainment' | 'retail';

export interface SectorDef {
  id: SectorId;
  name: string;
  /** number of equities generated in this sector */
  count: number;
  industries: string[];
  /** typical daily volatility (fraction) */
  vol: number;
  beta: number;
  /** sensitivity to growth surprises / interest-rate changes / inflation */
  growthSens: number;
  rateSens: number;
  inflationSens: number;
  margin: [number, number];
  revGrowth: [number, number];
  /** price-to-sales multiple range */
  ps: [number, number];
  dividend: [number, number];
  debtToRev: [number, number];
  cyclical: boolean;
}

export const SECTORS: SectorDef[] = [
  { id: 'tech', name: 'Technology', count: 20, industries: ['Software', 'Cloud Infrastructure', 'Cybersecurity', 'IT Services', 'Data Analytics'], vol: 0.022, beta: 1.2, growthSens: 1.2, rateSens: -1.3, inflationSens: -0.5, margin: [0.08, 0.32], revGrowth: [0.04, 0.35], ps: [3, 12], dividend: [0, 0.012], debtToRev: [0, 0.6], cyclical: false },
  { id: 'semis', name: 'Semiconductors', count: 13, industries: ['Chip Design', 'Foundry', 'Equipment', 'Memory'], vol: 0.027, beta: 1.45, growthSens: 1.5, rateSens: -1.1, inflationSens: -0.4, margin: [0.06, 0.35], revGrowth: [-0.05, 0.4], ps: [2.5, 11], dividend: [0, 0.015], debtToRev: [0.05, 0.6], cyclical: true },
  { id: 'health', name: 'Healthcare', count: 13, industries: ['Medical Devices', 'Health Services', 'Diagnostics', 'Insurance'], vol: 0.016, beta: 0.85, growthSens: 0.4, rateSens: -0.4, inflationSens: -0.2, margin: [0.04, 0.2], revGrowth: [0.02, 0.15], ps: [1, 5], dividend: [0, 0.02], debtToRev: [0.1, 0.8], cyclical: false },
  { id: 'pharma', name: 'Pharmaceuticals', count: 12, industries: ['Biotech', 'Branded Drugs', 'Generics', 'Vaccines'], vol: 0.021, beta: 0.8, growthSens: 0.2, rateSens: -0.6, inflationSens: -0.1, margin: [-0.1, 0.3], revGrowth: [-0.05, 0.3], ps: [2, 9], dividend: [0, 0.03], debtToRev: [0.1, 1.0], cyclical: false },
  { id: 'financials', name: 'Financial Services', count: 15, industries: ['Banking', 'Asset Management', 'Insurance', 'Payments', 'Brokerage'], vol: 0.018, beta: 1.1, growthSens: 1.0, rateSens: 0.6, inflationSens: 0.1, margin: [0.12, 0.3], revGrowth: [0.0, 0.12], ps: [1.5, 4], dividend: [0.01, 0.04], debtToRev: [0.5, 3.0], cyclical: true },
  { id: 'discretionary', name: 'Consumer Discretionary', count: 13, industries: ['Autos', 'Leisure', 'Apparel', 'Home Goods', 'Restaurants'], vol: 0.02, beta: 1.15, growthSens: 1.2, rateSens: -0.7, inflationSens: -0.6, margin: [0.03, 0.15], revGrowth: [0.0, 0.18], ps: [0.6, 3], dividend: [0, 0.025], debtToRev: [0.1, 0.9], cyclical: true },
  { id: 'staples', name: 'Consumer Staples', count: 12, industries: ['Food Products', 'Beverages', 'Household Products', 'Personal Care'], vol: 0.011, beta: 0.6, growthSens: 0.2, rateSens: -0.3, inflationSens: -0.3, margin: [0.05, 0.18], revGrowth: [0.0, 0.06], ps: [1, 4], dividend: [0.02, 0.04], debtToRev: [0.2, 0.8], cyclical: false },
  { id: 'industrials', name: 'Industrials', count: 14, industries: ['Machinery', 'Construction', 'Electrical Equipment', 'Defence Electronics', 'Logistics Tech'], vol: 0.017, beta: 1.05, growthSens: 1.1, rateSens: -0.4, inflationSens: -0.2, margin: [0.05, 0.16], revGrowth: [0.0, 0.1], ps: [0.8, 3], dividend: [0.005, 0.03], debtToRev: [0.2, 0.8], cyclical: true },
  { id: 'energy', name: 'Energy', count: 13, industries: ['Integrated Oil', 'Exploration & Production', 'Refining', 'Oilfield Services', 'Midstream'], vol: 0.022, beta: 1.0, growthSens: 0.9, rateSens: 0.0, inflationSens: 1.0, margin: [0.04, 0.2], revGrowth: [-0.1, 0.15], ps: [0.5, 2.5], dividend: [0.02, 0.06], debtToRev: [0.2, 1.0], cyclical: true },
  { id: 'utilities', name: 'Utilities', count: 10, industries: ['Electric Utilities', 'Water', 'Gas Distribution'], vol: 0.011, beta: 0.5, growthSens: 0.1, rateSens: -1.2, inflationSens: -0.2, margin: [0.08, 0.16], revGrowth: [0.01, 0.05], ps: [1.5, 3.5], dividend: [0.03, 0.055], debtToRev: [1.0, 3.0], cyclical: false },
  { id: 'telecom', name: 'Telecommunications', count: 9, industries: ['Wireless', 'Broadband', 'Towers', 'Satellite'], vol: 0.014, beta: 0.7, growthSens: 0.3, rateSens: -0.7, inflationSens: -0.2, margin: [0.06, 0.2], revGrowth: [-0.02, 0.06], ps: [1, 3], dividend: [0.02, 0.06], debtToRev: [0.8, 2.5], cyclical: false },
  { id: 'realestate', name: 'Real Estate', count: 11, industries: ['Office REIT', 'Residential REIT', 'Industrial REIT', 'Data Centre REIT', 'Retail REIT'], vol: 0.016, beta: 0.85, growthSens: 0.6, rateSens: -1.6, inflationSens: 0.1, margin: [0.15, 0.4], revGrowth: [-0.02, 0.08], ps: [4, 10], dividend: [0.03, 0.07], debtToRev: [2.0, 6.0], cyclical: true },
  { id: 'materials', name: 'Materials', count: 11, industries: ['Chemicals', 'Metals & Mining', 'Steel', 'Packaging', 'Gold Mining'], vol: 0.021, beta: 1.1, growthSens: 1.2, rateSens: -0.2, inflationSens: 0.8, margin: [0.04, 0.2], revGrowth: [-0.05, 0.12], ps: [0.6, 2.5], dividend: [0.01, 0.04], debtToRev: [0.2, 1.0], cyclical: true },
  { id: 'transport', name: 'Transportation', count: 10, industries: ['Airlines', 'Railroads', 'Trucking', 'Shipping'], vol: 0.02, beta: 1.15, growthSens: 1.1, rateSens: -0.4, inflationSens: -0.8, margin: [0.02, 0.15], revGrowth: [-0.03, 0.1], ps: [0.4, 2.5], dividend: [0, 0.03], debtToRev: [0.3, 1.5], cyclical: true },
  { id: 'renewables', name: 'Renewable Energy', count: 10, industries: ['Solar', 'Wind', 'Energy Storage', 'Hydrogen'], vol: 0.03, beta: 1.35, growthSens: 0.9, rateSens: -1.8, inflationSens: -0.3, margin: [-0.15, 0.12], revGrowth: [0.05, 0.45], ps: [1.5, 8], dividend: [0, 0.01], debtToRev: [0.3, 1.5], cyclical: false },
  { id: 'aerospace', name: 'Aerospace & Defence', count: 9, industries: ['Aircraft', 'Defence Systems', 'Space Launch', 'Avionics'], vol: 0.017, beta: 0.95, growthSens: 0.7, rateSens: -0.3, inflationSens: -0.1, margin: [0.05, 0.14], revGrowth: [0.0, 0.12], ps: [1, 3.5], dividend: [0.005, 0.025], debtToRev: [0.2, 0.9], cyclical: false },
  { id: 'entertainment', name: 'Media & Entertainment', count: 10, industries: ['Streaming', 'Gaming', 'Studios', 'Live Events', 'Social Media'], vol: 0.023, beta: 1.2, growthSens: 0.9, rateSens: -0.9, inflationSens: -0.3, margin: [-0.05, 0.25], revGrowth: [0.0, 0.25], ps: [1.5, 8], dividend: [0, 0.015], debtToRev: [0.2, 1.2], cyclical: false },
  { id: 'retail', name: 'Retail', count: 11, industries: ['E-commerce', 'Department Stores', 'Discount Retail', 'Specialty Retail', 'Grocery'], vol: 0.019, beta: 1.0, growthSens: 1.0, rateSens: -0.5, inflationSens: -0.5, margin: [0.01, 0.1], revGrowth: [-0.04, 0.2], ps: [0.3, 3], dividend: [0, 0.03], debtToRev: [0.1, 0.8], cyclical: true },
];

export const SECTOR_BY_ID: Record<SectorId, SectorDef> = Object.fromEntries(SECTORS.map((s) => [s.id, s])) as Record<SectorId, SectorDef>;
