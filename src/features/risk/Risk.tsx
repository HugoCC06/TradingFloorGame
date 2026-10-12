import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { prefillTicket } from '../../app/selection';
import { useGame } from '../../app/store';
import { summarize } from '../../game/accounting';
import { automationOn } from '../../game/company';
import { currentDrawdown } from '../../game/performance';
import { sectorLabel } from '../../game/risk';
import { Badge, Bar, Panel, Stat } from '../../ui/components';
import { money, pct } from '../../ui/format';

export function Risk() {
  const state = useGame();
  const s = summarize(state);
  const L = state.risk.limits;
  const dd = currentDrawdown(state);
  const rows: { label: string; value: number; limit: number; fmt: (x: number) => string; note: string }[] = [
    { label: 'Largest position', value: Math.abs(s.largestPosition?.weight ?? 0), limit: L.maxPositionWeight, fmt: (x) => pct(x, 1, false), note: s.largestPosition ? `${s.largestPosition.id} (broad-market ETFs exempt)` : '—' },
    { label: 'Largest sector (gross)', value: Math.max(0, ...Object.entries(s.sectorExposure).filter(([k]) => k !== 'broad').map(([, e]) => e.gross / Math.max(s.nav, 1))), limit: L.maxSectorWeight, fmt: (x) => pct(x, 1, false), note: Object.entries(s.sectorExposure).filter(([k]) => k !== 'broad').sort((a, b) => b[1].gross - a[1].gross)[0]?.[0] ? sectorLabel(Object.entries(s.sectorExposure).filter(([k]) => k !== 'broad').sort((a, b) => b[1].gross - a[1].gross)[0][0]) : '—' },
    { label: 'Gross exposure', value: s.grossLeverage, limit: L.maxGross, fmt: (x) => pct(x, 0, false), note: 'Prime broker hard limit for new risk' },
    { label: 'Margin utilisation', value: s.marginUtilisation, limit: L.maxMarginUtilisation, fmt: (x) => pct(x, 0, false), note: 'Forced liquidation at 100%' },
  ];
  return (
    <div>
      <div className="page-h">
        <div><h1>Risk</h1><div className="sub">Limits, exposures and margin. Breaches upset clients and can restrict trading.</div></div>
        <label className="row small"><input type="checkbox" checked={state.risk.enforcePreTrade} onChange={(e) => controller.act((st) => { st.risk.enforcePreTrade = e.target.checked; })} /> Enforce limits pre-trade (block breaching orders)</label>
      </div>
      <div className="stats mb">
        <Stat label="Long exposure" value={money(s.longValue, { compact: true })} sub={pct(s.longValue / Math.max(s.nav, 1), 0, false)} />
        <Stat label="Short exposure" value={money(s.shortValue, { compact: true })} sub={pct(s.shortValue / Math.max(s.nav, 1), 0, false)} />
        <Stat label="Gross / net" value={`${pct(s.grossLeverage, 0, false)} / ${pct(s.netLeverage, 0)}`} />
        <Stat label="Free cash" value={money(s.freeCash, { compact: true })} valueClass={s.freeCash < 0 ? 'neg' : ''} sub={pct(s.freeCash / Math.max(s.nav, 1), 1)} />
        <Stat label="Maintenance margin" value={money(s.maintenanceReq, { compact: true })} sub={`excess ${money(s.excessLiquidity, { compact: true })}`} />
        <Stat label="Drawdown" value={pct(-dd, 1)} valueClass={dd > 0.1 ? 'neg' : ''} sub={`max ${pct(-state.stats.maxDrawdown, 1)}`} />
        <Stat label="Breach streak" value={`${state.risk.breachStreak} days`} sub={`${state.risk.cleanDays} clean days`} />
        <Stat label="Margin calls" value={state.risk.marginCalls} sub={automationOn(state, 'riskMonitor') ? 'Risk monitor ON' : 'Risk monitor off'} />
      </div>
      <div className="grid g2">
        <Panel title="Limits">
          <div className="col" style={{ gap: 14 }}>
            {rows.map((r) => {
              const tone = r.value > r.limit ? 'neg' : r.value > r.limit * 0.85 ? 'warn' : 'pos';
              return (
                <div key={r.label}>
                  <div className="spread"><span>{r.label} <span className="small dim">· {r.note}</span></span><span className={`num ${tone === 'pos' ? '' : tone}`}>{r.fmt(r.value)} / {r.fmt(r.limit)}</span></div>
                  <Bar value={r.value} max={Math.max(r.limit * 1.5, r.value)} limit={r.limit} tone={tone} />
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title={`Alerts (${state.risk.breaches.length})`} flush>
          {state.risk.breaches.length === 0 && <div className="empty">No risk alerts. The book is within all limits.</div>}
          {state.risk.breaches.map((b) => (
            <div key={b.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <Badge tone={b.severity === 'warning' ? 'warn' : 'neg'}>{b.severity.toUpperCase()}</Badge>
              <div className="grow">
                <div><b>{b.title}</b> <span className="small dim">· rule: {b.rule}</span></div>
                <div className="small muted">{b.detail}</div>
                {b.instruments.length > 0 && <div className="row wrap mt" style={{ gap: 4 }}>{b.instruments.map((i) => {
                  const p = state.fund.positions[i];
                  return <button key={i} className="btn sm" onClick={() => { if (p) { prefillTicket({ instrument: i, side: p.qty > 0 ? 'sell' : 'cover' }); go('instrument', i); } else go('instrument', i); }}>{i}{p ? ` · ${p.qty > 0 ? 'sell' : 'cover'}` : ''}</button>;
                })}</div>}
                <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{b.actions.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            </div>
          ))}
        </Panel>
      </div>
      <Panel title="Exposure by sector" className="mt">
        <div className="grid g3">
          {Object.entries(s.sectorExposure).sort((a, b) => b[1].gross - a[1].gross).map(([k, e]) => (
            <div key={k}>
              <div className="spread small"><span>{sectorLabel(k)}</span><span className="num">L {pct(e.long / Math.max(s.nav, 1), 0, false)} · S {pct(e.short / Math.max(s.nav, 1), 0, false)}</span></div>
              <Bar value={e.gross / Math.max(s.nav, 1)} max={Math.max(0.6, e.gross / Math.max(s.nav, 1))} limit={k === 'broad' ? undefined : L.maxSectorWeight} tone={k !== 'broad' && e.gross / Math.max(s.nav, 1) > L.maxSectorWeight ? 'neg' : undefined} />
            </div>
          ))}
        </div>
        {!s.positions.length && <div className="dim">No exposure.</div>}
      </Panel>
    </div>
  );
}
