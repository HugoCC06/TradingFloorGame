/**
 * JSON (de)serialisation for export/import and cloud saves. Typed arrays are
 * tagged so they round-trip exactly; IndexedDB stores them natively.
 */
import type { GameState } from '../game/types';

const TAG = '__ta';
type Tagged = { [TAG]: string; d: number[] };

export function toJSON(state: unknown): string {
  return JSON.stringify(state, (_k, v) => {
    if (v instanceof Float64Array) return { [TAG]: 'f64', d: Array.from(v) } satisfies Tagged;
    if (v instanceof Float32Array) return { [TAG]: 'f32', d: Array.from(v) } satisfies Tagged;
    return v;
  });
}

export function fromJSON(text: string): unknown {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && TAG in v && Array.isArray((v as Tagged).d)) {
      const t = v as Tagged;
      return t[TAG] === 'f64' ? Float64Array.from(t.d) : Float32Array.from(t.d);
    }
    return v;
  });
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
