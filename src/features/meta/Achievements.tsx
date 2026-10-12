import { useEffect, useState } from 'react';
import { controller } from '../../app/controller';
import { ACHIEVEMENTS } from '../../game/achievements';
import type { Profile } from '../../persistence/profile';
import { Badge, Empty, FundLogo, Panel } from '../../ui/components';
import { money, pct } from '../../ui/format';

export function useProfile(): Profile | null {
  const [p, setP] = useState<Profile | null>(null);
  useEffect(() => { controller.getProfile().then(setP).catch(() => setP(null)); }, []);
  return p;
}

export function AchievementsView() {
  const profile = useProfile();
  const run = controller.state?.achievements ?? [];
  return (
    <div>
      <div className="page-h"><div><h1>Achievements</h1><div className="sub">{Object.keys(profile?.achievements ?? {}).length} of {ACHIEVEMENTS.length} unlocked across all runs.</div></div></div>
      <div className="grid g3">
        {ACHIEVEMENTS.map((a) => {
          const got = profile?.achievements[a.id] || run.includes(a.id);
          return (
            <div key={a.id} className="card" style={{ opacity: got ? 1 : 0.55 }}>
              <div className="spread"><b>{a.name}</b>{got ? <Badge tone="pos">Unlocked</Badge> : <Badge>Locked</Badge>}</div>
              <div className="small muted" style={{ marginTop: 4 }}>{a.description}</div>
              {profile?.achievements[a.id] && <div className="small dim mt">{new Date(profile.achievements[a.id].unlockedAt).toLocaleDateString('en-US')} · {profile.achievements[a.id].fund}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CareerView() {
  const profile = useProfile();
  if (!profile) return <Empty>Loading…</Empty>;
  const runs = [...profile.career].sort((a, b) => b.updatedAt - a.updatedAt);
  const best = runs.reduce((a, r) => Math.max(a, r.totalReturn), -Infinity);
  const longest = runs.reduce((a, r) => Math.max(a, r.days), 0);
  const peak = runs.reduce((a, r) => Math.max(a, r.peakAum), 0);
  return (
    <div>
      <div className="page-h"><div><h1>Career history</h1><div className="sub">{runs.length} fund{runs.length === 1 ? '' : 's'} · best return {runs.length ? pct(best) : '—'} · longest run {longest} days · peak AUM {money(peak, { compact: true })}</div></div></div>
      <Panel flush>
        {!runs.length && <Empty>No runs yet. Start a fund to build your career.</Empty>}
        {runs.map((r) => (
          <div key={r.gameId} className="list-row">
            {r.logo && <FundLogo logo={r.logo} name={r.fundName} size={30} />}
            <div className="grow">
              <div><b>{r.fundName}</b> <span className="small dim">{r.difficulty} · {r.preset}</span> <Badge tone={r.status === 'active' ? 'accent' : r.status === 'failed' ? 'neg' : undefined}>{r.status}</Badge></div>
              <div className="small muted">{r.days} days · return {pct(r.totalReturn)} · max drawdown {pct(-r.maxDrawdown, 1)} · peak AUM {money(r.peakAum, { compact: true })}{r.bestInvestment ? ` · best ${r.bestInvestment.id} ${money(r.bestInvestment.pnl, { compact: true, sign: true })}` : ''}</div>
              {r.reason && <div className="small dim">{r.reason}</div>}
            </div>
            <span className="num">{money(r.finalNav, { compact: true })}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
