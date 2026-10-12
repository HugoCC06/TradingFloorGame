import { fresh, playDays, steps } from '../../game/__tests__/helpers';
import { toBars } from '../../game/series';
import type { GameState } from '../../game/types';
import { validateState } from '../validate';
import { fromJSON, gzipText, toJSON } from '../serialize';

test('JSON export is compact and an imported save resumes the identical simulation', async () => {
  const g = fresh({ seed: 9 });
  playDays(g, 3);
  steps(g, 1);
  steps(g, 100);
  const json = toJSON(g);
  const gz = await gzipText(json);
  expect(json.length).toBeLessThan(16e6);
  expect(gz.length).toBeLessThan(8e6);
  const back = fromJSON(json) as GameState;
  expect(validateState(back)).toEqual([]);
  expect(back.history.h1[3].t.length).toBe(g.history.h1[3].cap);
  expect(toBars(back.history.h1[3])).toEqual(toBars(g.history.h1[3]));
  expect(toBars(back.history.m1[10])).toEqual(toBars(g.history.m1[10]));
  steps(g, 200);
  steps(back, 200);
  expect(back.instruments.map((i) => i.price)).toEqual(g.instruments.map((i) => i.price));
  expect(toBars(back.history.d1[0])).toEqual(toBars(g.history.d1[0]));
});
