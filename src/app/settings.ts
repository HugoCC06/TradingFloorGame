/** Small user preferences persisted in localStorage (game state lives in IndexedDB). */
export type SpeedId = 'slow' | 'normal' | 'fast' | 'turbo' | 'max';

export interface Settings {
  speed: SpeedId;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  musicOn: boolean;
  theme: 'dark' | 'light';
  reduceMotion: boolean;
  largeText: boolean;
  chartStyle: 'candles' | 'line';
  showVolume: boolean;
  defaultTimeframe: '1m' | '5m' | '15m' | '1h' | '1D';
  toasts: boolean;
  newsToasts: 'all' | 'holdings' | 'off';
  autosave: 'frequent' | 'daily' | 'off';
  pauseOnClose: boolean;
  pauseOnBreaking: boolean;
  pauseWhenHidden: boolean;
  tutorial: boolean;
  introSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 'normal', sfxVolume: 0.5, musicVolume: 0.3, muted: false, musicOn: false, theme: 'dark', reduceMotion: false, largeText: false,
  chartStyle: 'candles', showVolume: true, defaultTimeframe: '5m', toasts: true, newsToasts: 'holdings', autosave: 'frequent',
  pauseOnClose: true, pauseOnBreaking: true, pauseWhenHidden: true, tutorial: true, introSeen: false,
};

/** Real milliseconds per simulated minute. Normal ≈ 13 real minutes per trading day. */
export const SPEEDS: Record<SpeedId, { label: string; msPerMinute: number }> = {
  slow: { label: '0.5×', msPerMinute: 3000 },
  normal: { label: '1×', msPerMinute: 2000 },
  fast: { label: '4×', msPerMinute: 500 },
  turbo: { label: '20×', msPerMinute: 100 },
  max: { label: '80×', msPerMinute: 25 },
};

const KEY = 'tf.settings.v1';
type Listener = (s: Settings) => void;
const listeners = new Set<Listener>();

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

let current: Settings = typeof localStorage !== 'undefined' ? read() : { ...DEFAULT_SETTINGS };

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  for (const l of listeners) l(current);
}

export function subscribeSettings(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetSettings() {
  updateSettings({ ...DEFAULT_SETTINGS, introSeen: true });
}
