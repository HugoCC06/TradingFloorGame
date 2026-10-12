/** Display formatting only — never used for financial calculations. */
export function money(cents: number, opts: { compact?: boolean; sign?: boolean; decimals?: number } = {}): string {
  const v = cents / 100;
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (opts.compact && a >= 1e9) s = `${(a / 1e9).toFixed(2)}B`;
  else if (opts.compact && a >= 1e6) s = `${(a / 1e6).toFixed(2)}M`;
  else if (opts.compact && a >= 1e4) s = `${(a / 1e3).toFixed(1)}K`;
  else s = a.toLocaleString('en-US', { minimumFractionDigits: opts.decimals ?? 0, maximumFractionDigits: opts.decimals ?? 0 });
  const sign = neg ? '−' : opts.sign && v > 0 ? '+' : '';
  return `${sign}$${s}`;
}

export function price(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p >= 1000 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p.toFixed(p < 10 ? 3 : 2);
}

export function pct(x: number, decimals = 2, sign = true): string {
  if (!Number.isFinite(x)) return '—';
  const v = x * 100;
  return `${sign && v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(decimals)}%`;
}

export function num(x: number, decimals = 0): string {
  return x.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function compact(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e12) return `${(x / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return x.toFixed(0);
}

export function cls(x: number): string {
  return x > 0 ? 'pos' : x < 0 ? 'neg' : '';
}

export function arrow(x: number): string {
  return x > 0 ? '▲' : x < 0 ? '▼' : '•';
}

export function since(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString('en-US');
}
