import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { useGame } from '../../app/store';
import { Change, Empty, Panel, Stat } from '../../ui/components';
import { cls, money, pct } from '../../ui/format';

export function Report() {
  const state = useGame();
  const r = state.lastReport;
  if (!r) return <Empty>No report yet — the first end-of-day report appears after the 16:00 close.</Empty>;
  const news = r.news.map((id) => state.news.find((n) => n.id === id)).filter(Boolean);
  const fills = r.fills.map((id) => state.fills.find((f) => f.id === id)).filter(Boolean);
  const isToday = r.day === state.clock.day && state.clock.phase === 'closed';
  return (
    <div data-testid="eod-report">
      <div className="page-h">
        <div><h1>End-of-day report</h1><div className="sub">{r.date} · {isToday ? 'Market closed at 16:00' : 'Previous session'}</div></div>
        {isToday && state.status === 'active' && <button className="btn primary lg" onClick={() => { controller.nextDay(); go('terminal'); }}>Advance to next trading day ▸</button>}
      </div>
      <div className="stats mb">
        <Stat label="Investment P&L" value={money(r.pnl, { sign: true })} valueClass={cls(r.pnl)} large />
        <Stat label="Fund return" value={<Change value={r.dailyReturn} />} />
        <Stat label="Benchmark" value={<Change value={r.benchmarkReturn} />} />
        <Stat label="Relative" value={pct(r.dailyReturn - r.benchmarkReturn)} valueClass={cls(r.dailyReturn - r.benchmarkReturn)} />
        <Stat label="NAV at close" value={money(r.navEnd, { compact: true })} />
      </div>
      <div className="grid g3">
        <Panel title="Biggest winners">{r.winners.length ? r.winners.map((w) => <div key={w.id} className="spread small" onClick={() => go('instrument', w.id)} style={{ cursor: 'pointer', padding: '3px 0' }}><b>{w.id}</b><span className="pos num">{money(w.pnl, { sign: true })}</span></div>) : <span className="dim">None</span>}</Panel>
        <Panel title="Biggest losers">{r.losers.length ? r.losers.map((w) => <div key={w.id} className="spread small" onClick={() => go('instrument', w.id)} style={{ cursor: 'pointer', padding: '3px 0' }}><b>{w.id}</b><span className="neg num">{money(w.pnl, { sign: true })}</span></div>) : <span className="dim">None</span>}</Panel>
        <Panel title="Market movers">{r.marketMovers.map((m) => <div key={m.id} className="spread small" onClick={() => go('instrument', m.id)} style={{ cursor: 'pointer', padding: '3px 0' }}><b>{m.id}</b><Change value={m.change} /></div>)}</Panel>
      </div>
      <div className="grid g2 mt">
        <Panel title="Significant news" flush>{news.length ? news.map((n) => <div key={n!.id} className="news-item" onClick={() => go('news', n!.id)}><span className={`sev s${n!.severity}`} /><div className="h">{n!.headline}</div></div>) : <Empty>A quiet session.</Empty>}</Panel>
        <Panel title={`Executed orders (${fills.length})`} flush>
          {fills.length ? fills.map((f) => <div key={f!.id} className="list-row small"><b className={f!.side === 'buy' || f!.side === 'cover' ? 'pos' : 'neg'}>{f!.side.toUpperCase()}</b><span>{f!.quantity.toLocaleString('en-US')} {f!.instrument} @ {f!.price.toFixed(2)}</span><span className="grow" />{f!.realizedPnl ? <span className={cls(f!.realizedPnl)}>{money(f!.realizedPnl, { sign: true })}</span> : null}</div>) : <Empty>No trades today.</Empty>}
        </Panel>
      </div>
      <div className="grid g3 mt">
        <Panel title="Risk">{r.riskNotes.length ? r.riskNotes.map((x) => <div key={x} className="small neg">● {x}</div>) : <span className="small pos">All limits respected.</span>}</Panel>
        <Panel title="Clients">{r.clientNotes.length ? r.clientNotes.map((x, i) => <div key={i} className="small">● {x}</div>) : <span className="small dim">No client developments.</span>}</Panel>
        <Panel title="Business">{r.companyNotes.map((x) => <div key={x} className="small">● {x}</div>)}</Panel>
      </div>
      <div className="grid g2 mt">
        <Panel title="Rivals today">{[...r.rivalNotes].sort((a, b) => b.ret - a.ret).map((x) => <div key={x.id} className="spread small"><span>{state.rivals.find((rv) => rv.id === x.id)?.name}</span><Change value={x.ret} /></div>)}</Panel>
        <Panel title="Coming up">{r.upcoming.length ? r.upcoming.map((x) => <div key={x} className="small">● {x}</div>) : <span className="small dim">Nothing scheduled for the next two days.</span>}
          {r.reviewNotes.length > 0 && <><div className="tiny mt">Review desk</div>{r.reviewNotes.map((x) => <div key={x} className="small warn">● {x}</div>)}</>}
        </Panel>
      </div>
    </div>
  );
}
