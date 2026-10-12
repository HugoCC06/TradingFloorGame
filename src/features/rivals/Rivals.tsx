import { useState } from 'react';
import { go } from '../../app/router';
import { useGame, useVersion } from '../../app/store';
import { summarize } from '../../game/accounting';
import { dayTimestamp } from '../../game/calendar';
import { currentDrawdown, sinceInception, trailingReturn } from '../../game/performance';
import { rivalDrawdown, rivalReturn, STRATEGY_LABEL } from '../../game/rivals';
import { Bar, Change, DataTable, FundLogo, Panel } from '../../ui/components';
import { PerfChart } from '../../ui/charts';
import { money, pct } from '../../ui/format';

interface Row { id: string; name: string; me: boolean; strategy: string; aum: number; r1: number; r20: number; r60: number; all: number; dd: number; maxDd: number; rep: number; color: string }

export function Rivals() {
  const state = useGame();
  const version = useVersion();
  const [sel, setSel] = useState<string | null>(null);
  const s = summarize(state);
  const lastDay = state.daily[state.daily.length - 1];
  const rows: Row[] = [
    { id: 'ME', name: state.setup.fundName, me: true, strategy: 'Your strategy', aum: s.nav, r1: lastDay?.dailyReturn ?? 0, r20: trailingReturn(state, 20), r60: trailingReturn(state, 60), all: sinceInception(state), dd: currentDrawdown(state), maxDd: state.stats.maxDrawdown, rep: state.reputation, color: state.setup.logo.color },
    ...state.rivals.map((r) => {
      const h = r.history;
      const d = rivalDrawdown(r);
      return { id: r.id, name: r.name, me: false, strategy: STRATEGY_LABEL[r.strategy], aum: r.aum, r1: h.length > 1 ? r.navPerUnit / h[h.length - 2].navPerUnit - 1 : 0, r20: rivalReturn(r, 20), r60: rivalReturn(r, 60), all: r.navPerUnit / 100 - 1, dd: d.current, maxDd: d.max, rep: r.reputation, color: r.color };
    }),
  ];
  const rankAll = [...rows].sort((a, b) => b.all - a.all).findIndex((r) => r.me) + 1;
  const rankAum = [...rows].sort((a, b) => b.aum - a.aum).findIndex((r) => r.me) + 1;
  const rival = state.rivals.find((r) => r.id === sel);
  const start = dayTimestamp(state.clock.date) - 86400 * (state.daily.length + 2);
  const series = [
    { name: state.setup.fundName, color: '#4c8dff', points: [{ time: start, value: 100 }, ...state.daily.map((d) => ({ time: dayTimestamp(d.date), value: d.navPerUnit }))] },
    ...state.rivals.filter((r) => !sel || r.id === sel).map((r) => ({ name: r.name, color: r.color, points: [{ time: start, value: 100 }, ...r.history.map((h) => ({ time: dayTimestamp(state.daily.find((d) => d.day === h.day)?.date ?? state.clock.date), value: h.navPerUnit }))] })),
  ];
  return (
    <div>
      <div className="page-h"><div><h1>Rivals</h1><div className="sub">Competing funds trade the same market with their own strategies. You rank <b>#{rankAll}</b> of {rows.length} on return and <b>#{rankAum}</b> on AUM.</div></div></div>
      <Panel title="League table" flush>
        <DataTable rows={rows} rowKey={(r) => r.id} initialSort="all" onRowClick={(r) => setSel(r.me ? null : r.id)} selected={sel ?? (undefined as unknown as string)}
          columns={[
            { key: 'name', label: 'Fund', sort: (r) => r.name, render: (r) => <span className="row"><span className="dot" style={{ background: r.color }} /><b>{r.name}</b>{r.me && <span className="badge accent">You</span>}</span> },
            { key: 'st', label: 'Strategy', render: (r) => <span className="muted">{r.strategy}</span> },
            { key: 'aum', label: 'AUM', num: true, sort: (r) => r.aum, render: (r) => money(r.aum, { compact: true }) },
            { key: 'r1', label: '1D', num: true, sort: (r) => r.r1, render: (r) => <Change value={r.r1} showArrow={false} /> },
            { key: 'r20', label: '1M', num: true, sort: (r) => r.r20, render: (r) => <Change value={r.r20} showArrow={false} /> },
            { key: 'r60', label: '3M', num: true, sort: (r) => r.r60, render: (r) => <Change value={r.r60} showArrow={false} /> },
            { key: 'all', label: 'Since start', num: true, sort: (r) => r.all, render: (r) => <Change value={r.all} /> },
            { key: 'dd', label: 'Drawdown', num: true, sort: (r) => r.dd, render: (r) => <span className={r.dd > 0.1 ? 'neg' : ''}>{pct(-r.dd, 1)}</span> },
            { key: 'mdd', label: 'Max DD', num: true, sort: (r) => r.maxDd, render: (r) => pct(-r.maxDd, 1) },
            { key: 'rep', label: 'Reputation', sort: (r) => r.rep, render: (r) => <div style={{ width: 80 }}><Bar value={r.rep} max={100} /></div> },
          ]} />
      </Panel>
      <div className="grid mt" style={{ gridTemplateColumns: rival ? 'minmax(0,1.6fr) minmax(280px,1fr)' : '1fr' }}>
        <Panel title="Performance (NAV per unit, rebased)" actions={sel && <button className="btn sm ghost" onClick={() => setSel(null)}>Show all</button>}>
          {state.daily.length ? <PerfChart version={version} series={series} height={300} /> : <div className="empty">History appears after the first close.</div>}
        </Panel>
        {rival && (
          <Panel title={rival.name}>
            <div className="row mb"><FundLogo logo={{ mark: 'monogram', color: rival.color, accent: '#fff' }} name={rival.name} size={34} /><div><b>{STRATEGY_LABEL[rival.strategy]}</b><div className="small dim">Managed by {rival.manager}</div></div></div>
            <p className="muted small">{rival.description}</p>
            <div className="kv">
              <span>AUM</span><span>{money(rival.aum, { compact: true })}</span>
              <span>Clients</span><span>{rival.clients}</span>
              <span>Target gross</span><span>{pct(rival.riskAppetite, 0, false)}</span>
              <span>Rebalances every</span><span>{rival.rebalanceEvery} days</span>
              <span>Risk stance</span><span className={rival.derisked ? 'warn' : ''}>{rival.derisked ? 'De-risked' : 'Fully invested'}</span>
            </div>
            <div className="tiny mt mb">Disclosed holdings (largest)</div>
            {[...rival.holdings].sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 10).map((h) => {
              const i = state.instruments[h.idx];
              return <div key={h.idx} className="spread small" style={{ cursor: 'pointer' }} onClick={() => go('instrument', i.id)}><span><b>{i.id}</b> <span className="dim">{i.name}</span></span><span className={`num ${h.w < 0 ? 'neg' : ''}`}>{h.w < 0 ? 'short ' : ''}{pct(Math.abs(h.w), 1, false)}</span></div>;
            })}
          </Panel>
        )}
      </div>
    </div>
  );
}
