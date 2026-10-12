import { useEffect, useMemo, useRef, useState } from 'react';
import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { selectInstrument } from '../../app/selection';
import { useGame } from '../../app/store';
import { SECTORS } from '../../config/sectors';
import type { Instrument } from '../../game/types';
import { Change, DataTable, Seg } from '../../ui/components';
import { compact, num, price } from '../../ui/format';

type Kind = 'all' | 'equity' | 'etf' | 'commodity' | 'watch' | 'held';

export function Markets() {
  const state = useGame();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [sector, setSector] = useState('all');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return state.instruments.filter((i) => {
      if (kind === 'watch' && !state.watchlist.includes(i.id)) return false;
      if (kind === 'held' && !state.fund.positions[i.id]) return false;
      if (kind !== 'all' && kind !== 'watch' && kind !== 'held' && i.kind !== kind) return false;
      if (sector !== 'all' && i.sector !== sector) return false;
      if (ql && !i.id.toLowerCase().includes(ql) && !i.name.toLowerCase().includes(ql) && !i.industry.toLowerCase().includes(ql)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, state.clock.minute, q, kind, sector, state.watchlist.length]);
  const mcap = (i: Instrument) => (i.fundamentals ? i.price * i.fundamentals.sharesOut : 0);
  const pe = (i: Instrument) => (i.fundamentals && i.fundamentals.earnings > 0 ? mcap(i) / i.fundamentals.earnings : NaN);
  const toggleWatch = (id: string) => controller.act((s) => { s.watchlist = s.watchlist.includes(id) ? s.watchlist.filter((x) => x !== id) : [...s.watchlist, id]; });
  return (
    <div>
      <div className="page-h">
        <div><h1>Markets</h1><div className="sub">{state.instruments.length} instruments · {state.instruments.filter((i) => i.kind === 'equity').length} equities, {state.instruments.filter((i) => i.kind === 'etf').length} ETFs, {state.instruments.filter((i) => i.kind === 'commodity').length} commodities</div></div>
        <div className="row wrap">
          <input ref={search} className="input" style={{ width: 220 }} placeholder="Search symbol, name, industry ( / )" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search instruments" data-testid="market-search" />
          <select className="input" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector filter">
            <option value="all">All sectors</option>
            {SECTORS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="broad">Broad market</option>
            <option value="commodity">Commodities</option>
          </select>
          <Seg value={kind} onChange={setKind} label="Instrument type" options={[{ id: 'all', label: 'All' }, { id: 'equity', label: 'Stocks' }, { id: 'etf', label: 'ETFs' }, { id: 'commodity', label: 'Commodities' }, { id: 'watch', label: '★ Watch' }, { id: 'held', label: 'Held' }]} />
        </div>
      </div>
      <div className="panel">
        <DataTable
          rows={rows}
          rowKey={(i) => i.id}
          onRowClick={(i) => { selectInstrument(i.id); go('instrument', i.id); }}
          initialSort="mcap"
          maxHeight="calc(100vh - 210px)"
          empty="No instruments match your filters."
          columns={[
            { key: 'w', label: '★', render: (i) => <button className="btn ghost sm" aria-label={`Toggle ${i.id} on watchlist`} onClick={(e) => { e.stopPropagation(); toggleWatch(i.id); }}>{state.watchlist.includes(i.id) ? '★' : '☆'}</button> },
            { key: 'id', label: 'Symbol', sort: (i) => i.id, render: (i) => <b>{i.id}</b> },
            { key: 'name', label: 'Name', sort: (i) => i.name, render: (i) => <span className="ellipsis" style={{ display: 'inline-block', maxWidth: 220 }}>{i.name}</span> },
            { key: 'sector', label: 'Sector', sort: (i) => String(i.sector), render: (i) => <span className="muted">{i.kind === 'equity' ? SECTORS.find((s) => s.id === i.sector)?.name : i.kind === 'etf' ? 'ETF' : 'Commodity'}</span> },
            { key: 'px', label: 'Price', num: true, sort: (i) => i.price, render: (i) => price(i.price) },
            { key: 'chg', label: 'Change', num: true, sort: (i) => i.price / i.prevClose - 1, render: (i) => <Change value={i.price / i.prevClose - 1} /> },
            { key: 'vol', label: 'Volume', num: true, sort: (i) => i.dayVolume, render: (i) => compact(i.dayVolume) },
            { key: 'mcap', label: 'Mkt cap', num: true, sort: (i) => mcap(i), render: (i) => (i.fundamentals ? '$' + compact(mcap(i)) : '—') },
            { key: 'pe', label: 'P/E', num: true, sort: (i) => (Number.isFinite(pe(i)) ? pe(i) : 9999), render: (i) => (Number.isFinite(pe(i)) ? num(pe(i), 1) : '—') },
            { key: 'pos', label: 'Held', num: true, sort: (i) => state.fund.positions[i.id]?.qty ?? 0, render: (i) => (state.fund.positions[i.id] ? num(state.fund.positions[i.id].qty) : '') },
          ]}
        />
      </div>
    </div>
  );
}
