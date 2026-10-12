import { useSyncExternalStore } from 'react';

/** UI-only: currently selected instrument (shared by terminal panels). */
let selected = (typeof localStorage !== 'undefined' && localStorage.getItem('tf.selected')) || 'TFX';
const ls = new Set<() => void>();
export function selectInstrument(id: string) {
  selected = id;
  try { localStorage.setItem('tf.selected', id); } catch { /* ignore */ }
  ls.forEach((l) => l());
}
export function useSelected(): string {
  return useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => selected);
}

/** Request to prefill the order ticket (e.g. from a "Sell" button on a position). */
export interface TicketPrefill { instrument: string; side: 'buy' | 'sell' | 'short' | 'cover'; quantity?: number; nonce: number }
let prefill: TicketPrefill | null = null;
const ps = new Set<() => void>();
export function prefillTicket(p: Omit<TicketPrefill, 'nonce'>) {
  prefill = { ...p, nonce: Date.now() };
  selectInstrument(p.instrument);
  ps.forEach((l) => l());
}
export function useTicketPrefill(): TicketPrefill | null {
  return useSyncExternalStore((l) => { ps.add(l); return () => ps.delete(l); }, () => prefill);
}
