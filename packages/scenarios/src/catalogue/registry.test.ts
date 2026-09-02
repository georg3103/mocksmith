import { createScenarioRegistry, scenarioNameFromFile } from './registry';
import { scenarioCliCommands } from './cli';

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

describe('scenario CLI commands', () => {
  test('declares list, apply and clear under one group', () => {
    const [group] = scenarioCliCommands();

    expect(group.name).toBe('scenario');
    expect(group.defaultSubcommand).toBe('apply');
    expect(group.commands?.map((command) => command.name)).toEqual(['list', 'apply', 'clear']);
  });

  test('apply takes a target and a --no-reload flag', () => {
    const apply = scenarioCliCommands()[0].commands?.find((c) => c.name === 'apply');

    expect(apply?.args).toEqual([
      { name: 'target', required: true, description: 'scenario name or file path' },
    ]);
    expect(apply?.options?.map((option) => option.flags)).toEqual(['--no-reload']);
  });
});
