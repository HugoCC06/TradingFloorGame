/**
 * Deterministic, seedable PRNG (sfc32). The generator state is a plain
 * 4-element array so it can be persisted inside a save file; every call
 * mutates that array in place, so resuming a save resumes the exact stream.
 */
export type RngState = [number, number, number, number];

export function seedState(seed: number, salt = 0): RngState {
  // splitmix32 to expand the seed into 4 well-mixed words
  let s = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st: RngState = [next(), next(), next(), next()];
  // warm up
  const r = new Rng(st);
  for (let i = 0; i < 12; i++) r.next();
  return st;
}

export class Rng {
  constructor(public readonly s: RngState) {}

  /** Uniform in [0, 1). */
  next(): number {
    const s = this.s;
    let a = s[0] >>> 0, b = s[1] >>> 0, c = s[2] >>> 0, d = s[3] >>> 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    s[0] = a >>> 0; s[1] = b; s[2] = c; s[3] = d;
    return t / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box–Muller (one value per call; no cached spare so state stays a pure array). */
  normal(): number {
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Student-t-ish fat-tailed shock with unit variance (approximately). */
  fatTail(df = 5): number {
    // normal / sqrt(chi2/df) using sum of squared normals
    let chi = 0;
    for (let i = 0; i < df; i++) {
      const z = this.normal();
      chi += z * z;
    }
    const t = this.normal() / Math.sqrt(chi / df);
    return t * Math.sqrt((df - 2) / df);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  logNormal(mu: number, sigma: number): number {
    return Math.exp(mu + sigma * this.normal());
  }
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  }
  return Math.floor(Math.random() * 4294967296);
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
