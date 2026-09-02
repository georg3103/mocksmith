import { scenarioNameFromFile } from './nameFromFile';
import { createScenarioRegistry } from './registry';

describe('scenario registry', () => {
  test('registers and looks scenarios up by name', () => {
    const registry = createScenarioRegistry();

    registry.register({ name: 'degraded', scenario: { name: 'degraded' }, source: 'a.ts' });

    expect(registry.get('degraded')?.source).toBe('a.ts');
    expect(registry.names()).toEqual(['degraded']);
    expect(registry.size()).toBe(1);
  });

  test('refuses duplicate names and names both sources', () => {
    const registry = createScenarioRegistry();

    registry.register({ name: 'twin', scenario: {}, source: 'first.ts' });

    expect(() => registry.register({ name: 'twin', scenario: {}, source: 'second.ts' })).toThrow(
      /first\.ts and second\.ts/
    );
  });

  test('two registries are independent', () => {
    const one = createScenarioRegistry();
    const two = createScenarioRegistry();

    one.register({ name: 'only-in-one', scenario: {} });

    expect(two.names()).toEqual([]);
  });
});

describe('scenarioNameFromFile', () => {
  test.each([
    ['/mocks/degraded.scenario.ts', 'degraded'],
    ['degraded.scenario.mjs', 'degraded'],
    ['/a/b/checkout-fails.scenario.js', 'checkout-fails'],
  ])('%s → %s', (file, expected) => {
    expect(scenarioNameFromFile(file)).toBe(expected);
  });
});
