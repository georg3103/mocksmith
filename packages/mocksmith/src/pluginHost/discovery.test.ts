import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePlugins } from './resolvePlugins';

import type { ResolvedMockerConfig } from '../config/types';

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/project'
);

const resolvedFor = (config: Partial<ResolvedMockerConfig['config']>): ResolvedMockerConfig => ({
  config: { handlers: [{}], defaultSessionData: {}, ...config } as ResolvedMockerConfig['config'],
  configDirectory: projectDirectory,
  configPath: path.join(projectDirectory, 'mocksmith.config.ts'),
  serverUrl: 'http://127.0.0.1:0',
});

/**
 * The fixture project depends on two packages: one opts in as a plugin through
 * its manifest, the other does not. Discovery must find exactly the first, and
 * it must load the subpath the manifest names — the package root deliberately
 * exports helpers and no plugin, which is what the old code picked up.
 * */
describe('plugin discovery', () => {
  test('is off unless the config asks for it', async () => {
    const plugins = await resolvePlugins(resolvedFor({}));

    expect(plugins).toEqual([]);
  });

  test('finds a package that opts in, via the entry its manifest names', async () => {
    const plugins = await resolvePlugins(resolvedFor({ pluginDiscovery: { auto: true } }));

    expect(plugins.map(({ name }) => name)).toEqual(['fake-discovered']);
  });

  test('ignores a dependency that does not opt in', async () => {
    const plugins = await resolvePlugins(resolvedFor({ pluginDiscovery: { auto: true } }));

    expect(plugins.map(({ name }) => name)).not.toContain('not-a-plugin');
  });

  test('honours custom patterns', async () => {
    const plugins = await resolvePlugins(
      resolvedFor({ pluginDiscovery: { auto: true, patterns: ['nothing-matches-*'] } })
    );

    expect(plugins).toEqual([]);
  });

  test('an explicitly configured plugin wins over the discovered one of the same name', async () => {
    const plugins = await resolvePlugins(
      resolvedFor({
        plugins: [{ name: 'fake-discovered', enforce: 'post' } as never],
        pluginDiscovery: { auto: true },
      })
    );

    expect(plugins).toHaveLength(1);
    expect(plugins[0].enforce).toBe('post');
  });
});
