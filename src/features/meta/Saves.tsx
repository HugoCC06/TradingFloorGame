import { useCallback, useEffect, useRef, useState } from 'react';
import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { useGameMaybe } from '../../app/store';
import { fromJSON, toJSON } from '../../persistence/serialize';
import { migrate } from '../../persistence/migrations';
import { assertValid } from '../../persistence/validate';
import { cloudConfigured, currentUser } from '../../persistence/supabase';
import { MANUAL_SLOTS, type SaveMeta } from '../../persistence/types';
import { Badge, Confirm, FundLogo, Panel } from '../../ui/components';
import { money, since } from '../../ui/format';

export function SaveRow({ m, actions }: { m: SaveMeta; actions: React.ReactNode }) {
  return (
    <div className="list-row">
      {m.logo && <FundLogo logo={m.logo} name={m.fundName} size={30} />}
      <div className="grow">
        <div><b>{m.fundName}</b> <span className="small dim">{m.slot.startsWith('auto:') ? 'Autosave' : `Slot ${m.slot.replace('slot', '')}`}{m.label ? ` · ${m.label}` : ''}</span>{m.status !== 'active' && <Badge tone="neg">{m.status}</Badge>}</div>
        <div className="small muted">{m.difficulty} · {m.date} · day {m.daysPlayed} · NAV {money(m.nav, { compact: true })} · saved {since(m.savedAt)}</div>
      </div>
      <div className="row">{actions}</div>
    </div>
  );
}

export function SavesView({ onLoaded }: { onLoaded?: () => void }) {
  const state = useGameMaybe();
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [cloud, setCloud] = useState<SaveMeta[] | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; text: string; run: () => Promise<void> } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try { setSaves(await controller.local.list()); } catch (e) { setError((e as Error).message); }
    if (cloudConfigured && (await currentUser().catch(() => null))) {
      try { setCloud(await controller.cloud.list()); } catch (e) { setError((e as Error).message); }
    } else setCloud(null);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const load = async (slot: string, repo: 'local' | 'cloud' = 'local') => {
    setError('');
    try {
      await controller.loadSlot(slot, repo);
      onLoaded?.();
      go('terminal');
    } catch (e) { setError((e as Error).message); }
  };
  const saveTo = (slot: string) => {
    const existing = saves.find((s) => s.slot === slot);
    const run = async () => { await controller.save(slot, `Slot ${slot.replace('slot', '')}`); await refresh(); };
    if (existing) setConfirm({ title: 'Overwrite save?', text: `Slot ${slot.replace('slot', '')} contains "${existing.fundName}" (${existing.date}). Overwrite it?`, run });
    else void run();
  };
  const exportSave = () => {
    if (!controller.state) return;
    const blob = new Blob([toJSON(controller.state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trading-floor-${controller.state.setup.fundName.replace(/\W+/g, '-').toLowerCase()}-${controller.state.clock.date}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importSave = async (f: File) => {
    setError('');
    try {
      const raw = migrate(fromJSON(await f.text()) as Record<string, unknown>);
      assertValid(raw);
      const slot = MANUAL_SLOTS.find((s) => !saves.some((x) => x.slot === s)) ?? 'slot5';
      await controller.local.save(slot, raw, 'Imported');
      await refresh();
      controller.toast('success', 'Save imported', `Stored in slot ${slot.replace('slot', '')}.`);
    } catch (e) { setError(`Import failed: ${(e as Error).message}`); }
  };

  const autos = saves.filter((s) => s.slot.startsWith('auto:'));
  return (
    <div>
      <div className="page-h"><div><h1>Save & load</h1><div className="sub">Saves live in this browser's IndexedDB storage{cloudConfigured ? ', with optional cloud backup when signed in' : ''}.</div></div>
        <div className="row">
          {state && <button className="btn" onClick={exportSave}>Export current game</button>}
          <button className="btn" onClick={() => file.current?.click()}>Import save file</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSave(f); e.target.value = ''; }} />
        </div>
      </div>
      {error && <div className="banner danger" role="alert">{error}</div>}
      <div className="banner small">Guest saves are stored only in this browser. Clearing site data or using private browsing will erase them and they cannot be recovered. Export a save file{cloudConfigured ? ' or sign in for cloud saves' : ''} to keep a backup.</div>
      <div className="grid g2">
        <Panel title="Manual slots" flush>
          {MANUAL_SLOTS.map((slot) => {
            const m = saves.find((s) => s.slot === slot);
            return m ? (
              <SaveRow key={slot} m={m} actions={<>
                <button className="btn sm primary" onClick={() => void load(slot)}>Load</button>
                {state && <button className="btn sm" onClick={() => saveTo(slot)}>Overwrite</button>}
                <button className="btn sm danger" onClick={() => setConfirm({ title: 'Delete save?', text: `Delete "${m.fundName}" from slot ${slot.replace('slot', '')}? This cannot be undone.`, run: async () => { await controller.local.remove(slot); await refresh(); } })}>Delete</button>
              </>} />
            ) : (
              <div key={slot} className="list-row"><span className="grow dim">Slot {slot.replace('slot', '')} — empty</span>{state && <button className="btn sm" onClick={() => saveTo(slot)} data-testid={`save-${slot}`}>Save here</button>}</div>
            );
          })}
        </Panel>
        <Panel title="Autosaves" flush>
          {!autos.length && <div className="empty">No autosaves yet.</div>}
          {autos.map((m) => (
            <SaveRow key={m.slot} m={m} actions={<>
              <button className="btn sm primary" onClick={() => void load(m.slot)} data-testid="load-autosave">{m.gameId === state?.id ? 'Reload' : 'Load'}</button>
              <button className="btn sm danger" onClick={() => setConfirm({ title: 'Delete autosave?', text: `Delete the autosave for "${m.fundName}"?`, run: async () => { await controller.local.remove(m.slot); await refresh(); } })}>Delete</button>
            </>} />
          ))}
        </Panel>
      </div>
      {cloud && (
        <Panel title="Cloud saves" className="mt" flush>
          {!cloud.length && <div className="empty">No cloud saves yet. Manual saves are uploaded automatically while you are signed in.</div>}
          {cloud.map((m) => <SaveRow key={m.slot} m={m} actions={<button className="btn sm primary" onClick={() => void load(m.slot, 'cloud')}>Load from cloud</button>} />)}
        </Panel>
      )}
      {confirm && <Confirm title={confirm.title} text={confirm.text} danger onCancel={() => setConfirm(null)} onConfirm={async () => { const c = confirm; setConfirm(null); try { await c.run(); } catch (e) { setError((e as Error).message); } }} />}
    </div>
  );
}
