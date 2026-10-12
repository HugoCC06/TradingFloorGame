import { useMemo, useState } from 'react';
import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { useGame, useVersion } from '../../app/store';
import { instById, summarize } from '../../game/accounting';
import { dayTimestamp } from '../../game/calendar';
import { benchmarkSinceInception, currentDrawdown, sharpe, sinceInception, volatility } from '../../game/performance';
import { executeRebalance, proposeRebalance } from '../../game/rebalance';
import { sectorLabel } from '../../game/risk';
import type { GameState } from '../../game/types';
import { Bar, Change, Confirm, Panel, Stat, Tabs } from '../../ui/components';
import { PerfChart } from '../../ui/charts';
import { cls, money, num, pct } from '../../ui/format';
import { PositionsPanel } from '../terminal/panels';

export function Portfolio() {
  const state = useGame();
  const version = useVersion();
  const [tab, setTab] = useState<'holdings' | 'performance' | 'allocation'>('holdings');
  const s = summarize(state);
  const t = state.fund.totals;
  const costs = t.commissions + t.borrowFees + t.financing;
  return (
    <div>
      <div className="page-h"><div><h1>Portfolio</h1><div className="sub">Fund ledger — owned by your investors, separate from the management company.</div></div></div>
      <div className="stats mb">
        <Stat label="NAV (AUM)" value={money(s.nav)} large />
        <Stat label="NAV per unit" value={s.navPerUnit.toFixed(3)} sub={<Change value={sinceInception(state)} />} title="Time-weighted, gross of fees" />
        <Stat label="Cash" value={money(s.cash, { compact: true })} sub={<span className="muted">collateral {money(s.collateral, { compact: true })}</span>} />
        <Stat label="Free cash" value={money(s.freeCash, { compact: true })} valueClass={s.freeCash < 0 ? 'neg' : ''} sub={<span className="muted">{s.freeCash < 0 ? 'margin loan' : 'available'}</span>} />
        <Stat label="Long / short" value={`${money(s.longValue, { compact: true })} / ${money(s.shortValue, { compact: true })}`} />
        <Stat label="Gross / net" value={`${pct(s.grossLeverage, 0, false)} / ${pct(s.netLeverage, 0)}`} />
        <Stat label="Unrealised P&L" value={money(s.unrealized, { compact: true, sign: true })} valueClass={cls(s.unrealized)} />
        <Stat label="Realised P&L" value={money(t.realized, { compact: true, sign: true })} valueClass={cls(t.realized)} sub={<span className="muted">costs {money(-costs, { compact: true })}</span>} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'holdings', label: `Holdings (${s.positions.length})` }, { id: 'performance', label: 'Performance' }, { id: 'allocation', label: 'Allocation & rebalance' }]} />
      {tab === 'holdings' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2.3fr) minmax(260px, 1fr)' }}>
          <Panel title="Positions" flush><PositionsPanel state={state} /></Panel>
          <Panel title="Exposure by sector">
            <div className="col">
              {Object.entries(s.sectorExposure).sort((a, b) => b[1].gross - a[1].gross).map(([k, e]) => {
                const w = e.gross / Math.max(s.nav, 1);
                return (
                  <div key={k}>
                    <div className="spread small"><span>{sectorLabel(k)}</span><span className="num">{pct(w, 1, false)} <span className="dim">net {pct(e.net / Math.max(s.nav, 1), 1)}</span></span></div>
                    <Bar value={w} max={Math.max(0.5, w)} limit={k === 'broad' ? undefined : state.risk.limits.maxSectorWeight} tone={w > state.risk.limits.maxSectorWeight && k !== 'broad' ? 'neg' : undefined} />
                  </div>
                );
              })}
              {!s.positions.length && <span className="dim">Fully in cash.</span>}
            </div>
          </Panel>
        </div>
      )}
      {tab === 'performance' && <Performance state={state} version={version} />}
      {tab === 'allocation' && <Allocation state={state} />}
    </div>
  );
}

function Performance({ state, version }: { state: GameState; version: number }) {
  const t = state.fund.totals;
  const first = state.daily[0];
  const benchBase = first ? first.benchmark / (1 + first.benchmarkReturn) : state.instruments[state.benchmarkIdx].price;
  const start = dayTimestamp(state.clock.date) - 86400 * (state.daily.length + 2);
  const fund = [{ time: start, value: 100 }, ...state.daily.map((d) => ({ time: dayTimestamp(d.date), value: d.navPerUnit }))];
  const bench = [{ time: start, value: 100 }, ...state.daily.map((d) => ({ time: dayTimestamp(d.date), value: (d.benchmark / benchBase) * 100 }))];
  const net = [{ time: start, value: 100 }, ...state.daily.map((d) => ({ time: dayTimestamp(d.date), value: d.netIndex }))];
  const dd = state.daily.map((d) => ({ time: dayTimestamp(d.date), value: -d.drawdown * 100 }));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="stats">
        <Stat label="Return since inception" value={pct(sinceInception(state))} valueClass={cls(sinceInception(state))} sub={<span className="muted">gross of fees, time-weighted</span>} />
        <Stat label="Benchmark (TFX)" value={pct(benchmarkSinceInception(state))} />
        <Stat label="Excess return" value={pct(sinceInception(state) - benchmarkSinceInception(state))} valueClass={cls(sinceInception(state) - benchmarkSinceInception(state))} />
        <Stat label="Net to a 2/20 investor" value={pct((state.daily[state.daily.length - 1]?.netIndex ?? 100) / 100 - 1)} />
        <Stat label="Current drawdown" value={pct(-currentDrawdown(state), 1)} sub={<span className="muted">max {pct(-state.stats.maxDrawdown, 1)}</span>} />
        <Stat label="Volatility (63d, ann.)" value={pct(volatility(state), 1, false)} />
        <Stat label="Sharpe ratio" value={sharpe(state).toFixed(2)} />
        <Stat label="Best / worst day" value={`${pct(state.stats.bestDay, 1)} / ${pct(state.stats.worstDay, 1)}`} />
      </div>
      <Panel title="NAV per unit vs benchmark (rebased to 100)">
        {state.daily.length ? <PerfChart version={version} series={[{ name: 'Fund (gross)', color: '#4c8dff', points: fund }, { name: 'Net 2/20 investor', color: '#9d86d6', points: net }, { name: 'TFX benchmark', color: '#8a939e', points: bench }]} /> : <div className="empty">Complete your first trading day to see performance history.</div>}
      </Panel>
      <div className="grid g2">
        <Panel title="Drawdown">{dd.length ? <PerfChart version={version} height={180} area series={[{ name: 'Drawdown %', color: '#f0565b', points: dd }]} /> : <div className="empty">No history yet.</div>}</Panel>
        <Panel title="Attribution (since inception)">
          <div className="kv">
            <span>Realised trading P&L</span><span className={cls(t.realized)}>{money(t.realized, { sign: true })}</span>
            <span>Unrealised P&L</span><span className={cls(summarize(state).unrealized)}>{money(summarize(state).unrealized, { sign: true })}</span>
            <span>Dividends</span><span className={cls(t.dividends)}>{money(t.dividends, { sign: true })}</span>
            <span>Interest on cash</span><span className="pos">{money(t.interestEarned, { sign: true })}</span>
            <span>Commissions</span><span className="neg">{money(-t.commissions)}</span>
            <span>Spread & impact (in prices)</span><span className="dim">{money(-t.slippage)}</span>
            <span>Borrow fees</span><span className="neg">{money(-t.borrowFees)}</span>
            <span>Margin financing</span><span className="neg">{money(-t.financing)}</span>
            <span>Management fees (to company)</span><span>{money(-t.managementFees)}</span>
            <span>Performance fees (to company)</span><span>{money(-t.performanceFees)}</span>
            <span>Subscriptions (not profit)</span><span>{money(t.subscriptions)}</span>
            <span>Redemptions (not loss)</span><span>{money(-t.redemptions)}</span>
          </div>
          <p className="small dim mt">Reported fund returns use NAV per unit: flows buy or redeem units at NAV, and fees are charged by cancelling client units, so neither distorts investment performance.</p>
        </Panel>
      </div>
    </div>
  );
}

function Allocation({ state }: { state: GameState }) {
  const [add, setAdd] = useState('');
  const [confirm, setConfirm] = useState(false);
  const proposal = useMemo(() => proposeRebalance(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, state.clock.minute, JSON.stringify(state.targets), Object.keys(state.fund.positions).length]);
  const s = summarize(state);
  const setTarget = (id: string, w: number | null) => controller.act((st) => { if (w === null) delete st.targets[id]; else st.targets[id] = w; });
  const importCurrent = () => controller.act((st) => { for (const p of s.positions) st.targets[p.id] = Math.round(p.weight * 1000) / 1000; });
  const totalTarget = Object.values(state.targets).reduce((a, b) => a + Math.abs(b), 0);
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>
      <Panel title="Target weights (% of NAV, negative = short)" actions={<>
        <button className="btn sm" onClick={importCurrent}>Use current weights</button>
        <button className="btn sm ghost" onClick={() => controller.act((st) => { st.targets = {}; })}>Clear</button></>} flush>
        <table className="tbl">
          <thead><tr><th>Symbol</th><th className="num">Current</th><th className="num">Target %</th><th className="num">Trade</th><th className="num">Est. notional</th><th /></tr></thead>
          <tbody>
            {proposal.lines.map((l) => (
              <tr key={l.id}>
                <td><b>{l.id}</b> <span className="small dim">{l.name}</span></td>
                <td className="num">{pct(l.currentWeight, 1)}</td>
                <td className="num"><input className="input num" style={{ width: 80, textAlign: 'right' }} type="number" step="0.5" defaultValue={(l.targetWeight * 100).toFixed(1)} key={`${l.id}${l.targetWeight}`}
                  onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setTarget(l.id, v / 100); }} aria-label={`Target weight for ${l.id}`} /></td>
                <td className="num">{l.draft ? <span className={l.draft.side === 'buy' || l.draft.side === 'cover' ? 'pos' : 'neg'}>{l.draft.side} {num(l.draft.quantity)}</span> : <span className="dim">{l.note ?? '—'}</span>}</td>
                <td className="num">{l.draft ? money(l.estNotional, { compact: true }) : ''}</td>
                <td><button className="btn ghost sm" onClick={() => setTarget(l.id, null)} aria-label={`Remove ${l.id} target`}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!proposal.lines.length && <div className="empty">No targets. Add instruments below or import your current weights.</div>}
        <div className="row" style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
          <input className="input" placeholder="Symbol" value={add} onChange={(e) => setAdd(e.target.value.toUpperCase())} list="all-symbols" aria-label="Add target symbol" />
          <button className="btn sm" onClick={() => { if (instById(state, add)) setTarget(add, 0.05); setAdd(''); }}>Add at 5%</button>
          <datalist id="all-symbols">{state.instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</datalist>
        </div>
      </Panel>
      <Panel title="Rebalance preview">
        <div className="kv">
          <span>Total target exposure</span><span>{pct(totalTarget, 0, false)}</span>
          <span>Buys</span><span className="pos">{money(proposal.totalBuy, { compact: true })}</span>
          <span>Sells</span><span className="neg">{money(proposal.totalSell, { compact: true })}</span>
          <span>Est. spread & impact</span><span>{money(proposal.estCosts)}</span>
          <span>Gross after</span><span>{pct(proposal.postGross, 0, false)}</span>
          <span>Net after</span><span>{pct(proposal.postNet, 0)}</span>
        </div>
        {proposal.warnings.map((w) => <div key={w} className="small warn mt">! {w}</div>)}
        <button className="btn primary mt" style={{ width: '100%' }} disabled={!proposal.lines.some((l) => l.draft)} onClick={() => setConfirm(true)}>Rebalance now</button>
        <p className="small dim mt">Sells and covers are sent first to free buying power. Outside market hours the orders queue for the open. The Auto-rebalancer automation (Business page) can run this every morning.</p>
        <button className="btn sm ghost" onClick={() => go('business')}>Automation settings</button>
      </Panel>
      {confirm && <Confirm title="Submit rebalance orders?" text={`${proposal.lines.filter((l) => l.draft).length} market orders, ~${money(proposal.totalBuy + proposal.totalSell, { compact: true })} traded, est. costs ${money(proposal.estCosts)}.`}
        onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); const r = controller.act((st) => executeRebalance(st)); if (r) controller.toast(r.rejected.length ? 'warning' : 'success', `Rebalance: ${r.submitted} orders`, r.rejected.slice(0, 2).join(' · ')); }} />}
    </div>
  );
}
