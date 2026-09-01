import type { Command } from 'commander';

import { createCliContext } from './context';
import { createProgram } from './createProgram';
import { normalizeLegacySubcommand } from './normalizeLegacySubcommand';
import { registerPluginCommands } from './registerPluginCommands';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const buildContext = () =>
  createCliContext({
    baseUrl: 'http://127.0.0.1:3101',
    appUrl: 'http://127.0.0.1:3100',
    sessionId: 'default',
    sslEnabled: false,
    logger: silentLogger,
  });

const describeTree = (command: Command, prefix = ''): string[] =>
  command.commands.flatMap((child) => {
    const name = prefix ? `${prefix} ${child.name()}` : child.name();

    return [name, ...describeTree(child, name)];
  });

/**
 * The command tree is the CLI's public surface. Scenario commands are about to
 * move out of the core into a plugin, so this snapshot is what proves nothing
 * silently disappeared in the move.
 * */
describe('CLI command tree', () => {
  test('built-in commands', () => {
    const program = createProgram(buildContext());

    expect(describeTree(program).sort()).toEqual([
      'config',
      'config print',
      'date',
      'endpoint',
      'endpoint clear',
      'endpoint list',
      'endpoint set',
      'endpoint-clear',
      'endpoint-set',
      'endpoints',
      'get',
      'patch',
      'reload',
      'reset',
      'session',
      'session date',
      'session get',
      'session patch',
      'session reset',
      'session set',
      'set',
      'start',
    ]);
  });

  test('a plugin contributes exactly its own subtree', () => {
    const baseline = describeTree(createProgram(buildContext()));
    const program = createProgram(buildContext());
    const ctx = buildContext();

    const defaults = registerPluginCommands(
      program,
      [
        {
          name: 'demo',
          cli: [
            {
              name: 'demo',
              description: 'demo group',
              defaultSubcommand: 'run',
              commands: [
                { name: 'run', args: [{ name: 'target', required: true }], action: () => {} },
                { name: 'list', action: () => {} },
              ],
            },
          ],
        },
      ],
      { ...ctx, getBaseUrl: ctx.getBaseUrl, loadModule: (async () => ({})) as never }
    );

    const added = describeTree(program).filter((name) => !baseline.includes(name));

    expect(added.sort()).toEqual(['demo', 'demo list', 'demo run']);
    expect(defaults).toEqual([{ name: 'demo', subcommand: 'run', known: ['run', 'list', 'help'] }]);
  });

  test('refuses a plugin command that collides with a built-in one', () => {
    const program = createProgram(buildContext());
    const warnings: unknown[] = [];
    const ctx = buildContext();

    registerPluginCommands(program, [{ name: 'clash', cli: [{ name: 'session' }] }], {
      ...ctx,
      getBaseUrl: ctx.getBaseUrl,
      loadModule: (async () => ({})) as never,
      log: { ...silentLogger, warn: (...args: unknown[]) => warnings.push(args) },
    });

    expect(warnings).toHaveLength(1);
    expect(describeTree(program).filter((name) => name === 'session')).toHaveLength(1);
  });

  test('core commands carry their options', () => {
    const program = createProgram(buildContext());
    const endpointSet = program.commands
      .find((c) => c.name() === 'endpoint')
      ?.commands.find((c) => c.name() === 'set');

    expect(endpointSet?.options.map((o) => o.long).sort()).toEqual([
      '--abort',
      '--body',
      '--delay',
      '--header',
      '--status',
    ]);
  });
});

describe('normalizeLegacySubcommand', () => {
  test('inserts the default subcommand for a shorthand', () => {
    const argv = ['node', 'mocksmith', 'endpoint', '/api/x', '--status', '500'];

    normalizeLegacySubcommand(argv, 'endpoint', ['clear', 'help', 'list', 'set'], 'set');

    expect(argv).toEqual(['node', 'mocksmith', 'endpoint', 'set', '/api/x', '--status', '500']);
  });

  test('leaves an explicit subcommand alone', () => {
    const argv = ['node', 'mocksmith', 'endpoint', 'list'];

    normalizeLegacySubcommand(argv, 'endpoint', ['clear', 'help', 'list', 'set'], 'set');

    expect(argv).toEqual(['node', 'mocksmith', 'endpoint', 'list']);
  });

  test('leaves a flag alone', () => {
    const argv = ['node', 'mocksmith', 'endpoint', '--all'];

    normalizeLegacySubcommand(argv, 'endpoint', ['clear', 'help', 'list', 'set'], 'set');

    expect(argv).toEqual(['node', 'mocksmith', 'endpoint', '--all']);
  });
});
