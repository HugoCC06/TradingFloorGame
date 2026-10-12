import { go } from '../../app/router';
import { useGame } from '../../app/store';
import { SECTOR_BY_ID, type SectorId } from '../../config/sectors';
import { instById, summarize } from '../../game/accounting';
import { earningsPreview } from '../../game/events/engine';
import { analystCoverage } from '../../game/staff';
import { Badge, Change, Empty, Panel } from '../../ui/components';
import { cls, compact, money, num, pct, price } from '../../ui/format';
import { OrderTicket } from '../orders/OrderTicket';
import { ChartPanel, NewsPanel } from '../terminal/panels';
import { Fundamentals } from '../research/Research';

export function InstrumentPage({ id }: { id?: string }) {
  const state = useGame();
  const inst = id ? instById(state, id) : undefined;
  if (!inst) return <Empty>Instrument not found. <button className="btn sm" onClick={() => go('markets')}>Back to markets</button></Empty>;
  const pos = summarize(state).positions.find((p) => p.id === inst.id);
  const f = inst.fundamentals;
  const news = { ...state, news: state.news.filter((n) => n.instruments.includes(inst.id) || (inst.kind === 'equity' && n.sectors.includes(inst.sector as SectorId) && n.severity >= 2)) };
  const cov = inst.kind === 'equity' ? analystCoverage(state, inst.sector as string) : 0;
  const preview = f ? earningsPreview(inst, cov, state.setup.seed) : null;
  return (
    <div>
      <div className="page-h">
        <div>
          <div className="row"><button className="btn ghost sm" onClick={() => history.back()}>← Back</button><span className="dim small">{inst.kind === 'equity' ? `${SECTOR_BY_ID[inst.sector as SectorId].name} · ${inst.industry}` : inst.kind === 'etf' ? 'Exchange-traded fund' : `Commodity contract · per ${inst.commodity!.unit}`}</span></div>
          <h1 style={{ marginTop: 6 }}>{inst.name} <span className="muted">({inst.id})</span></h1>
          <div className="row mt"><span className="num" style={{ fontSize: 22, fontWeight: 600 }}>{price(inst.price)}</span><Change value={inst.price / inst.prevClose - 1} />
            {!inst.shortable && <Badge tone="warn">Not shortable</Badge>}
            {inst.borrowFee > 0.03 && inst.shortable && <Badge tone="warn">Hard to borrow {pct(inst.borrowFee, 1, false)}</Badge>}
            {inst.activeStory && <Badge tone="accent">Developing story</Badge>}
          </div>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(280px, 1fr)' }}>
        <div className="col" style={{ gap: 12 }}>
          <Panel flush><ChartPanel state={state} id={inst.id} height={380} /></Panel>
          <Panel title="About">
            <p className="muted">{inst.description}</p>
            {inst.etf && <><div className="tiny mt mb">Top constituents</div>
              <div className="row wrap">{[...inst.etf.constituents].sort((a, b) => b.w - a.w).slice(0, 12).map((c) => (
                <button key={c.idx} className="btn sm" onClick={() => go('instrument', state.instruments[c.idx].id)}>{state.instruments[c.idx].id} <span className="dim">{pct(c.w, 1, false)}</span></button>))}</div>
              <div className="small dim mt">Expense ratio {pct(inst.etf.expenseRatio, 2, false)} · {inst.etf.constituents.length} holdings</div></>}
          </Panel>
          {f && <Panel title="Fundamentals"><Fundamentals state={state} inst={inst} /></Panel>}
          <Panel title="Related news" flush><div style={{ maxHeight: 360, overflow: 'auto' }}><NewsPanel state={news} limit={30} /></div></Panel>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <Panel title="Trade"><OrderTicket state={state} instrumentId={inst.id} /></Panel>
          <Panel title="Your position">
            {pos ? (
              <div className="kv">
                <span>Side</span><span className={pos.qty > 0 ? 'pos' : 'neg'}>{pos.qty > 0 ? 'Long' : 'Short'}</span>
                <span>Quantity</span><span>{num(Math.abs(pos.qty))}</span>
                <span>{pos.qty > 0 ? 'Average cost' : 'Short entry'}</span><span>{price(pos.avgPrice)}</span>
                <span>Market value</span><span>{money(pos.value)}</span>
                <span>Weight</span><span>{pct(pos.weight, 1)}</span>
                <span>Unrealised P&L</span><span className={cls(pos.unrealized)}>{money(pos.unrealized, { sign: true })}</span>
                <span>Today</span><span className={cls(pos.dayPnl)}>{money(pos.dayPnl, { sign: true })}</span>
                <span>Realised (this position)</span><span className={cls(pos.realized)}>{money(pos.realized, { sign: true })}</span>
              </div>
            ) : <div className="dim">No position. Lifetime realised P&L: <span className={cls(state.fund.instrumentPnl[inst.id] ?? 0)}>{money(state.fund.instrumentPnl[inst.id] ?? 0, { sign: true })}</span></div>}
          </Panel>
          <Panel title="Trading information">
            <div className="kv">
              <span>Bid / ask spread</span><span>{(inst.halfSpreadBps * 2).toFixed(1)} bp</span>
              <span>Avg daily volume</span><span>{compact(inst.adv)}</span>
              <span>Daily volatility</span><span>{pct(inst.vol, 1, false)}</span>
              <span>Beta</span><span>{inst.beta.toFixed(2)}</span>
              <span>Short borrow fee</span><span>{inst.shortable ? pct(inst.borrowFee, 2, false) + '/yr' : 'n/a'}</span>
              {f && <><span>Next earnings</span><span>{f.nextEarningsDay - state.clock.day <= 0 ? 'Today' : `in ${f.nextEarningsDay - state.clock.day} days`} ({f.earningsTiming === 'pre' ? 'pre-market' : 'after close'})</span></>}
            </div>
            {preview && (
              <div className="mt small">
                <div className="tiny">Analyst earnings preview</div>
                <div>House view: <b className={preview.view === 'beat' ? 'pos' : preview.view === 'miss' ? 'neg' : ''}>{preview.view === 'beat' ? 'Likely beat' : preview.view === 'miss' ? 'Likely miss' : 'In line'}</b> ({Math.round(preview.beatProb * 100)}% beat probability, {preview.confidence.toLowerCase()} confidence)</div>
                <div className="dim">Previews are estimates, not guarantees — guidance and valuation also drive the reaction.</div>
              </div>
            )}
            {f && !preview && <div className="small dim mt">Hire an analyst covering {SECTOR_BY_ID[inst.sector as SectorId].name} for earnings previews and fair-value estimates.</div>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
