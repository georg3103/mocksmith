import { scenarioCliCommands } from './commands';

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
