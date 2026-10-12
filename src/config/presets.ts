export type PresetId = 'bootstrapped' | 'founder' | 'spinout';

export interface PresetDef {
  id: PresetId;
  name: string;
  blurb: string;
  /** starting fund AUM in dollars (excludes founder seed) */
  clientCapital: number;
  /** founder's own investment in the fund */
  founderSeed: number;
  clientCount: number;
  /** management company starting cash */
  companyCash: number;
  officeTier: number;
  startingStaff: { role: 'analyst' | 'pm' | 'ir'; skill: number }[];
  /** multiplier on client return expectations */
  expectationMult: number;
  /** starting reputation 0-100 */
  reputation: number;
}

export const PRESETS: Record<PresetId, PresetDef> = {
  bootstrapped: {
    id: 'bootstrapped', name: 'Bootstrapped', blurb: 'A tiny fund run from a co-working desk. Low expectations, thin margins.',
    clientCapital: 4_000_000, founderSeed: 500_000, clientCount: 3, companyCash: 180_000, officeTier: 0,
    startingStaff: [], expectationMult: 0.9, reputation: 30,
  },
  founder: {
    id: 'founder', name: 'Independent Founder', blurb: 'Moderate capital, one analyst and a small boutique office.',
    clientCapital: 18_000_000, founderSeed: 1_000_000, clientCount: 5, companyCash: 900_000, officeTier: 1,
    startingStaff: [{ role: 'analyst', skill: 55 }], expectationMult: 1.0, reputation: 42,
  },
  spinout: {
    id: 'spinout', name: 'Established Spin-out', blurb: 'A large book from day one — and clients and costs to match.',
    clientCapital: 95_000_000, founderSeed: 2_500_000, clientCount: 8, companyCash: 2_600_000, officeTier: 2,
    startingStaff: [{ role: 'analyst', skill: 62 }, { role: 'pm', skill: 58 }, { role: 'ir', skill: 55 }, { role: 'analyst', skill: 48 }],
    expectationMult: 1.2, reputation: 58,
  },
};
