import { useState } from 'react';
import { controller } from '../../app/controller';
import { useGame } from '../../app/store';
import { OFFICES } from '../../config/balance';
import { SECTORS, SECTOR_BY_ID, type SectorId } from '../../config/sectors';
import { analystCoverage, dismiss, executionDiscount, headcountCapacity, hire, irPower, levelName, payrollPerYear, promote, promotionCost, riskOversight, ROLE_INFO, severanceFor } from '../../game/staff';
import type { Employee, StaffRole } from '../../game/types';
import { Badge, Bar, Confirm, DataTable, Panel, Stat } from '../../ui/components';
import { money, pct } from '../../ui/format';

const specLabel = (s: string) => SECTOR_BY_ID[s as SectorId]?.name ?? s;

export function Team() {
  const state = useGame();
  const [confirm, setConfirm] = useState<{ kind: 'hire' | 'fire' | 'promote'; id: string } | null>(null);
  const cap = headcountCapacity(state);
  const res = (r: { ok: boolean; error?: string } | undefined, ok: string) => r && controller.toast(r.ok ? 'success' : 'danger', r.ok ? ok : 'Not possible', r.error ?? '');
  const covered = SECTORS.map((s) => ({ s, c: analystCoverage(state, s.id) }));
  const target = confirm ? (confirm.kind === 'hire' ? state.candidates.find((c) => c.id === confirm.id) : state.staff.find((e) => e.id === confirm.id)) : null;
  return (
    <div>
      <div className="page-h"><div><h1>Team</h1><div className="sub">Staff are paid by the management company. Each role has a concrete effect on the game.</div></div></div>
      <div className="stats mb">
        <Stat label="Headcount" value={`${state.staff.length} / ${cap}`} sub={<span className="muted">{OFFICES[state.company.officeTier].name}</span>} />
        <Stat label="Payroll" value={money(payrollPerYear(state), { compact: true })} sub={<span className="muted">per year</span>} />
        <Stat label="Execution savings" value={pct(executionDiscount(state), 0, false)} sub={<span className="muted">spread & impact (PMs)</span>} />
        <Stat label="IR strength" value={irPower(state).toFixed(2)} sub={<span className="muted">prospects & retention</span>} />
        <Stat label="Risk oversight" value={riskOversight(state).toFixed(2)} sub={<span className="muted">client confidence boost</span>} />
        <Stat label="Sectors covered" value={`${covered.filter((x) => x.c >= 30).length} / ${SECTORS.length}`} sub={<span className="muted">analyst quality ≥ 30</span>} />
      </div>
      <div className="grid g3 mb">
        {(['analyst', 'pm', 'ir'] as StaffRole[]).map((r) => (
          <div key={r} className="card"><b>{ROLE_INFO[r].plural}</b><p className="small muted" style={{ marginTop: 4 }}>{ROLE_INFO[r].benefit}</p></div>
        ))}
      </div>
      <Panel title="Your staff" flush>
        <DataTable rows={state.staff} rowKey={(e) => e.id} empty="No employees yet — you are running the fund alone." columns={staffCols(state.clock.day, (id) => setConfirm({ kind: 'promote', id }), (id) => setConfirm({ kind: 'fire', id }))} />
      </Panel>
      <Panel title="Candidates" className="mt" flush actions={<span className="small dim">New candidates every 5 days · better office & reputation attract stronger hires</span>}>
        <DataTable rows={state.candidates} rowKey={(c) => c.id} empty="No candidates available right now."
          columns={[
            { key: 'n', label: 'Name', render: (c) => <span><b>{c.name}</b><div className="small dim">{c.experience} yrs experience</div></span> },
            { key: 'r', label: 'Role', render: (c) => ROLE_INFO[c.role].name },
            { key: 's', label: 'Skill', num: true, sort: (c) => c.skill, render: (c) => <div style={{ width: 80 }}><span className="num small">{Math.round(c.skill)}</span><Bar value={c.skill} max={100} /></div> },
            { key: 'sp', label: 'Specialisation', render: (c) => c.specialisations.map(specLabel).join(', ') },
            { key: 'sal', label: 'Salary', num: true, sort: (c) => c.salary, render: (c) => money(c.salary, { compact: true }) },
            { key: 'cost', label: 'Hiring cost', num: true, render: (c) => money(c.hiringCost, { compact: true }) },
            { key: 'x', label: '', render: (c) => <span className="row"><span className="small dim">{c.expiresDay - state.clock.day}d</span><button className="btn sm primary" disabled={state.staff.length >= cap} onClick={() => setConfirm({ kind: 'hire', id: c.id })}>Hire</button></span> },
          ]} />
      </Panel>
      <Panel title="Analyst coverage by sector" className="mt">
        <div className="grid g3">{covered.map(({ s, c }) => (
          <div key={s.id}><div className="spread small"><span>{s.name}</span><span className="num">{Math.round(c)}</span></div><Bar value={c} max={100} tone={c >= 60 ? 'pos' : c >= 30 ? 'warn' : 'neg'} /></div>))}</div>
      </Panel>
      {confirm && target && (
        <Confirm
          title={confirm.kind === 'hire' ? `Hire ${target.name}?` : confirm.kind === 'fire' ? `Dismiss ${target.name}?` : `Promote ${target.name}?`}
          text={confirm.kind === 'hire' ? `One-off hiring cost ${money((target as { hiringCost: number }).hiringCost)} plus ${money(target.salary)}/yr salary, paid by the management company.`
            : confirm.kind === 'fire' ? `Severance of ${money(severanceFor(target as Employee))} is payable immediately. You lose their benefits.`
              : `Salary rises by ${money(promotionCost(target as Employee))}/yr; skill +3 and higher potential.`}
          danger={confirm.kind === 'fire'}
          confirmLabel={confirm.kind === 'hire' ? 'Hire' : confirm.kind === 'fire' ? 'Dismiss' : 'Promote'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const k = confirm;
            setConfirm(null);
            if (k.kind === 'hire') res(controller.act((s) => hire(s, k.id)), 'Hired');
            else if (k.kind === 'fire') res(controller.act((s) => dismiss(s, k.id)), 'Employee dismissed');
            else res(controller.act((s) => promote(s, k.id)), 'Promoted');
          }} />
      )}
    </div>
  );
}

function staffCols(day: number, onPromote: (id: string) => void, onFire: (id: string) => void) {
  return [
    { key: 'n', label: 'Name', render: (e: Employee) => <span><b>{e.name}</b><div className="small dim">{levelName(e.level)} · {Math.round(e.experience)} yrs</div></span> },
    { key: 'r', label: 'Role', render: (e: Employee) => <Badge tone="accent">{ROLE_INFO[e.role].name}</Badge> },
    { key: 's', label: 'Skill', num: true, sort: (e: Employee) => e.skill, render: (e: Employee) => <div style={{ width: 90 }}><span className="num small">{Math.round(e.skill)} <span className="dim">/ {Math.round(e.potential)}</span></span><Bar value={e.skill} max={100} /></div> },
    { key: 'sp', label: 'Specialisation', render: (e: Employee) => e.specialisations.map(specLabel).join(', ') },
    { key: 'sal', label: 'Salary', num: true, sort: (e: Employee) => e.salary, render: (e: Employee) => money(e.salary, { compact: true }) },
    { key: 't', label: 'Tenure', num: true, render: (e: Employee) => `${day - e.hiredDay}d` },
    { key: 'x', label: '', render: (e: Employee) => <span className="row"><button className="btn sm" onClick={() => onPromote(e.id)} disabled={e.level >= 4}>Promote</button><button className="btn sm danger" onClick={() => onFire(e.id)}>Dismiss</button></span> },
  ];
}
