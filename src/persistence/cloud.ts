import type { GameState } from '../game/types';
import { metaFor } from './local';
import { migrate } from './migrations';
import { base64ToBytes, bytesToBase64, fromJSON, gunzipText, gzipText, snapshot, toJSON } from './serialize';
import { currentUser, getSupabase } from './supabase';
import { SaveError, type SaveMeta, type SaveRepository } from './types';
import { assertValid } from './validate';

const TABLE = 'cloud_saves';

/** Supabase-backed saves; same interface as LocalSaveRepository. */
export class CloudSaveRepository implements SaveRepository {
  readonly kind = 'cloud' as const;

  private async uid(): Promise<string> {
    const u = await currentUser();
    if (!u) throw new SaveError('Sign in to use cloud saves.', 'auth');
    return u.id;
  }

  async list(): Promise<SaveMeta[]> {
    const uid = await this.uid();
    const sb = await getSupabase();
    const { data, error } = await sb.from(TABLE).select('slot, meta, updated_at').eq('user_id', uid).order('updated_at', { ascending: false });
    if (error) throw new SaveError(error.message, 'network');
    return (data ?? []).map((r) => r.meta as SaveMeta);
  }

  async load(slot: string): Promise<GameState> {
    const uid = await this.uid();
    const sb = await getSupabase();
    const { data, error } = await sb.from(TABLE).select('data').eq('user_id', uid).eq('slot', slot).maybeSingle();
    if (error) throw new SaveError(error.message, 'network');
    if (!data) throw new SaveError('No cloud save in this slot.', 'not-found');
    try {
      const text = await gunzipText(base64ToBytes(data.data as string));
      const s = migrate(fromJSON(text) as Record<string, unknown>);
      assertValid(s);
      return s;
    } catch (e) {
      if (e instanceof SaveError) throw e;
      throw new SaveError('Cloud save is corrupted.', 'corrupt');
    }
  }

  async save(slot: string, state: GameState, label?: string): Promise<SaveMeta> {
    const uid = await this.uid();
    const snap = snapshot(state);
    assertValid(snap);
    const meta = metaFor(slot, snap, label);
    const payload = bytesToBase64(await gzipText(toJSON(snap)));
    const sb = await getSupabase();
    const { error } = await sb.from(TABLE).upsert({ user_id: uid, slot, meta, data: payload, updated_at: new Date().toISOString() }, { onConflict: 'user_id,slot' });
    if (error) throw new SaveError(error.message, 'network');
    return meta;
  }

  async remove(slot: string): Promise<void> {
    const uid = await this.uid();
    const sb = await getSupabase();
    const { error } = await sb.from(TABLE).delete().eq('user_id', uid).eq('slot', slot);
    if (error) throw new SaveError(error.message, 'network');
  }
}

/** Sync the achievements/career profile for a signed-in user (merge: union of achievements, newest career entries). */
export async function syncProfileToCloud(local: import('./profile').Profile): Promise<import('./profile').Profile> {
  const u = await currentUser();
  if (!u) return local;
  const sb = await getSupabase();
  const { data } = await sb.from('profiles').select('data').eq('user_id', u.id).maybeSingle();
  const remote = (data?.data ?? null) as import('./profile').Profile | null;
  const merged = { ...local, achievements: { ...(remote?.achievements ?? {}), ...local.achievements }, career: [...local.career] };
  for (const e of remote?.career ?? []) {
    const i = merged.career.findIndex((c) => c.gameId === e.gameId);
    if (i < 0) merged.career.push(e);
    else if (e.updatedAt > merged.career[i].updatedAt) merged.career[i] = e;
  }
  await sb.from('profiles').upsert({ user_id: u.id, data: merged, updated_at: new Date().toISOString() });
  return merged;
}
