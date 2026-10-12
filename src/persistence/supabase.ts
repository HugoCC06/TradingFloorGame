/**
 * Optional Supabase integration (accounts + cloud saves). Enabled only when
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time. The
 * anon key is a public client key; row-level security restricts each user to
 * their own rows (see supabase/schema.sql). No secret keys live in the frontend.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';

const URL = (import.meta.env?.VITE_SUPABASE_URL as string | undefined) ?? '';
const KEY = (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const cloudConfigured = Boolean(URL && KEY);

let client: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!cloudConfigured) return Promise.reject(new Error('Cloud saves are not configured.'));
  if (!client) client = import('@supabase/supabase-js').then(({ createClient }) => createClient(URL, KEY, { auth: { persistSession: true } }));
  return client;
}

export async function currentUser(): Promise<User | null> {
  if (!cloudConfigured) return null;
  const sb = await getSupabase();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export async function signUp(email: string, password: string) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signIn(email: string, password: string) {
  const sb = await getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const sb = await getSupabase();
  await sb.auth.signOut();
}

export async function onAuthChange(cb: (u: User | null) => void): Promise<() => void> {
  if (!cloudConfigured) return () => {};
  const sb = await getSupabase();
  const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}
