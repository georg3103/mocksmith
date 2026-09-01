import { validateEndpoints } from './validateEndpoints';

describe('validateEndpoints', () => {
  test('accepts valid endpoints', () => {
    expect(() =>
      validateEndpoints([
        { path: '/a', status: 200 },
        { path: '/b', responses: [{ body: {} }] },
      ])
    ).not.toThrow();
  });

  test('throws on an empty path', () => {
    expect(() => validateEndpoints([{ path: '', status: 200 }])).toThrow(/has no path/);
  });

  test('throws when an inline response is combined with responses', () => {
    expect(() =>
      validateEndpoints([{ path: '/a', status: 500, responses: [{ body: {} }] }])
    ).toThrow(/cannot be combined/);
  });
});
