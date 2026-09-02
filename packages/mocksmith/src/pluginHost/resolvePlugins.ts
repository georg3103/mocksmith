import log from 'loglevel';

import { discoverPlugins } from './discoverPlugins';
import { instantiatePlugin, isRecord } from './normalizePlugin';

import type { ResolvedMockerConfig } from '../config/types';
import type { MocksmithPlugin, PluginConfigEnv, StartMockerOptionsLike } from '../plugin/types';

const rank = (plugin: MocksmithPlugin) =>
  plugin.enforce === 'pre' ? 0 : plugin.enforce === 'post' ? 2 : 1;

/**
 * Turns the config's `plugins` entries into plugin objects, adds the discovered
 * ones when discovery is on, and puts them in the order hooks will run.
 *
 * Purely declarative: modules are imported and factories called, but no hook
 * runs — the CLI relies on that to list plugin commands without a server.
 * */
export const resolvePlugins = async (
  resolved: ResolvedMockerConfig,
  options: StartMockerOptionsLike = {}
): Promise<MocksmithPlugin[]> => {
  const env: PluginConfigEnv = {
    configDirectory: resolved.configDirectory,
    configPath: resolved.configPath,
    serverUrl: resolved.serverUrl,
    options,
  };

  const entries = (resolved.config.plugins ?? []).filter(
    (entry) => !(isRecord(entry) && (entry as { enabled?: boolean }).enabled === false)
  );

  const explicit: MocksmithPlugin[] = [];

  for (const entry of entries) {
    explicit.push(await instantiatePlugin(entry, env));
  }

  const discovery = resolved.config.pluginDiscovery;
  const discovered = discovery?.auto ? await discoverPlugins(env, discovery.patterns) : [];

  const seen = new Set<string>();
  const unique = [...explicit, ...discovered].filter((plugin) => {
    if (seen.has(plugin.name)) {
      log.debug(`plugin "${plugin.name}" is already registered — skipping the duplicate`);

      return false;
    }

    seen.add(plugin.name);

    return true;
  });

  return unique.sort((a, b) => rank(a) - rank(b));
};
