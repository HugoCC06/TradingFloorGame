import { useEffect, useState } from 'react';
import { controller } from '../../app/controller';
import { cloudConfigured, currentUser } from '../../persistence/supabase';
import type { SaveMeta } from '../../persistence/types';
import { FundLogo, Wordmark } from '../../ui/components';
import { money, since } from '../../ui/format';
import { AccountModal } from '../meta/Account';

export type MenuView = 'main' | 'saves' | 'achievements' | 'career' | 'settings' | 'help' | 'credits';

export function MainMenu({ onNew, onView, onContinue }: { onNew: () => void; onView: (v: MenuView) => void; onContinue: (slot: string) => Promise<void> }) {
  const [latest, setLatest] = useState<SaveMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [account, setAccount] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    controller.local.list().then((l) => { setLatest(l.find((m) => m.status === 'active') ?? null); setLoading(false); }).catch((e) => { setErr(`Local saves unavailable: ${(e as Error).message}`); setLoading(false); });
    if (cloudConfigured) currentUser().then((u) => setUser(u?.email ?? null)).catch(() => {});
  }, [account]);
  return (
    <div className="menu-screen">
      <div className="menu-left">
        <Wordmark size={22} />
        <div>
          <h1 style={{ fontSize: 34, letterSpacing: '-0.03em', lineHeight: 1.1 }}>Build a hedge fund<br />from nothing.</h1>
          <p className="muted" style={{ fontSize: 15, marginTop: 10, maxWidth: 440 }}>Trade 240+ fictional stocks, ETFs and commodities. React to news, win investors, hire a team, and outlast seven rival funds.</p>
        </div>
        {latest && (
          <button className="card row" style={{ maxWidth: 420, textAlign: 'left', cursor: 'pointer' }} onClick={() => void onContinue(latest.slot).catch((e) => setErr((e as Error).message))} data-testid="continue">
            {latest.logo && <FundLogo logo={latest.logo} name={latest.fundName} size={38} />}
            <div className="grow">
              <div className="tiny">Continue</div>
              <b>{latest.fundName}</b>
              <div className="small muted">{latest.difficulty} · day {latest.daysPlayed} · NAV {money(latest.nav, { compact: true })} · {since(latest.savedAt)}</div>
            </div>
            <span className="btn primary">▶</span>
          </button>
        )}
        <div className="menu-list">
          <button className={`btn ${latest ? '' : 'primary'}`} onClick={onNew} data-testid="new-game">New game <span className="k">Play as guest — no sign-up</span></button>
          <button className="btn" onClick={() => onView('saves')}>Load game <span className="k">Save slots</span></button>
          <button className="btn" onClick={() => onView('achievements')}>Achievements</button>
          <button className="btn" onClick={() => onView('career')}>Career history</button>
          <button className="btn" onClick={() => onView('settings')}>Settings</button>
          <button className="btn" onClick={() => onView('help')}>How to play</button>
          {cloudConfigured && <button className="btn" onClick={() => setAccount(true)}>{user ? `Account (${user})` : 'Log in / Create account'}</button>}
          <button className="btn ghost" onClick={() => onView('credits')}>Credits & about</button>
        </div>
        {loading && <div className="small dim">Checking for saved games…</div>}
        {err && <div className="small neg" role="alert">{err}</div>}
        <div className="small dim" style={{ maxWidth: 440 }}>Guest progress is saved in this browser only. Clearing browser data erases it{cloudConfigured ? ' — sign in to back up to the cloud' : ''}.</div>
      </div>
      <div className="menu-right" aria-hidden><MenuArt /></div>
      {account && <AccountModal onClose={() => setAccount(false)} />}
    </div>
  );
}

function MenuArt() {
  // static decorative candlestick motif
  const bars = Array.from({ length: 42 }, (_, i) => {
    const base = 300 - i * 4 + Math.sin(i * 0.7) * 40 + Math.cos(i * 1.9) * 18;
    const up = Math.sin(i * 2.3) > -0.3;
    return { x: 20 + i * 14, o: base + (up ? 10 : -10), c: base - (up ? 10 : -10), h: base - 26 - (i % 5) * 3, l: base + 24 + (i % 4) * 4, up };
  });
  return (
    <svg viewBox="0 0 620 560" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.55 }} preserveAspectRatio="xMidYMid slice">
      {[100, 200, 300, 400, 500].map((y) => <line key={y} x1="0" x2="620" y1={y} y2={y} stroke="var(--border)" />)}
      {bars.map((b) => (
        <g key={b.x}>
          <line x1={b.x} x2={b.x} y1={b.h} y2={b.l} stroke={b.up ? 'var(--pos)' : 'var(--neg)'} />
          <rect x={b.x - 4} width={8} y={Math.min(b.o, b.c)} height={Math.max(2, Math.abs(b.o - b.c))} fill={b.up ? 'var(--pos)' : 'var(--neg)'} rx={1} />
        </g>
      ))}
    </svg>
  );
}

export function Credits() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Credits & about</h1>
      <p className="muted mt">Trading Floor is a single-player hedge fund management game. Every company, ticker, person, institution, fund and price is fictional and procedurally generated from a seed; no real market data is used. Nothing in the game is investment advice.</p>
      <p className="muted">Built with React, TypeScript and Vite. Financial charts by TradingView Lightweight Charts™ (Apache 2.0). Sound is synthesised in the browser with the Web Audio API.</p>
      <p className="muted">Design, simulation and code: the Trading Floor team.</p>
    </div>
  );
}
