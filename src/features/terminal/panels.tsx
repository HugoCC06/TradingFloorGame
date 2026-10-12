import { useState } from 'react';
import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { prefillTicket, selectInstrument } from '../../app/selection';
import { useSettings, useVersion } from '../../app/store';
import { instById, summarize } from '../../game/accounting';
import { clockLabel } from '../../game/calendar';
import { upcomingEvents } from '../../game/events/engine';
import { cancelOrder, describeOrder } from '../../game/orders';
import { currentDrawdown } from '../../game/performance';
import { lastCloses } from '../../game/series';
import type { GameState } from '../../game/types';
import { Badge, Bar, Change, DataTable, Empty, Sparkline } from '../../ui/components';
import { CandleChart, TIMEFRAMES, type Timeframe } from '../../ui/charts';
import { cls, money, num, pct, price } from '../../ui/format';

export function WatchlistPanel({ state, selected }: { state: GameState; selected: string }) {
  const [adding, setAdding] = useState('');
  const rows = state.watchlist.map((id) => instById(state, id)).filter(Boolean) as NonNullable<ReturnType<typeof instById>>[];
  const add = () => {
    const id = adding.trim().toUpperCase();
    if (instById(state, id) && !state.watchlist.includes(id)) controller.act((s) => { s.watchlist.push(id); });
    setAdding('');
  };
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="tbl-wrap" style={{ maxHeight: 360 }}>
        <table className="tbl" aria-label="Watchlist">
          <thead><tr><th>Symbol</th><th className="num">Last</th><th className="num">Chg</th><th className="hide-sm" /></tr></thead>
          <tbody>
            {rows.map((i) => {
              const ch = i.price / i.prevClose - 1;
              const spark = lastCloses(state.history.m1[i.idx], 90);
              return (
                <tr key={i.id} className={`clickable ${selected === i.id ? 'selected' : ''}`} onClick={() => selectInstrument(i.id)} onDoubleClick={() => go('instrument', i.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && selectInstrument(i.id)}>
                  <td><b>{i.id}</b>{state.fund.positions[i.id] && <span className="dot" style={{ background: 'var(--accent)', marginLeft: 5 }} title="Held" />}<div className="small dim ellipsis" style={{ maxWidth: 110 }}>{i.name}</div></td>
                  <td className="num">{price(i.price)}</td>
                  <td className="num"><Change value={ch} showArrow={false} /></td>
                  <td><Sparkline values={spark} width={54} height={20} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
        <input className="input grow" placeholder="Add symbol…" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Add symbol to watchlist" list="all-symbols" />
        <button className="btn sm" onClick={add}>Add</button>
        {state.watchlist.includes(selected) && <button className="btn sm ghost" title="Remove selected" onClick={() => controller.act((s) => { s.watchlist = s.watchlist.filter((x) => x !== selected); })}>−</button>}
        <datalist id="all-symbols">{state.instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</datalist>
      </div>
    </div>
  );
}

export function ChartPanel({ state, id, height = 330 }: { state: GameState; id: string; height?: number }) {
  const settings = useSettings();
  const version = useVersion();
  const [tf, setTf] = useState<Timeframe>(settings.defaultTimeframe);
  const inst = instById(state, id);
  if (!inst) return <Empty>Select an instrument</Empty>;
  const ch = inst.price / inst.prevClose - 1;
  const pos = state.fund.positions[id];
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="spread wrap" style={{ padding: '8px 12px 0' }}>
        <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
          <button className="btn ghost" style={{ padding: 0, height: 'auto', fontSize: 16, fontWeight: 700 }} onClick={() => go('instrument', id)}>{inst.id}</button>
          <span className="muted ellipsis" style={{ maxWidth: 220 }}>{inst.name}</span>
          <span className="num" style={{ fontSize: 16, fontWeight: 600 }} data-testid="chart-price">{price(inst.price)}</span>
          <Change value={ch} />
          {pos && <Badge tone={pos.qty > 0 ? 'pos' : 'neg'}>{pos.qty > 0 ? 'LONG' : 'SHORT'} {num(Math.abs(pos.qty))}</Badge>}
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Timeframe">
            {TIMEFRAMES.map((t) => <button key={t} className={t === tf ? 'on' : ''} onClick={() => setTf(t)}>{t}</button>)}
          </div>
          <button className="btn sm buy" onClick={() => prefillTicket({ instrument: id, side: pos && pos.qty < 0 ? 'cover' : 'buy' })}>{pos && pos.qty < 0 ? 'Cover' : 'Buy'}</button>
          <button className="btn sm sell" onClick={() => prefillTicket({ instrument: id, side: pos && pos.qty > 0 ? 'sell' : 'short' })}>{pos && pos.qty > 0 ? 'Sell' : 'Short'}</button>
        </div>
      </div>
      <CandleChart state={state} idx={inst.idx} tf={tf} height={height} version={version} />
      <div className="row wrap small muted" style={{ padding: '0 12px 10px', gap: 14 }}>
        <span>Open <span className="num">{price(inst.dayOpen)}</span></span>
        <span>High <span className="num">{price(inst.dayHigh)}</span></span>
        <span>Low <span className="num">{price(inst.dayLow)}</span></span>
        <span>Prev <span className="num">{price(inst.prevClose)}</span></span>
        <span>Vol <span className="num">{num(inst.dayVolume)}</span></span>
        <span>Spread <span className="num">{(inst.halfSpreadBps * 2).toFixed(1)}bp</span></span>
      </div>
    </div>
  );
}

export function PositionsPanel({ state, onSelect, compact }: { state: GameState; onSelect?: (id: string) => void; compact?: boolean }) {
  const s = summarize(state);
  return (
    <DataTable
      rows={s.positions}
      rowKey={(p) => p.id}
      onRowClick={(p) => (onSelect ? onSelect(p.id) : go('instrument', p.id))}
      initialSort="exposure"
      maxHeight={compact ? 260 : undefined}
      empty="No positions. Use the order ticket to trade."
      columns={[
        { key: 'id', label: 'Symbol', sort: (p) => p.id, render: (p) => <b>{p.id}</b> },
        { key: 'qty', label: 'Qty', num: true, sort: (p) => p.qty, render: (p) => <span className={p.qty < 0 ? 'neg' : ''}>{num(p.qty)}</span> },
        ...(compact ? [] : [{ key: 'avg', label: 'Avg cost', num: true, sort: (p: typeof s.positions[0]) => p.avgPrice, render: (p: typeof s.positions[0]) => price(p.avgPrice) }]),
        { key: 'px', label: 'Last', num: true, sort: (p) => p.price, render: (p) => price(p.price) },
        { key: 'exposure', label: 'Value', num: true, sort: (p) => p.exposure, render: (p) => money(p.value, { compact: true }) },
        { key: 'w', label: 'Wt', num: true, sort: (p) => Math.abs(p.weight), render: (p) => <span className={Math.abs(p.weight) > state.risk.limits.maxPositionWeight ? 'warn' : ''}>{pct(p.weight, 1, false)}</span> },
        { key: 'day', label: 'Day P&L', num: true, sort: (p) => p.dayPnl, render: (p) => <span className={cls(p.dayPnl)}>{money(p.dayPnl, { compact: true, sign: true })}</span> },
        { key: 'unr', label: 'Unrealised', num: true, sort: (p) => p.unrealized, render: (p) => <span className={cls(p.unrealized)}>{money(p.unrealized, { compact: true, sign: true })} <span className="small">({pct(p.unrealizedPct, 1)})</span></span> },
      ]}
    />
  );
}

export function OpenOrdersPanel({ state }: { state: GameState }) {
  const open = state.orders.filter((o) => o.status === 'open');
  if (!open.length) return <Empty>No working orders.</Empty>;
  return (
    <div>
      {open.map((o) => (
        <div key={o.id} className="list-row">
          <div className="grow">
            <div className="small"><b className={o.side === 'buy' || o.side === 'cover' ? 'pos' : 'neg'}>{o.side.toUpperCase()}</b> {num(o.quantity)} <b>{o.instrument}</b></div>
            <div className="small dim">{o.type === 'market' ? 'Market (queued for open)' : o.type === 'limit' ? `Limit ${price(o.limitPrice!)}` : `Stop ${price(o.stopPrice!)}`} · {o.tif.toUpperCase()}{o.origin !== 'player' ? ` · ${o.origin}` : ''}</div>
          </div>
          <button className="btn sm danger" onClick={() => controller.act((s) => cancelOrder(s, o.id))} aria-label={`Cancel ${describeOrder(o)}`}>Cancel</button>
        </div>
      ))}
    </div>
  );
}

export function NewsPanel({ state, limit = 25 }: { state: GameState; limit?: number }) {
  const items = state.news.slice(-limit).reverse();
  const held = new Set(Object.keys(state.fund.positions));
  if (!items.length) return <Empty>No news yet.</Empty>;
  return (
    <div>
      {items.map((n) => {
        const mine = n.instruments.some((i) => held.has(i));
        return (
          <div key={n.id} className={`news-item ${n.read ? '' : 'unread'}`} onClick={() => go('news', n.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('news', n.id)}>
            <span className={`sev s${n.severity}`} />
            <div className="grow">
              <div className="h">{n.headline}</div>
              <div className="row small dim" style={{ marginTop: 2 }}>
                <span>{n.day === state.clock.day ? (n.minute < 0 ? 'Pre-market' : n.minute >= 390 ? 'After close' : clockLabel(n.minute)) : n.date.slice(5)}</span>
                {n.instruments.slice(0, 3).map((i) => <span key={i} className="badge">{i}</span>)}
                {mine && <Badge tone="accent">Your holding</Badge>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RiskMini({ state }: { state: GameState }) {
  const s = summarize(state);
  const L = state.risk.limits;
  const dd = currentDrawdown(state);
  const largest = s.largestPosition;
  return (
    <div className="col" style={{ gap: 10 }}>
      <Metric label="Gross exposure" value={s.grossLeverage} limit={L.maxGross} max={L.maxGross * 1.3} />
      <Metric label="Margin utilisation" value={s.marginUtilisation} limit={L.maxMarginUtilisation} max={1} />
      <Metric label={`Largest position${largest ? ` (${largest.id})` : ''}`} value={Math.abs(largest?.weight ?? 0)} limit={L.maxPositionWeight} max={L.maxPositionWeight * 2} />
      <div className="kv">
        <span>Net exposure</span><span>{pct(s.netLeverage, 0)}</span>
        <span>Drawdown</span><span className={dd > 0.1 ? 'neg' : ''}>{pct(-dd, 1)}</span>
        <span>Free cash</span><span>{money(s.freeCash, { compact: true })}</span>
      </div>
      {state.risk.breaches.slice(0, 3).map((b) => (
        <div key={b.id} className={`small ${b.severity === 'warning' ? 'warn' : 'neg'}`} role="alert">● {b.title}</div>
      ))}
      <button className="btn sm" onClick={() => go('risk')}>Open risk dashboard</button>
    </div>
  );
}

function Metric({ label, value, limit, max }: { label: string; value: number; limit: number; max: number }) {
  const tone = value > limit ? 'neg' : value > limit * 0.85 ? 'warn' : 'pos';
  return (
    <div>
      <div className="spread small"><span className="muted">{label}</span><span className={`num ${tone === 'pos' ? '' : tone}`}>{pct(value, 0, false)} <span className="dim">/ {pct(limit, 0, false)}</span></span></div>
      <Bar value={value} max={max} limit={limit} tone={tone} />
    </div>
  );
}

export function CalendarPanel({ state, days = 5 }: { state: GameState; days?: number }) {
  const ev = upcomingEvents(state, days);
  const held = new Set(Object.keys(state.fund.positions));
  if (!ev.length) return <Empty>Nothing scheduled.</Empty>;
  return (
    <div>
      {ev.slice(0, 40).map((e, k) => (
        <div key={k} className="list-row small" style={{ cursor: e.instrument ? 'pointer' : undefined }} onClick={() => e.instrument && go('instrument', e.instrument)}>
          <span className="badge" style={{ minWidth: 64, justifyContent: 'center' }}>{e.day === state.clock.day ? 'Today' : e.day === state.clock.day + 1 ? 'Tomorrow' : `+${e.day - state.clock.day}d`}</span>
          <div className="grow">
            <div><b>{e.label}</b>{e.instrument && held.has(e.instrument) && <Badge tone="accent">Held</Badge>}</div>
            {e.detail && <div className="dim">{e.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function IntradayPanel({ state }: { state: GameState }) {
  const s = summarize(state);
  const vals = state.intradayNav.map((p) => p.nav);
  const day = s.nav - state.navAtOpen;
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="spread">
        <div className="stat"><span className="tiny">Today</span><span className={`v ${cls(day)}`}>{money(day, { sign: true })}</span></div>
        <div className="stat right"><span className="tiny">Since open</span><span className={cls(day)}>{pct(state.navAtOpen ? day / state.navAtOpen : 0)}</span></div>
      </div>
      <Sparkline values={vals.length > 1 ? vals : [0, 0]} width={300} height={46} fluid />
    </div>
  );
}
