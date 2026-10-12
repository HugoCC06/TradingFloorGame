/**
 * GameController: the single owner of the live GameState and the only
 * real-time loop. It advances the deterministic simulation in whole simulated
 * minutes based on elapsed wall-clock time and the selected speed, publishes
 * throttled updates to the UI, and handles autosave. There is exactly one
 * interval regardless of which screens are mounted.
 */
import { BALANCE } from '../config/balance';
import { navCents } from '../game/accounting';
import { closeFundVoluntarily } from '../game/failure';
import { newGame } from '../game/init';
import { nextDay, stepMinute } from '../game/sim';
import type { GameSetup, GameState, Notification } from '../game/types';
import { CloudSaveRepository, syncProfileToCloud } from '../persistence/cloud';
import { LocalSaveRepository } from '../persistence/local';
import { loadProfile, mergeRun, saveProfile, type Profile } from '../persistence/profile';
import { cloudConfigured, currentUser } from '../persistence/supabase';
import { autoSlot, type SaveMeta } from '../persistence/types';
import { play } from './audio';
import { getSettings, SPEEDS, updateSettings, type SpeedId } from './settings';

export interface Toast {
  id: string;
  kind: Notification['kind'];
  title: string;
  text: string;
  link?: Notification['link'];
  at: number;
}

type Listener = () => void;

const TICK_MS = 50;
const PUBLISH_MS = 150;
const MAX_MINUTES_PER_TICK = 30;

export class GameController {
  state: GameState | null = null;
  version = 0;
  running = false;
  saving = false;
  lastSave: { at: number; ok: boolean; message: string } | null = null;
  slot: string | null = null;
  toasts: Toast[] = [];
  profile: Profile | null = null;
  readonly local = new LocalSaveRepository();
  readonly cloud = new CloudSaveRepository();

  private listeners = new Set<Listener>();
  private timer: number | null = null;
  private acc = 0;
  private lastTick = 0;
  private lastPublish = 0;
  private dirty = false;
  private lastNotif = 0;
  private minutesSinceSave = 0;
  private hiddenPaused = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.running && getSettings().pauseWhenHidden) {
          this.hiddenPaused = true;
          this.pause();
        } else if (!document.hidden && this.hiddenPaused) {
          this.hiddenPaused = false;
        }
      });
      window.addEventListener('beforeunload', () => this.stopLoop());
    }
  }

  // ───── subscription ─────
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;

  private publish(force = false) {
    const now = performance.now();
    if (!force && now - this.lastPublish < PUBLISH_MS) {
      this.dirty = true;
      return;
    }
    this.lastPublish = now;
    this.dirty = false;
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Run a mutation from the UI and publish immediately. */
  act<T>(fn: (s: GameState) => T): T | undefined {
    if (!this.state) return undefined;
    const r = fn(this.state);
    this.drainNotifications();
    this.publish(true);
    return r;
  }

  // ───── lifecycle ─────
  async startNew(setup: GameSetup) {
    this.stopLoop();
    this.state = newGame(setup);
    this.slot = autoSlot(this.state.id);
    this.lastNotif = 0;
    this.toasts = [];
    this.drainNotifications();
    this.publish(true);
    await this.save(this.slot, 'Autosave', true);
  }

  async loadSlot(slot: string, repo: 'local' | 'cloud' = 'local') {
    this.stopLoop();
    const s = repo === 'cloud' ? await this.cloud.load(slot) : await this.local.load(slot);
    this.state = s;
    this.slot = repo === 'cloud' ? autoSlot(s.id) : slot.startsWith('auto:') ? slot : autoSlot(s.id);
    this.lastNotif = this.maxNotifNum(); // don't re-toast old notifications
    this.toasts = [];
    this.publish(true);
  }

  quitToMenu() {
    this.stopLoop();
    this.state = null;
    this.toasts = [];
    this.publish(true);
  }

  // ───── time controls ─────
  get speed(): SpeedId {
    return getSettings().speed;
  }

  setSpeed(sp: SpeedId) {
    updateSettings({ speed: sp });
    this.publish(true);
  }

  play() {
    const s = this.state;
    if (!s || s.status !== 'active') return;
    if (s.clock.phase === 'closed') return;
    this.running = true;
    this.startLoop();
    this.publish(true);
  }

  pause() {
    this.running = false;
    this.stopLoop();
    this.publish(true);
  }

  toggle() {
    if (this.running) this.pause();
    else this.play();
  }

  private startLoop() {
    if (this.timer !== null) return;
    this.lastTick = performance.now();
    this.acc = 0;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopLoop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  private tick() {
    const s = this.state;
    if (!s || !this.running) return;
    const now = performance.now();
    this.acc += now - this.lastTick;
    this.lastTick = now;
    const per = SPEEDS[this.speed].msPerMinute;
    let n = Math.floor(this.acc / per);
    if (n <= 0) {
      if (this.dirty) this.publish();
      return;
    }
    n = Math.min(n, MAX_MINUTES_PER_TICK);
    this.acc = Math.max(0, this.acc - n * per);
    this.advance(n);
  }

  /** Advance up to n simulated minutes; stops at the close or when a pause trigger fires. */
  advance(n: number): number {
    const s = this.state;
    if (!s) return 0;
    let done = 0;
    for (let i = 0; i < n; i++) {
      const r = stepMinute(s);
      if (r === 'inactive') break;
      done++;
      this.minutesSinceSave++;
      const stop = this.drainNotifications();
      if (r === 'closed') {
        this.onClose();
        break;
      }
      if (stop) {
        this.pause();
        break;
      }
    }
    if (s.status !== 'active') this.onGameOver();
    if (getSettings().autosave === 'frequent' && this.minutesSinceSave >= BALANCE.autosaveEveryMinutes && this.slot) {
      this.minutesSinceSave = 0;
      void this.save(this.slot, 'Autosave', true);
    }
    this.publish(n > 1 || done === 0);
    return done;
  }

  /** Skip forward until something notable happens (news on holdings, fills, major news) or the close. */
  advanceToNextEvent() {
    const s = this.state;
    if (!s || s.clock.phase === 'closed') return;
    const startNews = s.counters.news, startFills = s.counters.fill;
    for (let i = 0; i < 400; i++) {
      const r = stepMinute(s);
      this.drainNotifications();
      if (r === 'closed') { this.onClose(); break; }
      if (r === 'inactive') break;
      const newNews = s.news.slice(-(s.counters.news - startNews));
      if (s.counters.fill !== startFills || newNews.some((x) => x.severity >= 2)) break;
    }
    if (s.status !== 'active') this.onGameOver();
    this.publish(true);
  }

  skipToClose() {
    const s = this.state;
    if (!s || s.clock.phase === 'closed') return;
    for (let i = 0; i < 400; i++) {
      const r = stepMinute(s);
      if (r !== 'ok') { if (r === 'closed') this.onClose(); break; }
    }
    this.drainNotifications(true);
    if (s.status !== 'active') this.onGameOver();
    this.publish(true);
  }

  private onClose() {
    if (getSettings().autosave !== 'off' && this.slot) void this.save(this.slot, 'Autosave', true);
    const s = this.state;
    if (!getSettings().pauseOnClose && s && s.status === 'active' && this.running) {
      // auto-continue: roll straight into the next session
      nextDay(s);
      this.drainNotifications();
      return;
    }
    this.stopLoop();
  }

  nextDay(): boolean {
    const s = this.state;
    if (!s) return false;
    const ok = nextDay(s);
    this.drainNotifications();
    this.publish(true);
    return ok;
  }

  closeFund() {
    if (!this.state) return;
    closeFundVoluntarily(this.state);
    this.onGameOver();
    this.publish(true);
  }

  private onGameOver() {
    this.stopLoop();
    if (this.state && this.slot) void this.save(this.slot, 'Final', true);
  }

  // ───── notifications → toasts/sounds ─────
  private maxNotifNum() {
    let m = 0;
    for (const n of this.state?.notifications ?? []) m = Math.max(m, parseInt(n.id.slice(1), 36));
    return m;
  }

  /** Returns true if a pause-worthy event happened. */
  private drainNotifications(silent = false): boolean {
    const s = this.state;
    if (!s) return false;
    const set = getSettings();
    let stop = false;
    let soundPlayed = false;
    for (const n of s.notifications) {
      const num = parseInt(n.id.slice(1), 36);
      if (num <= this.lastNotif) continue;
      this.lastNotif = num;
      if (silent && n.kind !== 'achievement' && n.kind !== 'danger') continue;
      if (n.sound && !soundPlayed) { play(n.sound); soundPlayed = true; }
      const isNews = n.link?.screen === 'news';
      const showNews = set.newsToasts === 'all' || (set.newsToasts === 'holdings' && (n.title === 'News on a holding' || n.title === 'BREAKING'));
      if (set.toasts && n.toast && (!isNews || showNews)) this.pushToast(n);
      if (n.title === 'BREAKING' && set.pauseOnBreaking) stop = true;
      if (n.title.startsWith('MARGIN CALL')) stop = true;
    }
    return stop;
  }

  private pushToast(n: Notification) {
    this.toasts = [...this.toasts.slice(-2), { id: n.id, kind: n.kind, title: n.title, text: n.text, link: n.link, at: Date.now() }];
  }

  expireToasts(maxAgeMs: number) {
    const now = Date.now();
    const keep = this.toasts.filter((t) => now - t.at < maxAgeMs);
    if (keep.length !== this.toasts.length) {
      this.toasts = keep;
      this.publish(true);
    }
  }

  dismissToast(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.publish(true);
  }

  toast(kind: Toast['kind'], title: string, text = '') {
    this.toasts = [...this.toasts.slice(-4), { id: `local${Date.now()}${Math.random()}`, kind, title, text, at: Date.now() }];
    this.publish(true);
  }

  // ───── saving ─────
  async save(slot: string, label = 'Manual save', quiet = false): Promise<SaveMeta | null> {
    const s = this.state;
    if (!s || this.saving) return null;
    this.saving = true;
    try {
      const meta = await this.local.save(slot, s, label);
      this.lastSave = { at: Date.now(), ok: true, message: `Saved ${label.toLowerCase()}` };
      await this.updateProfile();
      if (cloudConfigured && !slot.startsWith('auto:') && (await currentUser())) {
        try { await this.cloud.save(slot, s, label); } catch (e) { console.warn('cloud save failed', e); }
      }
      if (!quiet) { play('save'); this.toast('success', 'Game saved', label); }
      return meta;
    } catch (e) {
      this.lastSave = { at: Date.now(), ok: false, message: (e as Error).message };
      this.toast('danger', 'Save failed', (e as Error).message);
      return null;
    } finally {
      this.saving = false;
      this.publish(true);
    }
  }

  async updateProfile() {
    const s = this.state;
    this.profile = this.profile ?? (await loadProfile());
    if (s) mergeRun(this.profile, s);
    await saveProfile(this.profile);
    if (cloudConfigured && (await currentUser().catch(() => null))) {
      try { this.profile = await syncProfileToCloud(this.profile); } catch { /* offline */ }
    }
  }

  async getProfile(): Promise<Profile> {
    this.profile = await loadProfile();
    return this.profile;
  }

  navNow() {
    return this.state ? navCents(this.state) : 0;
  }
}

export const controller = new GameController();
if (typeof window !== 'undefined') (window as unknown as { __tf: GameController }).__tf = controller;
