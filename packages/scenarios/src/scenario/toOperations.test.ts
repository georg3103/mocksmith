import { applyScenarioViaApi } from './applyOverApi';
import { applyScenarioToContext } from './applyOnContext';
import { summarize, toOperations } from './toOperations';

import type { MockContext } from 'mocksmith';
import type { Scenario } from './types';

const scenario: Scenario = {
  name: 'Degraded shop',
  session: { patch: { user: { plan: 'free' } }, flags: { NEW_CHECKOUT: true } },
  endpoints: [
    { path: '/api/items', when: { query: { page: '>1' } }, status: 503 },
    { path: '/api/items', status: 200, body: { items: [] } },
    { path: '/api/profile', response: { status: 500 } },
  ],
};

describe('toOperations', () => {
  test('reads a scenario as an ordered list of steps', () => {
    expect(toOperations(scenario, { clearExisting: true })).toEqual([
      { kind: 'clearOverrides' },
      { kind: 'patchSession', patch: { user: { plan: 'free' } } },
      { kind: 'patchSession', patch: { remoteConfigFlags: { NEW_CHECKOUT: true } } },
      {
        kind: 'setOverride',
        path: '/api/items',
        // Both rules for one path travel together, in declaration order.
        rules: [
          { when: { query: { page: '>1' } }, status: 503 },
          { status: 200, body: { items: [] } },
        ],
      },
      // The deprecated single-`response` form is normalised in one place.
      { kind: 'setOverride', path: '/api/profile', rules: [{ status: 500 }] },
    ]);
  });

  test('leaves existing overrides alone unless asked', () => {
    expect(toOperations(scenario)).not.toContainEqual({ kind: 'clearOverrides' });
  });

  test('counts what was applied', () => {
    expect(summarize(scenario, toOperations(scenario))).toEqual({
      paths: 2,
      rules: 3,
      reloadRequested: true,
    });
    expect(summarize({ reload: false }, []).reloadRequested).toBe(false);
  });
});

describe('the two ways of applying one scenario', () => {
  test('send the same steps over the API and onto a context', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];

    await applyScenarioViaApi(scenario, async (endpoint, body) => {
      calls.push([endpoint, body]);
    }, { sessionId: 'test', clearExisting: true });

    expect(calls).toEqual([
      ['clearOverride', { id: 'test', all: true }],
      ['patchSession', { id: 'test', patch: { user: { plan: 'free' } } }],
      ['patchSession', { id: 'test', patch: { remoteConfigFlags: { NEW_CHECKOUT: true } } }],
      [
        'setOverride',
        {
          id: 'test',
          path: '/api/items',
          rules: [
            { when: { query: { page: '>1' } }, status: 503 },
            { status: 200, body: { items: [] } },
          ],
        },
      ],
      ['setOverride', { id: 'test', path: '/api/profile', rules: [{ status: 500 }] }],
    ]);

    const context = {
      cleared: 0,
      patches: [] as unknown[],
      overrides: [] as unknown[],
      clearOverrides() {
        this.cleared += 1;
      },
      patchApiData(patch: unknown) {
        this.patches.push(patch);
      },
      setOverride(path: string, rules: unknown) {
        this.overrides.push([path, rules]);
      },
    };

    applyScenarioToContext(scenario, context as unknown as MockContext);

    expect(context.cleared).toBe(1);
    expect(context.patches).toEqual([
      { user: { plan: 'free' } },
      { remoteConfigFlags: { NEW_CHECKOUT: true } },
    ]);
    // Two rules on one path arrive as one call, not as two that overwrite.
    expect(context.overrides).toEqual([
      [
        '/api/items',
        [
          { when: { query: { page: '>1' } }, status: 503 },
          { status: 200, body: { items: [] } },
        ],
      ],
      ['/api/profile', [{ status: 500 }]],
    ]);
  });
});
