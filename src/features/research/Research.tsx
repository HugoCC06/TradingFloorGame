import { useMemo, useState } from 'react';
import { go } from '../../app/router';
import { useGame } from '../../app/store';
import { SECTORS, SECTOR_BY_ID, type SectorId } from '../../config/sectors';
import { regimeLabel } from '../../game/macro';
import { Rng, hashString } from '../../game/rng';
import { analystCoverage } from '../../game/staff';
import type { GameState, Instrument } from '../../game/types';
import { Badge, Bar, Change, DataTable, Panel, Stat, Tabs } from '../../ui/components';
import { compact, num, pct, price } from '../../ui/format';
import { CalendarPanel } from '../terminal/panels';

/** Analyst estimate of fair value; accuracy improves with coverage. Stable for 5-day windows. */
export function analystView(state: GameState, inst: Instrument): { fair: number; rating: 'Buy' | 'Hold' | 'Sell'; upside: number; coverage: number } | null {
  const f = inst.fundamentals;
  if (!f) return null;
  const coverage = analystCoverage(state, inst.sector as string);
  if (coverage <= 0) return null;
  const r = new Rng([hashString(inst.id), Math.floor(state.clock.day / 5), state.setup.seed >>> 0, 7]);
  const err = r.normal() * 0.28 * (1 - coverage / 110);
  const fair = f.fairValue * Math.exp(err);
  const upside = fair / inst.price - 1;
  return { fair, rating: upside > 0.1 ? 'Buy' : upside < -0.1 ? 'Sell' : 'Hold', upside, coverage };
}

const level = (x: number) => (Math.abs(x) < 0.5 ? 'Low' : Math.abs(x) < 1.1 ? 'Medium' : 'High');

export function Fundamentals({ state, inst }: { state: GameState; inst: Instrument }) {
  const f = inst.fundamentals!;
  const mcap = inst.price * f.sharesOut;
  const view = analystView(state, inst);
  const eps = f.earnings / f.sharesOut;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="stats">
        <Stat label="Market cap" value={'$' + compact(mcap)} />
        <Stat label="Revenue (TTM)" value={'$' + compact(f.revenue)} sub={<Change value={f.revGrowth} decimals={1} />} />
        <Stat label="Net income" value={'$' + compact(f.earnings)} sub={<span className="muted">margin {pct(f.margin, 1, false)}</span>} />
        <Stat label="EPS (annualised)" value={'$' + eps.toFixed(2)} sub={<Change value={f.epsGrowth} decimals={1} />} />
        <Stat label="P/E" value={f.earnings > 0 ? num(mcap / f.earnings, 1) : 'n/m'} sub={<span className="muted">P/S {num(mcap / f.revenue, 1)}</span>} />
        <Stat label="Dividend yield" value={pct(f.dividendYield, 2, false)} />
        <Stat label="Debt / cash" value={'$' + compact(f.debt)} sub={<span className="muted">cash ${compact(f.cash)}</span>} />
        <Stat label="Quality score" value={`${Math.round(f.quality)}/100`} sub={<Bar value={f.quality} max={100} tone={f.quality > 65 ? 'pos' : f.quality < 35 ? 'neg' : 'warn'} />} />
      </div>
      <div className="grid g2">
        <div className="kv">
          <span>Market growth expectation</span><span>{pct(f.growthExpect, 1, false)}/yr</span>
          <span>Sensitivity to rates</span><span>{level(f.rateSens)} ({f.rateSens > 0 ? 'benefits' : 'hurt'} by higher rates)</span>
          <span>Sensitivity to growth</span><span>{level(f.growthSens)}</span>
          <span>Sensitivity to inflation</span><span>{level(f.inflationSens)}</span>
          <span>Beta</span><span>{inst.beta.toFixed(2)}</span>
          <span>Consensus next-quarter EPS</span><span>${f.consensusEps.toFixed(2)}</span>
        </div>
        <div>
          {view ? (
            <div className="card" style={{ padding: 12 }}>
              <div className="spread"><span className="tiny">Your analysts' view</span><Badge tone={view.rating === 'Buy' ? 'pos' : view.rating === 'Sell' ? 'neg' : undefined}>{view.rating}</Badge></div>
              <div className="row mt" style={{ alignItems: 'baseline' }}><span className="num" style={{ fontSize: 18 }}>${price(view.fair)}</span><span className="muted">fair value</span><Change value={view.upside} decimals={1} /></div>
              <div className="small dim mt">Coverage quality {Math.round(view.coverage)}/100. Estimates carry error — {view.coverage > 70 ? 'small' : view.coverage > 40 ? 'moderate' : 'large'} at this coverage level. Prices drift toward fair value only slowly.</div>
            </div>
          ) : <div className="card small dim" style={{ padding: 12 }}>No analyst covers {SECTOR_BY_ID[inst.sector as SectorId].name}. Hire one to see fair-value estimates, ratings and earnings previews.</div>}
        </div>
      </div>
      {f.earningsHistory.length > 0 && (
        <table className="tbl"><thead><tr><th>Report</th><th className="num">Est. EPS</th><th className="num">Actual</th><th className="num">Surprise</th><th>Guidance</th></tr></thead>
          <tbody>{[...f.earningsHistory].reverse().map((e) => (
            <tr key={e.day}><td>{e.date}</td><td className="num">{e.est.toFixed(2)}</td><td className="num">{e.act.toFixed(2)}</td><td className="num"><Change value={(e.act - e.est) / Math.abs(e.est || 1)} decimals={1} /></td>
              <td><Badge tone={e.guidance === 'raised' ? 'pos' : e.guidance === 'cut' ? 'neg' : undefined}>{e.guidance}</Badge></td></tr>))}</tbody></table>
      )}
    </div>
  );
}

export function Research() {
  const state = useGame();
  const [tab, setTab] = useState<'screener' | 'macro' | 'calendar'>('screener');
  const [sector, setSector] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(null);
  const eq = useMemo(() => state.instruments.filter((i) => i.kind === 'equity' && (sector === 'all' || i.sector === sector)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, sector, state.clock.day]);
  const selInst = sel ? state.instruments.find((i) => i.id === sel) : null;
  const pe = (i: Instrument) => (i.fundamentals!.earnings > 0 ? (i.price * i.fundamentals!.sharesOut) / i.fundamentals!.earnings : NaN);
  return (
    <div>
      <div className="page-h"><div><h1>Research</h1><div className="sub">Fundamentals, macro conditions and the event calendar.</div></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'screener', label: 'Equity screener' }, { id: 'macro', label: 'Macro & sectors' }, { id: 'calendar', label: 'Calendar' }]} />
      {tab === 'screener' && (
        <div className="grid" style={{ gridTemplateColumns: selInst ? 'minmax(0,1.3fr) minmax(0,1fr)' : '1fr' }}>
          <Panel title="Screener" actions={<select className="input" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector">
            <option value="all">All sectors</option>{SECTORS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>} flush>
            <DataTable rows={eq} rowKey={(i) => i.id} onRowClick={(i) => setSel(i.id)} selected={sel ?? undefined} initialSort="q" maxHeight="calc(100vh - 260px)"
              columns={[
                { key: 'id', label: 'Symbol', sort: (i) => i.id, render: (i) => <b>{i.id}</b> },
                { key: 'pe', label: 'P/E', num: true, sort: (i) => (Number.isFinite(pe(i)) ? pe(i) : 9999), render: (i) => (Number.isFinite(pe(i)) ? num(pe(i), 1) : 'n/m') },
                { key: 'g', label: 'Rev growth', num: true, sort: (i) => i.fundamentals!.revGrowth, render: (i) => pct(i.fundamentals!.revGrowth, 1) },
                { key: 'm', label: 'Margin', num: true, sort: (i) => i.fundamentals!.margin, render: (i) => pct(i.fundamentals!.margin, 1, false) },
                { key: 'd', label: 'Div', num: true, sort: (i) => i.fundamentals!.dividendYield, render: (i) => pct(i.fundamentals!.dividendYield, 1, false) },
                { key: 'q', label: 'Quality', num: true, sort: (i) => i.fundamentals!.quality, render: (i) => Math.round(i.fundamentals!.quality) },
                { key: 'r', label: 'Analyst', sort: (i) => analystView(state, i)?.upside ?? -9, render: (i) => { const v = analystView(state, i); return v ? <Badge tone={v.rating === 'Buy' ? 'pos' : v.rating === 'Sell' ? 'neg' : undefined}>{v.rating} {pct(v.upside, 0)}</Badge> : <span className="dim">—</span>; } },
                { key: 'e', label: 'Earnings', num: true, sort: (i) => i.fundamentals!.nextEarningsDay, render: (i) => `${i.fundamentals!.nextEarningsDay - state.clock.day}d` },
              ]} />
          </Panel>
          {selInst && (
            <Panel title={`${selInst.name} (${selInst.id})`} actions={<button className="btn sm primary" onClick={() => go('instrument', selInst.id)}>Open & trade</button>}>
              <p className="muted small">{selInst.description}</p>
              <Fundamentals state={state} inst={selInst} />
            </Panel>
          )}
        </div>
      )}
      {tab === 'macro' && <Macro state={state} />}
      {tab === 'calendar' && <Panel title="Next 15 trading days" flush><CalendarPanel state={state} days={15} /></Panel>}
    </div>
  );
}

function Macro({ state }: { state: GameState }) {
  const m = state.macro;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="stats">
        <Stat label="Regime" value={regimeLabel(m.regime)} valueClass={m.regime === 'bull' ? 'pos' : m.regime === 'bear' || m.regime === 'crisis' ? 'neg' : ''} sub={<span className="muted">{m.regimeDays} days</span>} />
        <Stat label="GDP growth" value={`${m.growth.toFixed(1)}%`} />
        <Stat label="Inflation" value={`${m.inflation.toFixed(1)}%`} />
        <Stat label="Policy rate" value={`${m.policyRate.toFixed(2)}%`} sub={<span className="muted">market expects {m.expectedRate.toFixed(2)}%</span>} />
        <Stat label="Unemployment" value={`${m.unemployment.toFixed(1)}%`} />
        <Stat label="Credit spreads" value={`${m.credit.toFixed(2)}%`} />
        <Stat label="Sentiment" value={m.sentiment > 0.2 ? 'Optimistic' : m.sentiment < -0.2 ? 'Fearful' : 'Neutral'} sub={<Bar value={(m.sentiment + 1) / 2} max={1} tone={m.sentiment >= 0 ? 'pos' : 'neg'} />} />
        <Stat label="Geopolitical tension" value={m.geopolitics > 0.5 ? 'High' : m.geopolitics > 0.25 ? 'Elevated' : 'Low'} sub={<Bar value={m.geopolitics} max={1} tone="warn" />} />
      </div>
      <Panel title="Sector conditions">
        <div className="grid g3">
          {SECTORS.map((s) => {
            const st = state.sectors[s.id];
            const etf = state.instruments.find((i) => i.kind === 'etf' && i.sector === s.id);
            return (
              <div key={s.id} className="col" style={{ gap: 3 }}>
                <div className="spread small"><span>{s.name}</span>{etf && <button className="btn ghost sm" onClick={() => go('instrument', etf.id)}>{etf.id} <Change value={etf.price / etf.prevClose - 1} showArrow={false} /></button>}</div>
                <Bar value={(st.sentiment + 1) / 2} max={1} tone={st.sentiment > 0.15 ? 'pos' : st.sentiment < -0.15 ? 'neg' : 'warn'} />
                <div className="tiny" style={{ textTransform: 'none', letterSpacing: 0 }}>Rates {level(s.rateSens)} {s.rateSens < 0 ? '(hurt by hikes)' : ''} · Growth {level(s.growthSens)} · Inflation {level(s.inflationSens)}</div>
              </div>
            );
          })}
        </div>
      </Panel>
      <p className="small dim">How it works: surprise rate hikes hurt rate-sensitive sectors (utilities, real estate, long-duration growth) and gold; hot inflation raises expected rates; growth surprises move cyclicals most. Expected outcomes are already priced in.</p>
    </div>
  );
}
