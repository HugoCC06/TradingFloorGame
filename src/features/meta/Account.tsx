import { useEffect, useState } from 'react';
import { controller } from '../../app/controller';
import { cloudConfigured, currentUser, signIn, signOut, signUp } from '../../persistence/supabase';
import type { SaveMeta } from '../../persistence/types';
import { Modal } from '../../ui/components';

/** Login / sign-up and guest-to-account save transfer. Only rendered when Supabase is configured. */
export function AccountModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [user, setUser] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState<{ local: SaveMeta[]; conflicts: string[] } | null>(null);

  useEffect(() => { currentUser().then((u) => setUser(u?.email ?? null)).catch(() => {}); }, []);
  if (!cloudConfigured) return <Modal title="Accounts" onClose={onClose}><p className="muted">Accounts and cloud saves are not configured on this deployment. Your progress is saved locally in this browser.</p></Modal>;

  const submit = async () => {
    setBusy(true); setMsg('');
    try {
      const u = mode === 'in' ? await signIn(email, password) : await signUp(email, password);
      setUser(u?.email ?? null);
      if (mode === 'up' && !u?.email_confirmed_at) setMsg('Check your email to confirm your account, then sign in.');
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const prepareTransfer = async () => {
    setBusy(true);
    try {
      const local = (await controller.local.list()).filter((m) => !m.slot.startsWith('auto:'));
      const remote = await controller.cloud.list();
      setTransfer({ local, conflicts: local.filter((l) => remote.some((r) => r.slot === l.slot)).map((l) => l.slot) });
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const doTransfer = async () => {
    if (!transfer) return;
    setBusy(true);
    let n = 0;
    for (const m of transfer.local) {
      try { const s = await controller.local.load(m.slot); await controller.cloud.save(m.slot, s, m.label || 'Transferred'); n++; } catch (e) { setMsg((e as Error).message); }
    }
    if (controller.state) { try { await controller.cloud.save('slot-current', controller.state, 'Current game'); n++; } catch { /* ignore */ } }
    await controller.updateProfile();
    setTransfer(null);
    setMsg(`Transferred ${n} save(s) to your account.`);
    setBusy(false);
  };

  return (
    <Modal title={user ? 'Your account' : mode === 'in' ? 'Sign in' : 'Create account'} onClose={onClose}>
      {user ? (
        <div className="col">
          <div>Signed in as <b>{user}</b>. Manual saves are mirrored to the cloud and achievements sync across devices.</div>
          <button className="btn" onClick={prepareTransfer} disabled={busy}>Transfer guest saves to my account…</button>
          {transfer && (
            <div className="card">
              <div>{transfer.local.length} local save(s) will be uploaded{controller.state ? ', plus your current game' : ''}.</div>
              {transfer.conflicts.length > 0 && <div className="warn small mt">Warning: cloud slots {transfer.conflicts.join(', ')} already contain saves and will be overwritten.</div>}
              <div className="row mt"><button className="btn" onClick={() => setTransfer(null)}>Cancel</button><button className="btn primary" onClick={doTransfer} disabled={busy}>Confirm transfer</button></div>
            </div>
          )}
          <button className="btn ghost" onClick={async () => { await signOut(); setUser(null); }}>Sign out</button>
        </div>
      ) : (
        <form className="col" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <button className="btn primary" type="submit" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
          <button className="btn ghost" type="button" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? 'No account? Create one' : 'Have an account? Sign in'}</button>
          <p className="small dim">An account is optional. Guest play works without one.</p>
        </form>
      )}
      {msg && <div className="small mt" role="status">{msg}</div>}
    </Modal>
  );
}
