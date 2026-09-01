import { endpointsToRules } from './endpointsToRules';

import type { ScenarioEndpoint } from './types';

describe('endpointsToRules', () => {
  test('groups rules by path, preserving order', () => {
    const endpoints: ScenarioEndpoint[] = [
      { path: '/a', when: { query: { cursor: '0' } }, body: { page: 0 } },
      { path: '/b', status: 500 },
      { path: '/a', when: { query: { cursor: '>=1' } }, body: { page: 1 } },
    ];

    expect(endpointsToRules(endpoints)).toEqual([
      {
        path: '/a',
        rules: [
          { when: { query: { cursor: '0' } }, body: { page: 0 } },
          { when: { query: { cursor: '>=1' } }, body: { page: 1 } },
        ],
      },
      { path: '/b', rules: [{ status: 500 }] },
    ]);
  });

  test('drops the path field from the rules', () => {
    const [{ rules }] = endpointsToRules([{ path: '/a', status: 200 }]);

    expect(rules[0]).not.toHaveProperty('path');
  });
});
