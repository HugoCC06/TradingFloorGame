import { closeAt } from '../series';
import { game, playDays } from './helpers';

function dailyRets(g: ReturnType<typeof game>, idx: number, n: number) {
  const s = g.history.d1[idx];
  const out: number[] = [];
  for (let i = Math.max(1, s.len - n); i < s.len; i++) out.push(closeAt(s, i) / closeAt(s, i - 1) - 1);
  return out;
}
const sd = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

test('calibration report', () => {
  const g = game({ seed: 777 });
  playDays(g, 60);
  const n = 60;
  const tfx = dailyRets(g, g.benchmarkIdx, n);
  console.log('TFX daily sd', (sd(tfx) * 100).toFixed(2), '% max', (Math.max(...tfx.map(Math.abs)) * 100).toFixed(2));
  const eq = g.instruments.filter((i) => i.kind === 'equity');
  const sds = eq.map((i) => sd(dailyRets(g, i.idx, n)));
  const targ = eq.map((i) => i.vol);
  console.log('equity realised sd mean', (sds.reduce((a, b) => a + b) / sds.length * 100).toFixed(2), 'target mean', (targ.reduce((a, b) => a + b) / targ.length * 100).toFixed(2));
  // pre-history comparison
  const pre = eq.map((i) => { const s = g.history.d1[i.idx]; const r: number[] = []; for (let k = 1; k < 200; k++) r.push(closeAt(s, k) / closeAt(s, k - 1) - 1); return sd(r); });
  console.log('prehistory sd mean', (pre.reduce((a, b) => a + b) / pre.length * 100).toFixed(2));
  const com = g.instruments.filter((i) => i.kind === 'commodity').map((i) => `${i.id}:${(sd(dailyRets(g, i.idx, n)) * 100).toFixed(2)}/${(i.vol*100).toFixed(2)}`);
  console.log('commodities', com.join(' '));
  const etf = g.instruments.filter((i) => i.kind === 'etf').map((i) => `${i.id}:${(sd(dailyRets(g, i.idx, n)) * 100).toFixed(2)}`);
  console.log('etfs', etf.join(' '));
  console.log('regime history', g.macro.regime, 'volShock', g.macro.volShock.toFixed(2));
  console.log('impacts pending', g.impacts.length);
});
