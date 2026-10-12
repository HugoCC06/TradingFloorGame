import { BALANCE } from '../config/balance';
import type { GameState, Notification } from './types';

export function nextId(state: GameState, kind: keyof GameState['counters'], prefix: string): string {
  state.counters[kind]++;
  return `${prefix}${state.counters[kind].toString(36).toUpperCase().padStart(4, '0')}`;
}

export function notify(
  state: GameState,
  kind: Notification['kind'],
  title: string,
  text: string,
  opts: { link?: Notification['link']; sound?: Notification['sound']; toast?: boolean } = {},
): Notification {
  const n: Notification = {
    id: nextId(state, 'misc', 'N'),
    day: state.clock.day,
    minute: state.clock.minute,
    kind, title, text,
    link: opts.link,
    sound: opts.sound,
    toast: opts.toast ?? true,
    read: false,
  };
  state.notifications.push(n);
  if (state.notifications.length > BALANCE.notificationsCap) state.notifications.splice(0, state.notifications.length - BALANCE.notificationsCap);
  return n;
}

export function logKeyEvent(state: GameState, text: string) {
  state.stats.keyEvents.push({ day: state.clock.day, date: state.clock.date, text });
  if (state.stats.keyEvents.length > 60) state.stats.keyEvents.splice(0, state.stats.keyEvents.length - 60);
}
