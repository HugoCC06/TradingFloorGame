import { useState } from 'react';
import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { useGame } from '../../app/store';
import { clockLabel } from '../../game/calendar';
import { cancelOrder } from '../../game/orders';
import type { Order } from '../../game/types';
import { Badge, DataTable, Panel, Tabs } from '../../ui/components';
import { cls, money, num, price } from '../../ui/format';

type Tab = 'open' | 'filled' | 'cancelled' | 'rejected' | 'fills';

export function Orders() {
  const state = useGame();
  const [tab, setTab] = useState<Tab>('open');
  const by = (st: Order['status'][]) => state.orders.filter((o) => st.includes(o.status)).slice().reverse();
  const lists: Record<Exclude<Tab, 'fills'>, Order[]> = { open: by(['open']), filled: by(['filled']), cancelled: by(['cancelled', 'expired']), rejected: by(['rejected']) };
  const when = (d: number, m: number, date: string) => `${date.slice(5)} ${m >= 390 ? 'after close' : d === state.clock.day && state.clock.phase === 'pre' && m === 0 ? 'pre-market' : clockLabel(m)}`;
  return (
    <div>
      <div className="page-h"><div><h1>Orders & trades</h1><div className="sub">Complete audit trail of every order, fill, cancellation and rejection.</div></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'open', label: `Working (${lists.open.length})` }, { id: 'filled', label: 'Filled' }, { id: 'cancelled', label: 'Cancelled / expired' },
        { id: 'rejected', label: `Rejected (${lists.rejected.length})` }, { id: 'fills', label: 'Executions' }]} />
      <Panel flush>
        {tab !== 'fills' ? (
          <DataTable rows={lists[tab]} rowKey={(o) => o.id} empty="No orders in this category." maxHeight="calc(100vh - 240px)"
            columns={[
              { key: 'id', label: 'ID', render: (o) => <span className="mono dim">{o.id}</span> },
              { key: 't', label: 'Placed', render: (o) => when(o.createdDay, o.createdMinute, o.createdDate) },
              { key: 'sym', label: 'Symbol', render: (o) => <button className="btn ghost sm" onClick={() => go('instrument', o.instrument)}><b>{o.instrument}</b></button> },
              { key: 'side', label: 'Side', render: (o) => <b className={o.side === 'buy' || o.side === 'cover' ? 'pos' : 'neg'}>{o.side.toUpperCase()}</b> },
              { key: 'type', label: 'Type', render: (o) => `${o.type}${o.limitPrice ? ' ' + price(o.limitPrice) : ''}${o.stopPrice ? ' ' + price(o.stopPrice) : ''} · ${o.tif}` },
              { key: 'q', label: 'Qty', num: true, render: (o) => num(o.quantity) },
              { key: 'ref', label: 'Ref price', num: true, render: (o) => price(o.refPrice) },
              { key: 'fill', label: 'Fill', num: true, render: (o) => (o.fillPrice ? price(o.fillPrice) : '—') },
              { key: 'cost', label: 'Commission', num: true, render: (o) => (o.commission !== undefined ? money(o.commission, { decimals: 2 }) : '') },
              { key: 'origin', label: 'Origin', render: (o) => (o.origin === 'player' ? <span className="dim">you</span> : <Badge tone={o.origin === 'forced-liquidation' ? 'neg' : 'accent'}>{o.origin}</Badge>) },
              { key: 'r', label: tab === 'open' ? '' : 'Detail', render: (o) => (tab === 'open' ? <button className="btn sm danger" onClick={() => controller.act((s) => cancelOrder(s, o.id))}>Cancel</button> : <span className="small muted" style={{ whiteSpace: 'normal', display: 'inline-block', maxWidth: 360 }}>{o.reason ?? (o.filledDay !== undefined ? `Filled ${when(o.filledDay, o.filledMinute ?? 0, o.createdDate)}${o.triggered ? ' (stop triggered)' : ''}` : '')}</span>) },
            ]} />
        ) : (
          <DataTable rows={state.fills.slice().reverse()} rowKey={(f) => f.id} empty="No executions yet." maxHeight="calc(100vh - 240px)"
            columns={[
              { key: 'id', label: 'Fill', render: (f) => <span className="mono dim">{f.id}</span> },
              { key: 't', label: 'Time', render: (f) => `${f.date.slice(5)} ${clockLabel(Math.min(f.minute, 390))}` },
              { key: 'sym', label: 'Symbol', render: (f) => <b>{f.instrument}</b> },
              { key: 'side', label: 'Side', render: (f) => <b className={f.side === 'buy' || f.side === 'cover' ? 'pos' : 'neg'}>{f.side.toUpperCase()}</b> },
              { key: 'q', label: 'Qty', num: true, render: (f) => num(f.quantity) },
              { key: 'p', label: 'Price', num: true, render: (f) => price(f.price) },
              { key: 'n', label: 'Notional', num: true, render: (f) => money(f.notional) },
              { key: 'c', label: 'Commission', num: true, render: (f) => money(f.commission, { decimals: 2 }) },
              { key: 's', label: 'Spread/impact', num: true, render: (f) => money(f.slippageCost, { decimals: 2 }) },
              { key: 'r', label: 'Realised', num: true, render: (f) => (f.realizedPnl ? <span className={cls(f.realizedPnl)}>{money(f.realizedPnl, { sign: true })}</span> : '') },
              { key: 'o', label: 'Origin', render: (f) => f.origin },
            ]} />
        )}
      </Panel>
    </div>
  );
}
