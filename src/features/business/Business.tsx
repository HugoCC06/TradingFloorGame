import { useState } from 'react';
import { controller } from '../../app/controller';
import { useGame, useVersion } from '../../app/store';
import { AUTOMATIONS, OFFICES, type AutomationId } from '../../config/balance';
import { DIFFICULTIES } from '../../config/difficulty';
import { annualExpenses, automationOn, downgradeOffice, drawCredit, feeRunRate, repayCredit, runwayDays, setAutomation, upgradeOffice } from '../../game/company';
import { dayTimestamp } from '../../game/calendar';
import { resolveDecision } from '../../game/decisions';
import { hasRole } from '../../game/staff';
import { Badge, Confirm, Panel, Stat } from '../../ui/components';
import { PerfChart } from '../../ui/charts';
import { cls, money } from '../../ui/format';

export function Business() {
  const state = useGame();
  const version = useVersion();
  const c = state.company;
  const [credit, setCredit] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmOffice, setConfirmOffice] = useState<'up' | 'down' | null>(null);
  const exp = annualExpenses(state);
  const rev = feeRunRate(state);
  const runway = runwayDays(state);
  const net = rev - exp.total;
  const t = c.totals;
  const res = (r: { ok: boolean; error?: string } | undefined, ok: string) => r && controller.toast(r.ok ? 'success' : 'danger', r.ok ? ok : 'Not possible', r.error ?? '');
  const next = OFFICES[c.officeTier + 1];
  const cashSeries = [{ name: 'Company cash', color: '#2ebd85', points: state.daily.map((d) => ({ time: dayTimestamp(d.date), value: d.companyCash / 100 })) }];
  return (
    <div>
      <div className="page-h"><div><h1>Business</h1><div className="sub">The management company: earns fees from the fund, pays salaries, rent and running costs. A great fund can still fail if the company runs out of cash.</div></div></div>

      {state.decisions.length > 0 && (
        <Panel title="Decisions required" className="mb">
          {state.decisions.map((d) => (
            <div key={d.id} className="list-row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <b>{d.title}</b> <span className="small dim">· expires in {d.expiresDay - state.clock.day + 1} day(s)</span>
                <p className="small muted" style={{ marginTop: 4 }}>{d.text}</p>
                <div className="row wrap">
                  {d.options.map((o) => <button key={o.id} className="btn sm" onClick={() => controller.act((s) => resolveDecision(s, d.id, o.id))} title={o.detail}>{o.label}</button>)}
                </div>
                <div className="small dim mt">{d.options.map((o) => `${o.label}: ${o.detail}`).join(' — ')}</div>
              </div>
            </div>
          ))}
        </Panel>
      )}

      <div className="stats mb">
        <Stat label="Company cash" value={money(c.cash)} large valueClass={c.cash < 0 ? 'neg' : ''} />
        <Stat label="Fee run-rate" value={money(rev, { compact: true })} sub={<span className="muted">management fees / yr</span>} />
        <Stat label="Operating costs" value={money(exp.total, { compact: true })} sub={<span className="muted">per year</span>} />
        <Stat label="Net (excl. perf fees)" value={money(net, { compact: true, sign: true })} valueClass={cls(net)} sub={<span className="muted">per year</span>} />
        <Stat label="Runway" value={runway === Infinity ? 'Self-funding' : `${Math.floor(runway)} days`} valueClass={runway < 60 ? 'neg' : runway < 150 ? 'warn' : 'pos'} />
        <Stat label="Lifetime revenue" value={money(t.revenue, { compact: true })} sub={<span className="muted">mgmt {money(t.mgmtFees, { compact: true })} · perf {money(t.perfFees, { compact: true })}</span>} />
        <Stat label="Lifetime expenses" value={money(t.expenses, { compact: true })} />
        <Stat label="Credit line" value={`${money(c.creditDrawn, { compact: true })} / ${money(c.creditLimit, { compact: true })}`} sub={<span className="muted">{(12).toFixed(0)}% interest</span>} />
      </div>

      <div className="grid g2">
        <Panel title="Annual cost breakdown">
          <div className="kv">
            <span>Salaries ({state.staff.length} staff)</span><span>{money(exp.salaries)}</span>
            <span>Rent — {OFFICES[c.officeTier].name}</span><span>{money(exp.rent)}</span>
            <span>Technology & overheads</span><span>{money(exp.tech)}</span>
            <span>Marketing</span><span>{money(exp.marketing)}</span>
            <span>Automation</span><span>{money(exp.automation)}</span>
            <span>Credit interest</span><span>{money(exp.interest)}</span>
            <span><b>Total</b></span><span><b>{money(exp.total)}</b></span>
          </div>
          <div className="mt">
            <div className="field">
              <label htmlFor="mkt">Marketing & business development budget: {money(c.marketingPerYear)}/yr</label>
              <input id="mkt" type="range" min={0} max={50000000} step={2500000} value={c.marketingPerYear} onChange={(e) => controller.act((s) => { s.company.marketingPerYear = Number(e.target.value); })} />
              <span className="small dim">More marketing raises the rate of new investor prospects.</span>
            </div>
          </div>
          <div className="small dim mt">Fees: management fees accrue daily per client ({'≈'}2%/yr) by cancelling fund units; performance fees (≈20% above each client's high-water mark) crystallise every 21 trading days. Difficulty cost multiplier ×{DIFFICULTIES[state.setup.difficulty].expenseMult}.</div>
        </Panel>
        <Panel title="Company cash history">
          {state.daily.length > 1 ? <PerfChart version={version} height={200} area series={cashSeries} /> : <div className="empty">History appears after a few days.</div>}
          <div className="row mt">
            <input className="input" style={{ width: 140 }} inputMode="numeric" placeholder="Amount $" value={credit} onChange={(e) => setCredit(e.target.value.replace(/[^0-9]/g, ''))} aria-label="Credit amount" />
            <button className="btn sm" onClick={() => { res(controller.act((s) => drawCredit(s, Number(credit) * 100)), 'Credit drawn'); setCredit(''); }}>Draw credit</button>
            <button className="btn sm" onClick={() => { res(controller.act((s) => repayCredit(s, Number(credit || c.creditDrawn / 100) * 100)), 'Credit repaid'); setCredit(''); }}>Repay</button>
          </div>
        </Panel>
      </div>

      <div className="grid g2 mt">
        <Panel title="Office & prestige">
          <div className="col">
            {OFFICES.map((o) => (
              <div key={o.tier} className="spread small" style={{ opacity: o.tier === c.officeTier ? 1 : 0.65 }}>
                <span>{o.tier === c.officeTier ? <Badge tone="accent">Current</Badge> : null} <b>{o.name}</b> <span className="dim">· {o.capacity} staff · investor appeal +{Math.round(o.appeal * 100)}%</span></span>
                <span className="num">{money(o.rentPerYear * 100, { compact: true })}/yr</span>
              </div>
            ))}
          </div>
          <div className="row mt">
            <button className="btn primary sm" disabled={!next} onClick={() => setConfirmOffice('up')}>{next ? `Upgrade (fit-out ${money(next.fitOut * 100 * DIFFICULTIES[state.setup.difficulty].expenseMult, { compact: true })})` : 'Top tier'}</button>
            <button className="btn sm" disabled={c.officeTier === 0} onClick={() => setConfirmOffice('down')}>Downsize</button>
          </div>
          <p className="small dim mt">Better offices improve investor appeal, recruitment quality, capacity and reputation — at a much higher rent.</p>
        </Panel>
        <Panel title="Automation">
          {(Object.keys(AUTOMATIONS) as AutomationId[]).map((id) => {
            const a = AUTOMATIONS[id];
            const installed = !!c.automations[id];
            const on = automationOn(state, id);
            return (
              <div key={id} className="list-row" style={{ alignItems: 'flex-start', padding: '8px 0' }}>
                <div className="grow">
                  <b>{a.name}</b> {on ? <Badge tone="pos">ON</Badge> : installed ? <Badge>off</Badge> : null} {a.requiresPm && !hasRole(state, 'pm') && <Badge tone="warn">needs a PM</Badge>}
                  <div className="small muted">{a.description}</div>
                  <div className="small dim">{installed ? '' : `Setup ${money(a.setup * 100, { compact: true })} · `}{money(a.perYear * 100, { compact: true })}/yr while enabled</div>
                  {id === 'stopProtection' && <label className="small row mt">Stop distance <input className="input" type="number" min={2} max={30} style={{ width: 60, height: 24 }} value={Math.round(c.stopProtectionPct * 100)} onChange={(e) => controller.act((s) => { s.company.stopProtectionPct = Math.min(0.3, Math.max(0.02, Number(e.target.value) / 100)); })} />%</label>}
                  {id === 'autoRebalance' && <label className="small row mt">Drift band <input className="input" type="number" min={0} max={10} step={0.5} style={{ width: 60, height: 24 }} value={c.rebalanceBand * 100} onChange={(e) => controller.act((s) => { s.company.rebalanceBand = Math.min(0.1, Math.max(0, Number(e.target.value) / 100)); })} />% of NAV</label>}
                </div>
                <button className={`btn sm ${on ? '' : 'primary'}`} onClick={() => res(controller.act((s) => setAutomation(s, id, !c.automations[id]?.enabled)), on ? 'Disabled' : 'Enabled')}>{c.automations[id]?.enabled ? 'Disable' : installed ? 'Enable' : 'Install'}</button>
              </div>
            );
          })}
        </Panel>
      </div>

      <Panel title="Company ledger" className="mt" flush>
        <div style={{ maxHeight: 280, overflow: 'auto' }}>
          <table className="tbl"><thead><tr><th>Date</th><th>Item</th><th className="num">Amount</th></tr></thead>
            <tbody>{[...c.ledger].reverse().slice(0, 150).map((l, i) => <tr key={i}><td className="dim">{l.date}</td><td>{l.memo}</td><td className={`num ${cls(l.amount)}`}>{money(l.amount, { sign: true })}</td></tr>)}</tbody></table>
          {!c.ledger.length && <div className="empty">No transactions yet.</div>}
        </div>
      </Panel>

      <div className="card mt spread" style={{ borderColor: 'var(--neg-soft)' }}>
        <div><b>Close the fund</b><div className="small muted">Return capital to investors and end this run. It will be recorded in your career history.</div></div>
        <button className="btn danger" onClick={() => setConfirmClose(true)}>Close fund…</button>
      </div>
      {confirmClose && <Confirm title="Close the fund permanently?" text="This ends the current run. Your final statistics will be saved to career history." danger confirmLabel="Close fund" onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); controller.closeFund(); }} />}
      {confirmOffice && <Confirm title={confirmOffice === 'up' ? `Move to ${next?.name}?` : 'Downsize the office?'} text={confirmOffice === 'up' ? `One-off fit-out cost and rent of ${money((next?.rentPerYear ?? 0) * 100)}/yr.` : 'Lower rent, but reputation and capacity fall.'} onCancel={() => setConfirmOffice(null)}
        onConfirm={() => { const k = confirmOffice; setConfirmOffice(null); res(controller.act((s) => (k === 'up' ? upgradeOffice(s) : downgradeOffice(s))), k === 'up' ? 'Office upgraded' : 'Office downsized'); }} />}
    </div>
  );
}
