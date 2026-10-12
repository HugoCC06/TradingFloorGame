/**
 * Subtle synthesized sound effects and an optional generative ambient pad.
 * No audio plays until the user interacts (browsers block autoplay anyway).
 */
import { getSettings, subscribeSettings } from './settings';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

function ac(): AudioContext | null {
  if (!unlocked) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  return ctx;
}

export function unlockAudio() {
  if (unlocked) return;
  // only unlock on a genuine user activation (avoids autoplay-policy warnings)
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (ua && !ua.isActive) return;
  unlocked = true;
  ac()?.resume().catch(() => {});
  syncMusic();
}

if (typeof window !== 'undefined') {
  const handler = () => { unlockAudio(); if (unlocked) { window.removeEventListener('pointerdown', handler); window.removeEventListener('keydown', handler); } };
  window.addEventListener('pointerdown', handler);
  window.addEventListener('keydown', handler);
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slide?: number) {
  const c = ac();
  const s = getSettings();
  if (!c || !master || s.muted || s.sfxVolume <= 0) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol * s.sfxVolume * 0.35, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export type Sfx = 'order' | 'reject' | 'news' | 'open' | 'close' | 'alert' | 'achievement' | 'cash' | 'click' | 'save';

export function play(sfx: Sfx) {
  switch (sfx) {
    case 'order': tone(880, 0.09, 'sine', 0.6); tone(1320, 0.12, 'sine', 0.4, 0.06); break;
    case 'reject': tone(220, 0.18, 'triangle', 0.7, 0, 160); break;
    case 'news': tone(660, 0.08, 'sine', 0.4); tone(990, 0.1, 'sine', 0.3, 0.09); break;
    case 'open': [523, 659, 784].forEach((f, i) => tone(f, 0.25, 'sine', 0.45, i * 0.09)); break;
    case 'close': [784, 659, 523].forEach((f, i) => tone(f, 0.3, 'sine', 0.45, i * 0.1)); break;
    case 'alert': tone(520, 0.14, 'square', 0.25); tone(520, 0.14, 'square', 0.25, 0.2); break;
    case 'achievement': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.4, i * 0.08)); break;
    case 'cash': tone(1200, 0.06, 'sine', 0.4); tone(1600, 0.1, 'sine', 0.35, 0.05); break;
    case 'click': tone(1000, 0.03, 'sine', 0.2); break;
    case 'save': tone(740, 0.08, 'sine', 0.3); break;
  }
}

// ── generative ambient music: slow evolving minor-7th pads ──
let musicNodes: { gain: GainNode; oscs: OscillatorNode[]; timer: number } | null = null;
const CHORDS = [[220, 261.6, 329.6, 392], [196, 246.9, 293.7, 349.2], [174.6, 220, 261.6, 329.6], [207.7, 246.9, 311.1, 370]];

function startMusic() {
  const c = ac();
  if (!c || !master || musicNodes) return;
  const gain = c.createGain();
  gain.gain.value = 0;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  gain.connect(filter);
  filter.connect(master);
  const oscs = [0, 1, 2, 3].map(() => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.connect(gain);
    o.start();
    return o;
  });
  let k = 0;
  const step = () => {
    const ch = CHORDS[k++ % CHORDS.length];
    oscs.forEach((o, i) => o.frequency.setTargetAtTime(ch[i] / 2, c.currentTime, 1.5));
  };
  step();
  const timer = window.setInterval(step, 8000);
  musicNodes = { gain, oscs, timer };
  applyMusicVolume();
}

function stopMusic() {
  if (!musicNodes) return;
  const n = musicNodes;
  musicNodes = null;
  window.clearInterval(n.timer);
  n.gain.gain.setTargetAtTime(0, ctx!.currentTime, 0.4);
  setTimeout(() => n.oscs.forEach((o) => o.stop()), 1500);
}

function applyMusicVolume() {
  const s = getSettings();
  if (musicNodes && ctx) musicNodes.gain.gain.setTargetAtTime(s.muted ? 0 : s.musicVolume * 0.08, ctx.currentTime, 0.8);
}

function syncMusic() {
  const s = getSettings();
  if (s.musicOn && !s.muted) startMusic();
  else stopMusic();
  applyMusicVolume();
}

subscribeSettings(() => { if (unlocked) syncMusic(); });
