/**
 * JSON (de)serialisation for export/import and cloud saves. Typed arrays are
 * tagged so they round-trip exactly; IndexedDB stores them natively.
 */
import type { GameState } from '../game/types';
import { createSeries, type SeriesData } from '../game/series';

const TAG = '__ta';
type Tagged = { [TAG]: string; d?: number[]; b64?: string };

/** Typed arrays are stored as base64 of their raw bytes (≈3× smaller than number lists). */
export function toJSON(state: unknown): string {
  return JSON.stringify(state, (_k, v) => {
    if (isSeries(v) && v.len < v.cap) return compactSeries(v);
    if (v instanceof Float64Array || v instanceof Float32Array) {
      return { [TAG]: v instanceof Float64Array ? 'f64' : 'f32', b64: bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) } satisfies Tagged;
    }
    return v;
  });
}

export function fromJSON(text: string): unknown {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && TAG in v) {
      const t = v as Tagged;
      if (typeof t.b64 === 'string') {
        const bytes = base64ToBytes(t.b64);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return t[TAG] === 'f64' ? new Float64Array(buf) : new Float32Array(buf);
      }
      if (Array.isArray(t.d)) return t[TAG] === 'f64' ? Float64Array.from(t.d) : Float32Array.from(t.d);
    }
    if (isSeries(v) && v.t.length < v.cap) return expandSeries(v);
    return v;
  });
}

function isSeries(v: unknown): v is SeriesData {
  return !!v && typeof v === 'object' && 'cap' in v && 'len' in v && (v as SeriesData).t instanceof Float64Array;
}

/** Store only the filled part of a ring buffer, in chronological order. */
function compactSeries(s: SeriesData): SeriesData {
  const out = createSeries(Math.max(1, s.len), s.grow);
  for (let i = 0; i < s.len; i++) {
    const j = (s.start + i) % s.cap;
    out.t[i] = s.t[j]; out.o[i] = s.o[j]; out.h[i] = s.h[j]; out.l[i] = s.l[j]; out.c[i] = s.c[j]; out.v[i] = s.v[j];
  }
  out.len = s.len;
  out.cap = s.cap; // logical capacity is preserved; arrays are re-expanded on load
  return out;
}

function expandSeries(s: SeriesData): SeriesData {
  const out = createSeries(s.cap, s.grow);
  const n = Math.min(s.len, s.t.length);
  out.t.set(s.t.subarray(0, n)); out.o.set(s.o.subarray(0, n)); out.h.set(s.h.subarray(0, n));
  out.l.set(s.l.subarray(0, n)); out.c.set(s.c.subarray(0, n)); out.v.set(s.v.subarray(0, n));
  out.len = n;
  return out;
}

/** Deep copy suitable for persisting while the simulation keeps running. */
export function snapshot(state: GameState): GameState {
  return structuredClone(state);
}

export async function gzipText(text: string): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return new TextEncoder().encode(text);
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipText(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || typeof DecompressionStream === 'undefined') return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
