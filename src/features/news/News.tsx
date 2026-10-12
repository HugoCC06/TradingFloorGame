import { useEffect, useMemo, useState } from 'react';
import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { useGame } from '../../app/store';
import { SECTOR_BY_ID } from '../../config/sectors';
import { clockLabel } from '../../game/calendar';
import { newsCategoryLabel } from '../../game/events/engine';
import type { NewsCategory } from '../../game/types';
import { Badge, Change, Panel } from '../../ui/components';

const CATS: (NewsCategory | 'all' | 'holdings')[] = ['all', 'holdings', 'breaking', 'earnings', 'corporate', 'economic', 'centralbank', 'sector', 'commodity', 'market', 'competitor', 'client'];

export function News({ id }: { id?: string }) {
  const state = useGame();
  const [cat, setCat] = useState<(typeof CATS)[number]>('all');
  const [q, setQ] = useState('');
  const [minSev, setMinSev] = useState(1);
  const held = new Set(Object.keys(state.fund.positions));
  const items = useMemo(() => state.news.filter((n) => {
    if (cat === 'holdings' && !n.instruments.some((i) => held.has(i))) return false;
    if (cat !== 'all' && cat !== 'holdings' && n.category !== cat) return false;
    if (n.severity < minSev) return false;
    if (q && !(`${n.headline} ${n.body} ${n.instruments.join(' ')}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  }).reverse(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [state.news.length, state.counters.news, cat, q, minSev, state.clock.minute]);
  const sel = state.news.find((n) => n.id === id) ?? null;
  useEffect(() => {
    if (sel && !sel.read) controller.act(() => { sel.read = true; });
  }, [sel]);
  const markAll = () => controller.act((s) => { for (const n of s.news) n.read = true; });
  return (
    <div>
      <div className="page-h">
        <div><h1>News</h1><div className="sub">Headlines refer to real entities in your market. Effects are probabilistic — the article explains the likely mechanism, not a guaranteed outcome.</div></div>
        <div className="row wrap">
          <input className="input" placeholder="Search news" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search news" />
          <select className="input" value={minSev} onChange={(e) => setMinSev(Number(e.target.value))} aria-label="Minimum importance">
            <option value={1}>All importance</option><option value={2}>Notable+</option><option value={3}>Major+</option><option value={4}>Critical</option>
          </select>
          <button className="btn" onClick={markAll}>Mark all read</button>
        </div>
      </div>
      <div className="row wrap mb" style={{ gap: 4 }}>
        {CATS.map((c) => <button key={c} className={`btn sm ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c === 'all' ? 'All' : c === 'holdings' ? 'My holdings' : newsCategoryLabel(c)}</button>)}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)' }}>
        <Panel flush>
          <div style={{ maxHeight: 'calc(100vh - 250px)', overflow: 'auto' }}>
            {items.map((n) => (
              <div key={n.id} className={`news-item ${n.read ? '' : 'unread'} ${sel?.id === n.id ? 'sel' : ''}`} onClick={() => go('news', n.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('news', n.id)}>
                <span className={`sev s${n.severity}`} />
                <div className="grow">
                  <div className="h">{n.headline}</div>
                  <div className="row small dim" style={{ marginTop: 2 }}>
                    <span>{n.date.slice(5)} {n.minute < 0 ? 'pre-mkt' : n.minute >= 390 ? 'after close' : clockLabel(n.minute)}</span>
                    <span>{newsCategoryLabel(n.category)}</span>
                    {n.instruments.some((i) => held.has(i)) && <Badge tone="accent">Holding</Badge>}
                  </div>
                </div>
              </div>
            ))}
            {!items.length && <div className="empty">No news matches.</div>}
          </div>
        </Panel>
        <Panel title={sel ? newsCategoryLabel(sel.category) : 'Article'}>
          {sel ? (
            <article className="col" style={{ gap: 10 }} data-testid="article">
              <div className="row small dim">
                <span>{sel.date} · {sel.minute < 0 ? 'Pre-market' : sel.minute >= 390 ? 'After the close' : clockLabel(sel.minute)}</span>
                <Badge tone={sel.severity >= 4 ? 'neg' : sel.severity === 3 ? 'warn' : sel.severity === 2 ? 'accent' : undefined}>{['', 'Minor', 'Notable', 'Major', 'Critical'][sel.severity]}</Badge>
              </div>
              <h2 style={{ fontSize: 19 }}>{sel.headline}</h2>
              <p>{sel.body}</p>
              {sel.explanation && <div className="card small" style={{ padding: 10 }}><div className="tiny">Why it matters</div>{sel.explanation}</div>}
              {sel.instruments.length > 0 && (
                <div>
                  <div className="tiny mb">Affected instruments</div>
                  <div className="row wrap">
                    {sel.instruments.map((i) => {
                      const inst = state.instruments.find((x) => x.id === i);
                      return inst ? (
                        <button key={i} className="btn sm" onClick={() => go('instrument', i)}>
                          <b>{i}</b> <Change value={inst.price / inst.prevClose - 1} showArrow={false} />{held.has(i) && <Badge tone="accent">held</Badge>}
                        </button>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
              {sel.sectors.length > 0 && <div className="small muted">Sectors: {sel.sectors.map((s) => SECTOR_BY_ID[s]?.name ?? s).join(', ')}</div>}
              {sel.macro && sel.macro.length > 0 && <div className="small muted">Macro channels: {sel.macro.join(', ')}</div>}
              {sel.storyId && <div className="small"><Badge tone="accent">Developing story</Badge> <span className="dim">Further developments may follow in coming sessions.</span></div>}
            </article>
          ) : <div className="empty">Select a headline to read the article.</div>}
        </Panel>
      </div>
    </div>
  );
}
