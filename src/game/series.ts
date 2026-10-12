/**
 * Compact OHLCV storage. Each series is a ring buffer of typed-array columns.
 * Plain data (no class) so it survives structured clone into IndexedDB.
 * Timestamps are Unix seconds in exchange-local time (rendered as UTC).
 */
export interface SeriesData {
  cap: number;
  grow: boolean;
  start: number; // ring start index
  len: number;
  t: Float64Array;
  o: Float32Array;
  h: Float32Array;
  l: Float32Array;
  c: Float32Array;
  v: Float32Array;
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function createSeries(cap: number, grow = false): SeriesData {
  return {
    cap, grow, start: 0, len: 0,
    t: new Float64Array(cap), o: new Float32Array(cap), h: new Float32Array(cap),
    l: new Float32Array(cap), c: new Float32Array(cap), v: new Float32Array(cap),
  };
}

function growSeries(s: SeriesData) {
  const ncap = s.cap * 2;
  const n = createSeries(ncap, true);
  for (let i = 0; i < s.len; i++) {
    const j = (s.start + i) % s.cap;
    n.t[i] = s.t[j]; n.o[i] = s.o[j]; n.h[i] = s.h[j]; n.l[i] = s.l[j]; n.c[i] = s.c[j]; n.v[i] = s.v[j];
  }
  s.cap = ncap; s.start = 0;
  s.t = n.t; s.o = n.o; s.h = n.h; s.l = n.l; s.c = n.c; s.v = n.v;
}

export function pushBar(s: SeriesData, t: number, o: number, h: number, l: number, c: number, v: number) {
  if (s.len === s.cap) {
    if (s.grow) growSeries(s);
    else {
      // overwrite oldest
      s.start = (s.start + 1) % s.cap;
      s.len--;
    }
  }
  const j = (s.start + s.len) % s.cap;
  s.t[j] = t; s.o[j] = o; s.h[j] = h; s.l[j] = l; s.c[j] = c; s.v[j] = v;
  s.len++;
}

function phys(s: SeriesData, i: number) {
  return (s.start + i) % s.cap;
}

export function barAt(s: SeriesData, i: number): Bar {
  const j = phys(s, i);
  return { time: s.t[j], open: s.o[j], high: s.h[j], low: s.l[j], close: s.c[j], volume: s.v[j] };
}

export function lastBar(s: SeriesData): Bar | null {
  return s.len ? barAt(s, s.len - 1) : null;
}

/** Mutate the most recent bar (used while a bar is forming). */
export function updateLast(s: SeriesData, price: number, addVolume: number) {
  if (!s.len) return;
  const j = phys(s, s.len - 1);
  if (price > s.h[j]) s.h[j] = price;
  if (price < s.l[j]) s.l[j] = price;
  s.c[j] = price;
  s.v[j] += addVolume;
}

export function setLast(s: SeriesData, o: number, h: number, l: number, c: number, v: number) {
  if (!s.len) return;
  const j = phys(s, s.len - 1);
  s.o[j] = o; s.h[j] = h; s.l[j] = l; s.c[j] = c; s.v[j] = v;
}

export function closeAt(s: SeriesData, i: number): number {
  return s.c[phys(s, i)];
}

export function timeAt(s: SeriesData, i: number): number {
  return s.t[phys(s, i)];
}

export function toBars(s: SeriesData, from = 0): Bar[] {
  const out: Bar[] = [];
  for (let i = Math.max(0, from); i < s.len; i++) out.push(barAt(s, i));
  return out;
}

/** Closes of the last n bars (oldest first). */
export function lastCloses(s: SeriesData, n: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, s.len - n); i < s.len; i++) out.push(closeAt(s, i));
  return out;
}

/**
 * Aggregate bars into buckets of `bucketSeconds`, aligned to the session open
 * (so 15m/1h buckets start at 09:30). Used both for on-the-fly 5m views and for
 * rolling minute bars into stored 15m/1h series at the close.
 */
export function aggregate(bars: Bar[], bucketSeconds: number, sessionStartOf: (t: number) => number): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curKey = -1;
  for (const b of bars) {
    const s0 = sessionStartOf(b.time);
    const key = s0 + Math.floor((b.time - s0) / bucketSeconds) * bucketSeconds;
    if (!cur || key !== curKey) {
      if (cur) out.push(cur);
      cur = { time: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      curKey = key;
    } else {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Session start (09:30 exchange time) for any timestamp within that day. */
export function sessionStart(t: number): number {
  const day = Math.floor(t / 86400) * 86400;
  return day + (9 * 60 + 30) * 60;
}
