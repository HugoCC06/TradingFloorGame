/**
 * Deterministic exchange calendar. All times are fictional exchange-local time.
 * Dates are ISO strings (YYYY-MM-DD) computed in UTC to avoid host timezone drift.
 */
export const OPEN_MINUTE = 9 * 60 + 30; // 09:30
export const SESSION_MINUTES = 390; // 09:30 -> 16:00

const HOLIDAYS_MD = new Set(['01-01', '07-04', '12-25']); // configurable fixed-date holidays

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isTradingDay(iso: string): boolean {
  const d = parseDate(iso);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !HOLIDAYS_MD.has(iso.slice(5));
}

export function nextTradingDate(iso: string): string {
  const d = parseDate(iso);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (!isTradingDay(formatISO(d)));
  return formatISO(d);
}

export function prevTradingDate(iso: string): string {
  const d = parseDate(iso);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (!isTradingDay(formatISO(d)));
  return formatISO(d);
}

/** First trading date on/after the given date. */
export function firstTradingDate(iso: string): string {
  return isTradingDay(iso) ? iso : nextTradingDate(iso);
}

/** Unix seconds for a session minute index (0 = 09:30) on a date. Exchange time is rendered as UTC. */
export function timestampFor(iso: string, minuteIndex: number): number {
  return Math.floor(parseDate(iso).getTime() / 1000) + (OPEN_MINUTE + minuteIndex) * 60;
}

export function dayTimestamp(iso: string): number {
  return Math.floor(parseDate(iso).getTime() / 1000);
}

export function clockLabel(minuteIndex: number): string {
  const total = OPEN_MINUTE + minuteIndex;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function prettyDate(iso: string): string {
  const d = parseDate(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Intraday volatility/volume U-shape: heavier at open and close. Mean ≈ 1 over the session. */
export function intradayProfile(minuteIndex: number): number {
  const x = minuteIndex / (SESSION_MINUTES - 1);
  return 0.72 + 1.1 * Math.pow(x - 0.5, 2) * 4 * 0.5 + (minuteIndex < 15 ? 0.6 : 0) + (minuteIndex > 375 ? 0.35 : 0);
}
