import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { controller } from '../../app/controller';
import { go, useRoute, type Screen } from '../../app/router';
import { selectInstrument } from '../../app/selection';
import { SPEEDS, type SpeedId } from '../../app/settings';
import { useGame, useSettings } from '../../app/store';
import { summarize } from '../../game/accounting';
import { clockLabel, prettyDate } from '../../game/calendar';
import { windDownWarnings } from '../../game/failure';
import { sinceInception } from '../../game/performance';
import { Change, Confirm, FundLogo, Modal } from '../../ui/components';
import { cls, money, pct, price } from '../../ui/format';
import { Tutorial } from './Tutorial';

const NAV: { screen: Screen; label: string; key: string; section?: string }[] = [
  { screen: 'terminal', label: 'Terminal', key: 'T', section: 'Trading' },
  { screen: 'markets', label: 'Markets', key: 'M' },
  { screen: 'portfolio', label: 'Portfolio', key: 'P' },
  { screen: 'orders', label: 'Orders & trades', key: 'O' },
  { screen: 'news', label: 'News', key: 'N' },
  { screen: 'research', label: 'Research', key: 'R' },
  { screen: 'risk', label: 'Risk', key: 'K' },
  { screen: 'clients', label: 'Clients', key: 'C', section: 'Firm' },
  { screen: 'rivals', label: 'Rivals', key: 'V' },
  { screen: 'team', label: 'Team', key: 'E' },
  { screen: 'business', label: 'Business', key: 'B' },
  { screen: 'report', label: 'Daily report', key: 'D' },
  { screen: 'achievements', label: 'Achievements', key: 'A', section: 'Game' },
  { screen: 'saves', label: 'Save / load', key: 'L' },
  { screen: 'settings', label: 'Settings', key: 'S' },
  { screen: 'help', label: 'How to play', key: '?' },
];


function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function Shell({ children }: { children: ReactNode }) {
  const state = useGame();
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || document.querySelector('.overlay')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void controller.save(controller.slot ?? 'slot1', 'Quick save'); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); controller.toggle(); return; }
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); controller.nextDay(); go('terminal'); return; }
      const speeds: SpeedId[] = ['slow', 'normal', 'fast', 'turbo', 'max'];
      if (/^[1-5]$/.test(e.key)) { controller.setSpeed(speeds[Number(e.key) - 1]); return; }
      if (e.key === '.') { controller.advance(15); return; }
      if (e.key === '>') { controller.advanceToNextEvent(); return; }
      if (e.key === '?') { setShowKeys(true); return; }
      const item = NAV.find((n) => n.key.toLowerCase() === e.key.toLowerCase());
      if (item && item.key !== '?') go(item.screen);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setNavOpen(false), [route.screen]);
  useEffect(() => {
    if (state.status !== 'active' && route.screen !== 'gameover') go('gameover');
  }, [state.status, route.screen]);

  const unread = state.news.filter((n) => !n.read && n.severity >= 2).length;
  const breaches = state.risk.breaches.filter((b) => b.severity !== 'warning').length;
  const decisions = state.decisions.length;
  const counts: Partial<Record<Screen, number>> = { news: unread, risk: breaches, business: decisions };
  const warnings = windDownWarnings(state);

  return (
    <div className="shell">
      <TopBar onMenu={() => setNavOpen((v) => !v)} onQuit={() => setConfirmQuit(true)} />
      <Ticker />
      <nav className={`sidenav ${navOpen ? 'open' : ''}`} aria-label="Main">
        {NAV.map((n) => (
          <div key={n.screen}>
            {n.section && <div className="navsec">{n.section}</div>}
            <button className={`navitem ${route.screen === n.screen || (n.screen === 'markets' && route.screen === 'instrument') ? 'on' : ''}`} onClick={() => go(n.screen)}>
              {n.label}
              {counts[n.screen] ? <span className="cnt">{counts[n.screen]}</span> : <span className="k">{n.key}</span>}
            </button>
          </div>
        ))}
        <div className="grow" />
        <button className="navitem" onClick={() => setConfirmQuit(true)}>Quit to menu</button>
      </nav>
      <main className="main" id="main">
        {decisions > 0 && route.screen !== 'business' && (
          <div className="banner" role="status">
            <div className="spread"><span><b>Decision required:</b> {state.decisions[0].title}</span><button className="btn sm" onClick={() => go('business')}>Respond</button></div>
          </div>
        )}
        {warnings.map((w) => (
          <div className="banner danger" key={w.cause} role="alert">
            <b>{w.title}</b> — {w.detail} <b>{w.daysLeft} day{w.daysLeft === 1 ? '' : 's'} left.</b>
          </div>
        ))}
        {children}
      </main>
      <Toasts />
      <Tutorial />
      {confirmQuit && (
        <Confirm title="Quit to main menu?" text="Your progress will be saved to the autosave slot first." confirmLabel="Save & quit"
          onCancel={() => setConfirmQuit(false)}
          onConfirm={async () => { setConfirmQuit(false); if (controller.slot) await controller.save(controller.slot, 'Autosave', true); controller.quitToMenu(); location.hash = ''; }} />
      )}
      {showKeys && <ShortcutHelp onClose={() => setShowKeys(false)} />}
    </div>
  );
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Space', 'Pause / resume the market'], ['1 – 5', 'Simulation speed (0.5× … 80×)'], ['.', 'Advance 15 minutes'], ['>', 'Advance to the next notable event'],
    ['Shift + Enter', 'Next trading day (after the close)'], ['Ctrl/⌘ + S', 'Quick save'], ['/', 'Search instruments (Markets)'], ['?', 'This help'],
    ...NAV.filter((n) => n.key !== '?').map((n) => [n.key, n.label] as [string, string]),
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="kv" style={{ gridTemplateColumns: 'auto 1fr' }}>
        {rows.map(([k, v]) => <Fragment key={k + v}><span><span className="kbd">{k}</span></span><span style={{ textAlign: 'left', fontFamily: 'var(--font)' }}>{v}</span></Fragment>)}
      </div>
      <p className="small dim mt">Shortcuts are ignored while typing in a text field.</p>
    </Modal>
  );
}

function TopBar({ onMenu, onQuit }: { onMenu: () => void; onQuit: () => void }) {
  const state = useGame();
  const settings = useSettings();
  const s = summarize(state);
  const c = state.clock;
  const ret = sinceInception(state);
  const dayPnl = s.nav - state.navAtOpen;
  const phase = c.phase === 'open' ? 'Market open' : c.phase === 'pre' ? 'Pre-market' : 'Closed';
  const running = controller.running;
  return (
    <header className="topbar">
      <button className="btn ghost icon menu-btn" onClick={onMenu} aria-label="Toggle navigation">☰</button>
      <div className="row" style={{ minWidth: 0 }}>
        <FundLogo logo={state.setup.logo} name={state.setup.fundName} size={26} />
        <div className="col hide-xs" style={{ gap: 0, minWidth: 0 }}>
          <b className="ellipsis" style={{ maxWidth: 170 }}>{state.setup.fundName}</b>
          <span className="small dim">{state.setup.difficulty[0].toUpperCase() + state.setup.difficulty.slice(1)} · Day {state.daily.length + (c.phase === 'closed' ? 0 : 1)}</span>
        </div>
      </div>
      <div className="col" style={{ gap: 0, minWidth: 116 }} aria-live="polite">
        <span className="num" style={{ fontSize: 16, fontWeight: 600 }} data-testid="clock">{c.phase === 'pre' ? '09:30' : clockLabel(c.minute)}</span>
        <span className="small row" style={{ gap: 5 }}><span className={`dot ${c.phase === 'open' && running ? 'live' : ''}`} />{phase}</span>
      </div>
      <span className="small dim hide-sm">{prettyDate(c.date)}</span>
      <div className="row" style={{ gap: 6 }}>
        {c.phase !== 'closed' ? (
          <>
            <button className={`btn ${running ? '' : 'primary'}`} onClick={() => controller.toggle()} data-testid="play" aria-label={running ? 'Pause' : 'Play'} title="Space">
              {running ? '❚❚ Pause' : c.phase === 'pre' ? '▶ Open market' : '▶ Play'}
            </button>
            <select className="input hide-xs" style={{ width: 70, height: 30 }} value={settings.speed} onChange={(e) => controller.setSpeed(e.target.value as SpeedId)} aria-label="Simulation speed">
              {Object.entries(SPEEDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button className="btn hide-sm" onClick={() => controller.advance(15)} title="Advance 15 minutes (.)" data-testid="adv15">+15m</button>
            <button className="btn hide-sm" onClick={() => controller.advanceToNextEvent()} title="Advance to next event (>)">Next event</button>
            <button className="btn hide-sm" onClick={() => controller.skipToClose()} title="Run to 16:00" data-testid="skip-close">To close</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => go('report')}>Day report</button>
            <button className="btn primary" onClick={() => { controller.nextDay(); go('terminal'); }} data-testid="next-day" title="Shift+Enter">Next day ▸</button>
          </>
        )}
      </div>
      <div className="grow" />
      <div className="row gap-lg">
        <div className="stat hide-xs"><span className="tiny">NAV</span><span className="num" style={{ fontWeight: 600 }} data-testid="nav">{money(s.nav, { compact: true })}</span></div>
        <div className="stat hide-sm"><span className="tiny">Day P&L</span><span className={`num ${cls(dayPnl)}`}>{money(dayPnl, { compact: true, sign: true })}</span></div>
        <div className="stat hide-sm"><span className="tiny">Return</span><Change value={ret} /></div>
        <div className="stat hide-sm"><span className="tiny">Free cash</span><span className="num">{money(s.freeCash, { compact: true })}</span></div>
      </div>
      <button className="btn hide-xs" onClick={() => void controller.save(controller.slot ?? 'slot1', 'Quick save')} disabled={controller.saving} title="Ctrl/⌘+S">
        {controller.saving ? 'Saving…' : 'Save'}
      </button>
      <button className="btn ghost hide-sm" onClick={onQuit} title="Quit to menu">Menu</button>
    </header>
  );
}

function Ticker() {
  const state = useGame();
  const ids = Array.from(new Set([...state.watchlist, ...Object.keys(state.fund.positions)])).slice(0, 30);
  const latest = state.news.slice(-6).reverse();
  return (
    <div className="ticker" aria-label="Market ticker">
      <div className="tape">
        {ids.map((id) => {
          const i = state.instruments.find((x) => x.id === id);
          if (!i) return null;
          const ch = i.price / i.prevClose - 1;
          return (
            <span key={id} className="item" onClick={() => { selectInstrument(id); go('instrument', id); }}>
              <b>{id}</b><span className="num">{price(i.price)}</span><span className={`num ${cls(ch)}`}>{pct(ch)}</span>
            </span>
          );
        })}
        {latest.map((n) => (
          <span key={n.id} className="item" onClick={() => go('news', n.id)}>
            <span className={`badge ${n.severity >= 4 ? 'neg' : n.severity >= 3 ? 'warn' : ''}`}>{n.severity >= 4 ? 'BREAKING' : 'NEWS'}</span>{n.headline}
          </span>
        ))}
      </div>
    </div>
  );
}

function Toasts() {
  useGame();
  const toasts = controller.toasts;
  useEffect(() => {
    const t = setInterval(() => controller.expireToasts(5000), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status" onClick={() => { controller.dismissToast(t.id); if (t.link) go(t.link.screen, t.link.id); }}>
          <div className="t">{t.title}</div>
          {t.text && <div className="x">{t.text}</div>}
        </div>
      ))}
    </div>
  );
}
