import { summarize } from '../accounting';
import { game, playDays } from './helpers';

test('smoke: a game runs for 40 days', () => {
  const t0 = performance.now();
  const g = game();
  const t1 = performance.now();
  playDays(g, 40);
  const t2 = performance.now();
  const s = summarize(g);
  const bench = g.instruments[g.benchmarkIdx];
  console.log(`init ${(t1 - t0).toFixed(0)}ms, 40 days ${(t2 - t1).toFixed(0)}ms`);
  console.log('instruments', g.instruments.length, 'news', g.news.length, 'nav', s.nav / 100, 'navpu', s.navPerUnit.toFixed(3));
  console.log('bench', bench.id, bench.price.toFixed(2), 'regime', g.macro.regime, 'company cash', g.company.cash / 100);
  console.log('clients', g.clients.map((c) => `${c.type}:${c.confidence.toFixed(0)}`).join(' '));
  console.log('rivals', g.rivals.map((r) => `${r.short}:${r.navPerUnit.toFixed(1)}`).join(' '));
  console.log('news sample', g.news.slice(-8).map((n) => n.headline));
  expect(g.status).toBe('active');
});
