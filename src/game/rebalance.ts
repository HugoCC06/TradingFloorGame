import { instById, summarize, toCents } from './accounting';
import { marketFillPrice, submitOrder, validateOrder, type OrderDraft } from './orders';
import type { GameState, OrderOrigin } from './types';

export interface RebalanceLine {
  id: string;
  name: string;
  currentWeight: number;
  targetWeight: number;
  currentQty: number;
  targetQty: number;
  draft: OrderDraft | null;
  estNotional: number;
  estCost: number;
  note?: string;
}

export interface RebalanceProposal {
  lines: RebalanceLine[];
  totalBuy: number;
  totalSell: number;
  estCosts: number;
  postGross: number;
  postNet: number;
  warnings: string[];
}

/**
 * Translate target weights (signed fraction of NAV; negative = short) into
 * executable orders. Weights inside `band` of target are left alone.
 */
export function proposeRebalance(state: GameState, band = 0): RebalanceProposal {
  const s = summarize(state);
  const nav = Math.max(s.nav, 1);
  const lines: RebalanceLine[] = [];
  let totalBuy = 0, totalSell = 0, costs = 0, postGross = 0, postNet = 0;
  const warnings: string[] = [];
  const ids = new Set([...Object.keys(state.targets)]);
  for (const id of ids) {
    const inst = instById(state, id);
    if (!inst) continue;
    const target = state.targets[id] ?? 0;
    const cur = state.fund.positions[id]?.qty ?? 0;
    const curW = (cur * inst.price * 100) / nav;
    let targetQty = Math.trunc((target * nav) / 100 / inst.price);
    if (target < 0 && !inst.shortable) {
      targetQty = 0;
      warnings.push(`${id} cannot be shorted; target ignored.`);
    }
    postGross += Math.abs(targetQty * inst.price * 100);
    postNet += targetQty * inst.price * 100;
    const line: RebalanceLine = { id, name: inst.name, currentWeight: curW, targetWeight: target, currentQty: cur, targetQty, draft: null, estNotional: 0, estCost: 0 };
    if (Math.abs(curW - target) <= band || targetQty === cur) {
      line.note = 'Within band';
      lines.push(line);
      continue;
    }
    // positions cannot flip sign in one order: close first, then open
    let draft: OrderDraft | null = null;
    if (cur > 0 && targetQty < cur) draft = { instrument: id, side: 'sell', type: 'market', quantity: Math.min(cur, cur - Math.max(0, targetQty)), tif: 'day' };
    else if (cur < 0 && targetQty > cur) draft = { instrument: id, side: 'cover', type: 'market', quantity: Math.min(-cur, Math.min(0, targetQty) - cur), tif: 'day' };
    else if (cur >= 0 && targetQty > cur) draft = { instrument: id, side: 'buy', type: 'market', quantity: targetQty - cur, tif: 'day' };
    else if (cur <= 0 && targetQty < cur) draft = { instrument: id, side: 'short', type: 'market', quantity: cur - targetQty, tif: 'day' };
    if ((cur > 0 && targetQty < 0) || (cur < 0 && targetQty > 0)) line.note = 'Closes the position; re-run to open the opposite side';
    if (draft && draft.quantity > 0) {
      line.draft = draft;
      const px = marketFillPrice(state, inst, draft.side, draft.quantity);
      const notional = toCents(draft.quantity * px);
      line.estNotional = notional;
      line.estCost = toCents(Math.abs(px - inst.price) * draft.quantity);
      costs += line.estCost;
      if (draft.side === 'buy' || draft.side === 'cover') totalBuy += notional;
      else totalSell += notional;
    }
    lines.push(line);
  }
  if (postGross / nav > state.risk.limits.maxGross) warnings.push(`Targets imply gross exposure of ${((postGross / nav) * 100).toFixed(0)}%, above the ${(state.risk.limits.maxGross * 100).toFixed(0)}% limit. Some orders will be rejected.`);
  return { lines, totalBuy, totalSell, estCosts: costs, postGross: postGross / nav, postNet: postNet / nav, warnings };
}

/** Submit rebalance orders: risk-reducing orders first so they free buying power. */
export function executeRebalance(state: GameState, origin: OrderOrigin = 'player', band = 0): { submitted: number; rejected: string[] } {
  const p = proposeRebalance(state, band);
  const drafts = p.lines.map((l) => l.draft).filter((d): d is OrderDraft => !!d);
  drafts.sort((a, b) => rank(a.side) - rank(b.side));
  let submitted = 0;
  const rejected: string[] = [];
  for (const d of drafts) {
    const chk = validateOrder(state, d, origin);
    if (!chk.ok) {
      rejected.push(`${d.side} ${d.instrument}: ${chk.errors[0]}`);
      continue;
    }
    const o = submitOrder(state, d, origin);
    if (o.status === 'rejected') rejected.push(`${d.side} ${d.instrument}: ${o.reason}`);
    else submitted++;
  }
  return { submitted, rejected };
}

const rank = (s: string) => (s === 'sell' || s === 'cover' ? 0 : 1);
