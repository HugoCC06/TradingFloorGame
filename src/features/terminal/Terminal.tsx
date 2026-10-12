import { useState, type ReactNode } from 'react';
import { useSelected } from '../../app/selection';
import { useGame } from '../../app/store';
import { Panel } from '../../ui/components';
import { OrderTicket } from '../orders/OrderTicket';
import { CalendarPanel, ChartPanel, IntradayPanel, NewsPanel, OpenOrdersPanel, PositionsPanel, RiskMini, WatchlistPanel } from './panels';
import { go } from '../../app/router';
import { selectInstrument } from '../../app/selection';

type PanelId = 'watchlist' | 'chart' | 'ticket' | 'positions' | 'orders' | 'news' | 'risk' | 'calendar' | 'intraday';
const DEFAULT_LAYOUT: PanelId[][] = [['watchlist', 'intraday', 'calendar'], ['chart', 'positions'], ['ticket', 'news', 'orders', 'risk']];
const KEY = 'tf.layout.v1';

function loadLayout(): PanelId[][] {
  try {
    const l = JSON.parse(localStorage.getItem(KEY) ?? 'null') as PanelId[][] | null;
    const all = new Set(DEFAULT_LAYOUT.flat());
    if (l && l.length === 3 && l.flat().length === all.size && l.flat().every((p) => all.has(p))) return l;
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

const TITLES: Record<PanelId, string> = {
  watchlist: 'Watchlist', chart: 'Chart', ticket: 'Order ticket', positions: 'Positions', orders: 'Working orders',
  news: 'News feed', risk: 'Risk', calendar: 'Upcoming events', intraday: 'Fund today',
};

export function Terminal() {
  const state = useGame();
  const selected = useSelected();
  const [layout, setLayout] = useState<PanelId[][]>(loadLayout);
  const [drag, setDrag] = useState<PanelId | null>(null);
  const [over, setOver] = useState<PanelId | null>(null);

  const swap = (a: PanelId, b: PanelId) => {
    if (a === b) return;
    const l = layout.map((c) => [...c]);
    const pa = l.flatMap((c, ci) => c.map((p, pi) => (p === a ? [ci, pi] : null))).find(Boolean)!;
    const pb = l.flatMap((c, ci) => c.map((p, pi) => (p === b ? [ci, pi] : null))).find(Boolean)!;
    l[pa[0]][pa[1]] = b;
    l[pb[0]][pb[1]] = a;
    setLayout(l);
    try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* ignore */ }
  };
  const reset = () => { setLayout(DEFAULT_LAYOUT); localStorage.removeItem(KEY); };

  const body = (id: PanelId): ReactNode => {
    switch (id) {
      case 'watchlist': return <WatchlistPanel state={state} selected={selected} />;
      case 'chart': return <ChartPanel state={state} id={selected} />;
      case 'ticket': return <div style={{ padding: 12 }}><OrderTicket state={state} instrumentId={selected} /></div>;
      case 'positions': return <PositionsPanel state={state} compact onSelect={(id) => selectInstrument(id)} />;
      case 'orders': return <OpenOrdersPanel state={state} />;
      case 'news': return <div style={{ maxHeight: 360, overflow: 'auto' }}><NewsPanel state={state} /></div>;
      case 'risk': return <div style={{ padding: 12 }}><RiskMini state={state} /></div>;
      case 'calendar': return <div style={{ maxHeight: 300, overflow: 'auto' }}><CalendarPanel state={state} /></div>;
      case 'intraday': return <div style={{ padding: 12 }}><IntradayPanel state={state} /></div>;
    }
  };
  const actions = (id: PanelId) => {
    if (id === 'news') return <button className="btn sm ghost" onClick={() => go('news')}>All</button>;
    if (id === 'positions') return <button className="btn sm ghost" onClick={() => go('portfolio')}>Portfolio</button>;
    if (id === 'calendar') return <button className="btn sm ghost" onClick={() => go('research')}>Research</button>;
    return null;
  };

  return (
    <div>
      <div className="spread mb">
        <span className="small dim">Drag panel headers to rearrange · double-click a symbol for details</span>
        <button className="btn sm ghost" onClick={reset}>Reset layout</button>
      </div>
      <div className="terminal">
        {layout.map((col, ci) => (
          <div className="term-col" key={ci}>
            {col.map((id) => (
              <Panel key={id} flush title={<span><span className="grip" aria-hidden>⋮⋮</span> {TITLES[id]}</span>} actions={actions(id)}
                className={over === id && drag && drag !== id ? 'drag-over' : ''}
                headerProps={{
                  draggable: true,
                  onDragStart: (e) => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); },
                  onDragEnd: () => { setDrag(null); setOver(null); },
                  onDragOver: (e) => { if (drag) { e.preventDefault(); setOver(id); } },
                  onDrop: (e) => { e.preventDefault(); if (drag) swap(drag, id); setDrag(null); setOver(null); },
                }}
              >
                <div onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(id); } }} onDrop={(e) => { e.preventDefault(); if (drag) swap(drag, id); setDrag(null); setOver(null); }}
                  onDragLeave={() => setOver((o) => (o === id ? null : o))}>
                  {body(id)}
                </div>
              </Panel>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
