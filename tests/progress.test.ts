import { describe, expect, it } from 'vitest';
import { parseProgress, totalStars } from '../src/progress.ts';

const ids = ['touchdown', 'bend', 'first-sample'];

describe('saved progress', () => {
  it('starts fresh when nothing is saved or the data is not JSON', () => {
    const fresh = { current: 'touchdown', code: {}, stars: {} };
    expect(parseProgress(null, ids)).toEqual(fresh);
    expect(parseProgress('{not json', ids)).toEqual(fresh);
    expect(parseProgress('[1, 2]', ids)).toEqual(fresh);
    expect(parseProgress('"text"', ids)).toEqual(fresh);
  });

  it('keeps valid progress', () => {
    const saved = { current: 'bend', code: { bend: 'move()' }, stars: { touchdown: 3, bend: 1 } };
    expect(parseProgress(JSON.stringify(saved), ids)).toEqual(saved);
  });

  it('drops unknown missions and values of the wrong type or range', () => {
    const saved = {
      current: 'gone',
      code: { bend: 42, touchdown: 'move()', gone: 'x' },
      stars: { touchdown: '3', bend: 4, 'first-sample': 2.5, gone: 3 },
    };
    const progress = parseProgress(JSON.stringify(saved), ids);
    expect(progress).toEqual({ current: 'touchdown', code: { touchdown: 'move()' }, stars: {} });
    expect(totalStars(progress)).toBe(0);
  });

  it('adds up the stars', () => {
    expect(totalStars(parseProgress(JSON.stringify({ stars: { touchdown: 3, bend: 2 } }), ids))).toBe(5);
  });
});
