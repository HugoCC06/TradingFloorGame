export type DifficultyId = 'easy' | 'normal' | 'hard';

/**
 * Difficulty changes the simulation itself, not just a label.
 * Add an 'expert' entry here (and to DifficultyId) to extend.
 */
export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  blurb: string;
  /** multiplies all market volatility */
  volMult: number;
  /** multiplies daily equity drift (higher = friendlier market) */
  driftBias: number;
  /** multiplier on random news frequency */
  eventFreq: number;
  /** multiplier on the size of adverse event shocks */
  shockSize: number;
  /** allow systemic crises / geopolitical shocks */
  crises: boolean;
  /** bear-regime transition multiplier */
  bearProb: number;
  /** client redemption sensitivity multiplier */
  clientSensitivity: number;
  /** client return expectations multiplier */
  clientExpectation: number;
  /** extra drawdown tolerance (fraction added to client tolerance) */
  drawdownGrace: number;
  /** rival quality 0..1 (selection + risk-management competence) */
  rivalSkill: number;
  /** rival marketing strength (investor competition) */
  rivalMarketing: number;
  /** multiplier on operating expenses */
  expenseMult: number;
  /** multiplier on trading costs (spreads/commission) */
  costMult: number;
  /** drawdown from peak NAV/unit at which the fund collapses */
  collapseDrawdown: number;
  /** trading days the management company may be insolvent before bankruptcy */
  insolvencyGrace: number;
  /** maximum gross leverage the prime broker allows */
  maxGross: number;
  /** maintenance margin multiplier */
  marginMult: number;
  /** probability per day a rival attempts to poach staff */
  poachRate: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: {
    id: 'easy', name: 'Easy', blurb: 'Calmer markets, patient clients, weaker rivals and generous starting conditions.',
    volMult: 0.8, driftBias: 1.35, eventFreq: 0.85, shockSize: 0.8, crises: false, bearProb: 0.6,
    clientSensitivity: 0.6, clientExpectation: 0.8, drawdownGrace: 0.08, rivalSkill: 0.25, rivalMarketing: 0.75,
    expenseMult: 0.85, costMult: 0.8, collapseDrawdown: 0.7, insolvencyGrace: 20, maxGross: 2.5, marginMult: 0.9, poachRate: 0.0,
  },
  normal: {
    id: 'normal', name: 'Normal', blurb: 'Balanced volatility, realistic client expectations and competent competitors.',
    volMult: 1.0, driftBias: 1.0, eventFreq: 1.0, shockSize: 1.0, crises: false, bearProb: 1.0,
    clientSensitivity: 1.0, clientExpectation: 1.0, drawdownGrace: 0.03, rivalSkill: 0.55, rivalMarketing: 1.0,
    expenseMult: 1.0, costMult: 1.0, collapseDrawdown: 0.55, insolvencyGrace: 12, maxGross: 2.0, marginMult: 1.0, poachRate: 0.004,
  },
  hard: {
    id: 'hard', name: 'Hard', blurb: 'Volatile markets, demanding clients, sharp rivals and rare severe crises.',
    volMult: 1.25, driftBias: 0.75, eventFreq: 1.25, shockSize: 1.3, crises: true, bearProb: 1.5,
    clientSensitivity: 1.5, clientExpectation: 1.2, drawdownGrace: 0, rivalSkill: 0.85, rivalMarketing: 1.3,
    expenseMult: 1.2, costMult: 1.2, collapseDrawdown: 0.45, insolvencyGrace: 7, maxGross: 1.6, marginMult: 1.15, poachRate: 0.01,
  },
};
