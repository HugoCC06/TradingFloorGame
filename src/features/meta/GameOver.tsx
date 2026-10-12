import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { useGame } from '../../app/store';
import { summarize } from '../../game/accounting';
import { sinceInception } from '../../game/performance';
import { careerEntryFor } from '../../persistence/profile';
import { Change, Panel, Stat } from '../../ui/components';
import { cls, money, pct } from '../../ui/format';

export function GameOver({ onNewGame }: { onNewGame: () => void }) {
  const state = useGame();
  if (state.status === 'active') return <div className="empty">The fund is still operating. <button className="btn sm" onClick={() => go('terminal')}>Back to terminal</button></div>;
  const s = summarize(state);
  const e = careerEntryFor(state);
  const f = state.failure!;
  const ranked = [...state.rivals.map((r) => ({ name: r.name, ret: r.navPerUnit / 100 - 1, aum: r.aum })), { name: state.setup.fundName + ' (you)', ret: sinceInception(state), aum: s.nav }].sort((a, b) => b.ret - a.ret);
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }} data-testid="game-over">
      <div className="card mb" style={{ borderColor: state.status === 'failed' ? 'var(--neg)' : 'var(--border-2)', padding: 22 }}>
        <div className="tiny">{state.status === 'failed' ? 'Fund failed' : 'Fund closed'} · {f.date}</div>
        <h1 style={{ fontSize: 26, margin: '6px 0' }}>{state.setup.fundName} {state.status === 'failed' ? 'has collapsed' : 'has been wound down'}</h1>
        <p className="muted" style={{ fontSize: 14 }}>{f.reason}</p>
        <div className="row mt">
          <button className="btn primary lg" onClick={onNewGame}>Start a new fund</button>
          <button className="btn lg" onClick={() => { controller.quitToMenu(); location.hash = ''; }}>Main menu</button>
          <button className="btn lg ghost" onClick={() => go('career')}>Career history</button>
        </div>
      </div>
      <div className="stats mb">
        <Stat label="Days survived" value={state.daily.length} />
        <Stat label="Final NAV" value={money(s.nav, { compact: true })} />
        <Stat label="Peak AUM" value={money(state.stats.peakAum, { compact: true })} />
        <Stat label="Total return" value={<Change value={sinceInception(state)} />} />
        <Stat label="Biggest drawdown" value={pct(-state.stats.maxDrawdown, 1)} valueClass="neg" />
        <Stat label="Best day / worst day" value={`${pct(state.stats.bestDay, 1)} / ${pct(state.stats.worstDay, 1)}`} />
        <Stat label="Trades" value={state.stats.trades} />
        <Stat label="Clients won / lost" value={`${state.stats.wonClients} / ${state.stats.lostClients}`} />
      </div>
      <div className="grid g2">
        <Panel title="Investments">
          <div className="kv">
            <span>Best investment</span><span className={cls(e.bestInvestment?.pnl ?? 0)}>{e.bestInvestment ? `${e.bestInvestment.id} ${money(e.bestInvestment.pnl, { sign: true })}` : '—'}</span>
            <span>Worst investment</span><span className={cls(e.worstInvestment?.pnl ?? 0)}>{e.worstInvestment ? `${e.worstInvestment.id} ${money(e.worstInvestment.pnl, { sign: true })}` : '—'}</span>
            <span>Realised P&L</span><span className={cls(state.fund.totals.realized)}>{money(state.fund.totals.realized, { sign: true })}</span>
            <span>Trading costs</span><span>{money(-(state.fund.totals.commissions + state.fund.totals.borrowFees + state.fund.totals.financing))}</span>
            <span>Fees earned by your firm</span><span>{money(state.company.totals.revenue)}</span>
            <span>Margin calls</span><span>{state.risk.marginCalls}</span>
          </div>
        </Panel>
        <Panel title="Versus rivals">
          {ranked.map((r, i) => <div key={r.name} className="spread small" style={{ padding: '3px 0', fontWeight: r.name.endsWith('(you)') ? 700 : 400 }}><span>{i + 1}. {r.name}</span><span><Change value={r.ret} /> <span className="dim">{money(r.aum, { compact: true })}</span></span></div>)}
        </Panel>
      </div>
      <Panel title="Key moments" className="mt">
        {state.stats.keyEvents.length ? [...state.stats.keyEvents].reverse().map((k, i) => <div key={i} className="small" style={{ padding: '3px 0' }}><span className="dim">{k.date}</span> {k.text}</div>) : <span className="dim">No notable events recorded.</span>}
      </Panel>
      <Panel title="Client history" className="mt">
        {state.clients.map((c) => <div key={c.id} className="small spread" style={{ padding: '3px 0' }}><span>{c.name}</span><span className="dim">{c.history[c.history.length - 1]?.text}</span></div>)}
      </Panel>
    </div>
  );
}
