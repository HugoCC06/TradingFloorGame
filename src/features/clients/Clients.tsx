import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { useGame } from '../../app/store';
import { BALANCE } from '../../config/balance';
import { summarize } from '../../game/accounting';
import { assessPitch, callClient, canCall, clientTypeLabel, clientValueCents, declineProspect, dinnerClient, feeConcession, mandateText, pitchProspect, sendLetter } from '../../game/clients';
import type { Client, GameState } from '../../game/types';
import { Badge, Bar, DataTable, Empty, Panel, Stat } from '../../ui/components';
import { cls, money, pct } from '../../ui/format';

function confTone(c: number) {
  return c >= 65 ? 'pos' : c >= 40 ? 'warn' : 'neg';
}

export function Clients({ id }: { id?: string }) {
  const state = useGame();
  const s = summarize(state);
  const navpu = s.navPerUnit;
  const active = state.clients.filter((c) => c.status !== 'departed');
  const ext = active.filter((c) => c.type !== 'founder');
  const last21 = state.daily.slice(-21);
  const inflow = last21.reduce((a, d) => a + d.subscriptions, 0);
  const outflow = last21.reduce((a, d) => a + d.redemptions, 0);
  const largest = Math.max(0, ...active.map((c) => clientValueCents(c, navpu)));
  const avgConf = ext.length ? ext.reduce((a, c) => a + c.confidence, 0) / ext.length : 0;
  const atRisk = ext.filter((c) => c.confidence < 40);
  const sel = state.clients.find((c) => c.id === id) ?? null;
  const letterReady = state.clock.day - state.lastLetterDay >= BALANCE.clients.letterCooldownDays;
  const pending = state.flows.filter((f) => f.status === 'pending');
  return (
    <div>
      <div className="page-h">
        <div><h1>Clients</h1><div className="sub">Investors buy and redeem fund units at NAV. Their confidence depends on returns, drawdowns, risk discipline and your relationship.</div></div>
        <button className="btn" disabled={!letterReady} onClick={() => { const r = controller.act((st) => sendLetter(st)); if (r?.ok) controller.toast('success', 'Investor letter sent', `Confidence +${r.gain} across all clients`); }}>
          {letterReady ? 'Send investor letter' : `Letter available in ${BALANCE.clients.letterCooldownDays - (state.clock.day - state.lastLetterDay)}d`}
        </button>
      </div>
      <div className="stats mb">
        <Stat label="Clients" value={ext.length} sub={<span className="muted">+ founder capital</span>} />
        <Stat label="Total AUM" value={money(s.nav, { compact: true })} />
        <Stat label="Inflows (21d)" value={money(inflow, { compact: true })} valueClass="pos" />
        <Stat label="Outflows (21d)" value={money(outflow, { compact: true })} valueClass={outflow ? 'neg' : ''} />
        <Stat label="Largest client" value={pct(largest / Math.max(s.nav, 1), 0, false)} sub={<span className="muted">of AUM</span>} />
        <Stat label="Avg confidence" value={Math.round(avgConf)} valueClass={confTone(avgConf)} />
        <Stat label="At risk" value={atRisk.length} valueClass={atRisk.length ? 'neg' : ''} />
        <Stat label="Reputation" value={Math.round(state.reputation)} sub={<Bar value={state.reputation} max={100} />} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: sel ? 'minmax(0, 1.4fr) minmax(300px, 1fr)' : '1fr' }}>
        <Panel title="Investor register" flush>
          <DataTable rows={state.clients} rowKey={(c) => c.id} onRowClick={(c) => go('clients', c.id)} selected={sel?.id} initialSort="val"
            columns={[
              { key: 'n', label: 'Client', sort: (c) => c.name, render: (c) => <span><b>{c.name}</b><div className="small dim">{clientTypeLabel(c.type)}</div></span> },
              { key: 'val', label: 'Value', num: true, sort: (c) => clientValueCents(c, navpu), render: (c) => money(clientValueCents(c, navpu), { compact: true }) },
              { key: 'sh', label: 'Share', num: true, sort: (c) => c.units, render: (c) => pct(c.units / Math.max(state.fund.unitsOutstanding, 1e-9), 1, false) },
              { key: 'ret', label: 'Gain', num: true, sort: (c) => clientValueCents(c, navpu) - c.netContributed, render: (c) => { const g = clientValueCents(c, navpu) - c.netContributed; return c.status === 'departed' ? '' : <span className={cls(g)}>{money(g, { compact: true, sign: true })}</span>; } },
              { key: 'fee', label: 'Fees', render: (c) => (c.type === 'founder' ? <span className="dim">none</span> : `${(c.mgmtFee * 100).toFixed(2)} / ${(c.perfFee * 100).toFixed(0)}`) },
              { key: 'conf', label: 'Confidence', sort: (c) => c.confidence, render: (c) => (c.type === 'founder' ? '' : <div style={{ width: 90 }}><div className={`small num ${confTone(c.confidence)}`}>{Math.round(c.confidence)}</div><Bar value={c.confidence} max={100} tone={confTone(c.confidence)} /></div>) },
              { key: 'st', label: 'Status', sort: (c) => c.status, render: (c) => <Badge tone={c.status === 'active' ? undefined : c.status === 'redeeming' ? 'warn' : 'neg'}>{c.status}</Badge> },
            ]} />
        </Panel>
        {sel && <ClientDetail state={state} c={sel} navpu={navpu} />}
      </div>
      <div className="grid g2 mt">
        <Prospects state={state} />
        <Panel title={`Pending capital flows (${pending.length})`} flush>
          {!pending.length && <Empty>No pending subscriptions or redemptions.</Empty>}
          {pending.map((f) => {
            const c = state.clients.find((x) => x.id === f.clientId);
            const val = f.kind === 'subscription' ? f.amount : Math.round(f.amount * navpu * 100);
            return (
              <div key={f.id} className="list-row small">
                <Badge tone={f.kind === 'subscription' ? 'pos' : 'neg'}>{f.kind === 'subscription' ? 'IN' : 'OUT'}</Badge>
                <span className="grow">{c?.name}</span>
                <span className="num">{money(val, { compact: true })}</span>
                <span className="dim">{f.effectiveDay - state.clock.day <= 0 ? 'at today\'s close' : `in ${f.effectiveDay - state.clock.day}d`}</span>
              </div>
            );
          })}
          {pending.some((f) => f.kind === 'redemption') && <div className="small dim" style={{ padding: 10 }}>Redemptions are paid from free cash at the close; if cash is short, holdings are sold pro rata at market prices.</div>}
        </Panel>
      </div>
    </div>
  );
}

function ClientDetail({ state, c, navpu }: { state: GameState; c: Client; navpu: number }) {
  const val = clientValueCents(c, navpu);
  const dinnerReady = state.clock.day - c.lastDinnerDay >= BALANCE.clients.dinnerCooldownDays;
  const concessionReady = state.clock.day - c.lastConcessionDay >= 60;
  const act = (fn: (s: GameState) => { ok: boolean; error?: string; gain?: number }, label: string) => {
    const r = controller.act(fn);
    if (r) controller.toast(r.ok ? 'success' : 'danger', r.ok ? label : 'Not possible', r.ok ? (r.gain ? `Confidence +${r.gain}` : '') : r.error);
  };
  return (
    <Panel title={c.name} actions={<button className="btn ghost sm" onClick={() => go('clients')}>✕</button>}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row wrap"><Badge>{clientTypeLabel(c.type)}</Badge><Badge tone={c.status === 'active' ? 'pos' : c.status === 'redeeming' ? 'warn' : 'neg'}>{c.status}</Badge></div>
        <div className="kv">
          <span>Account value</span><span>{money(val)}</span>
          <span>Net contributed</span><span>{money(c.netContributed)}</span>
          <span>Units</span><span>{c.units.toFixed(2)}</span>
          {c.type !== 'founder' && <>
            <span>Confidence</span><span className={confTone(c.confidence)}>{Math.round(c.confidence)}/100</span>
            <span>Relationship</span><span>{Math.round(c.relationship)}/100</span>
            <span>Return expectation</span><span>{pct(c.expectedReturn, 1, false)}/yr</span>
            <span>Drawdown tolerance</span><span>{pct(c.drawdownTolerance, 0, false)}</span>
            <span>Risk tolerance</span><span>{c.riskTolerance > 0.6 ? 'High' : c.riskTolerance > 0.4 ? 'Moderate' : 'Low'}</span>
            <span>Withdrawal sensitivity</span><span>{c.withdrawalSensitivity > 1.2 ? 'High' : c.withdrawalSensitivity > 0.9 ? 'Moderate' : 'Low'}</span>
            <span>Horizon / notice</span><span>{Math.round(c.horizonDays / 252 * 10) / 10}y / {c.noticeDays}d</span>
            <span>Fees</span><span>{(c.mgmtFee * 100).toFixed(2)}% + {(c.perfFee * 100).toFixed(1)}%</span>
            <span>High-water mark</span><span>{c.hwm.toFixed(3)}</span>
          </>}
        </div>
        {mandateText(c.mandate).length > 0 && <div><div className="tiny">Mandate restrictions</div><ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{mandateText(c.mandate).map((m) => <li key={m}>{m}</li>)}</ul></div>}
        {c.type !== 'founder' && (
          <div>
            <div className="tiny">Current concerns</div>
            {c.concerns.length ? <ul className="small neg" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{c.concerns.map((x) => <li key={x}>{x}</li>)}</ul> : <div className="small pos">No concerns — satisfied with the relationship.</div>}
          </div>
        )}
        {c.type !== 'founder' && c.status !== 'departed' && (
          <div className="row wrap">
            <button className="btn sm" disabled={!canCall(state, c)} onClick={() => act((s) => callClient(s, c.id), 'Call went well')} title="Free. Cooldown 10 days.">Call client</button>
            <button className="btn sm" disabled={!dinnerReady} onClick={() => act((s) => dinnerClient(s, c.id), 'Dinner hosted')} title={`Costs ${money(BALANCE.clients.dinnerCost * 100)} of company cash`}>Host dinner ({money(BALANCE.clients.dinnerCost * 100, { compact: true })})</button>
            <button className="btn sm" disabled={!concessionReady} onClick={() => act((s) => feeConcession(s, c.id), 'Fee concession granted')} title="Permanently lowers this client's fees">Offer fee cut</button>
          </div>
        )}
        <div>
          <div className="tiny mb">History</div>
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            {[...c.history].reverse().map((h, i) => <div key={i} className="small" style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}><span className="dim">{h.date}</span> {h.text}</div>)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Prospects({ state }: { state: GameState }) {
  const open = state.prospects.filter((p) => p.status === 'open' || p.status === 'pitched');
  const recent = state.prospects.filter((p) => (p.status === 'won' || p.status === 'lost') && p.createdDay > state.clock.day - 30).slice(-4);
  return (
    <Panel title={`Investor prospects (${open.length})`} flush>
      {!open.length && <Empty>No prospects right now. Reputation, performance, IR staff, office and marketing all bring more.</Empty>}
      {open.map((p) => {
        const a = assessPitch(state, p);
        const prob = a.probability;
        return (
          <div key={p.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div className="spread"><b>{p.name}</b><span className="num">{money(p.amount, { compact: true })}</span></div>
              <div className="small dim">{clientTypeLabel(p.type)} · {p.note} · seeks {pct(p.expectedReturn, 0, false)}/yr · {p.status === 'pitched' ? `decision in ${(p.resolveDay ?? 0) - state.clock.day}d` : `expires in ${p.expiresDay - state.clock.day}d`}</div>
              {mandateText(p.mandate).length > 0 && <div className="small muted">Terms: {mandateText(p.mandate).join(' · ')}</div>}
              {a.blockers.map((b) => <div key={b} className="small neg">✕ {b}</div>)}
              <details className="small"><summary className="dim" style={{ cursor: 'pointer' }}>Win chance: <b className={prob > 0.55 ? 'pos' : prob > 0.3 ? 'warn' : 'neg'}>{prob > 0.55 ? 'High' : prob > 0.3 ? 'Medium' : 'Low'} ({Math.round(prob * 100)}%)</b></summary>
                {a.factors.map((f) => <div key={f.label} className="spread"><span>{f.label}</span><span className={cls(f.effect)}>{f.effect >= 0 ? '+' : ''}{Math.round(f.effect * 100)}</span></div>)}
              </details>
            </div>
            {p.status === 'open' && (
              <div className="col" style={{ gap: 4 }}>
                <button className="btn sm primary" onClick={() => { const r = controller.act((s) => pitchProspect(s, p.id)); if (r && !r.ok) controller.toast('danger', 'Cannot pitch', r.error); }}>Pitch ({money(a.cost, { compact: true })})</button>
                <button className="btn sm ghost" onClick={() => controller.act((s) => declineProspect(s, p.id))}>Decline</button>
              </div>
            )}
            {p.status === 'pitched' && <Badge tone="accent">Pitched</Badge>}
          </div>
        );
      })}
      {recent.map((p) => <div key={p.id} className="list-row small"><Badge tone={p.status === 'won' ? 'pos' : 'neg'}>{p.status}</Badge><span className="grow">{p.name}</span><span className="num">{money(p.amount, { compact: true })}</span></div>)}
    </Panel>
  );
}
