import log from 'loglevel';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { importModule } from '../utils/importModule';
import { PLUGIN_API_VERSION } from './types';

import type { ResolvedMockerConfig } from '../config/types';
import type {
  MockerPluginEntry,
  MocksmithPlugin,
  PluginConfigEnv,
  StartMockerOptionsLike,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isPluginObject = (value: unknown): value is MocksmithPlugin =>
  isRecord(value) && typeof value.name === 'string' && value.name.trim().length > 0;

const normalize = (plugin: unknown, source: string): MocksmithPlugin => {
  if (!isPluginObject(plugin)) {
    throw new Error(`plugin "${source}" must resolve to an object with a "name"`);
  }

  const version = plugin.apiVersion ?? PLUGIN_API_VERSION;

  if (version !== PLUGIN_API_VERSION) {
    throw new Error(
      `plugin "${plugin.name}" targets plugin API v${version}, ` +
        `this mocksmith supports v${PLUGIN_API_VERSION}`
    );
  }

  return plugin;
};

/**
 * Picks the plugin out of a loaded module: a default export, a `plugin` export,
 * or — when there is exactly one candidate — that one.
 * */
const pickPluginExport = (module: Record<string, unknown>, specifier: string): unknown => {
  if (module.default !== undefined) {
    return module.default;
  }

  if (module.plugin !== undefined) {
    return module.plugin;
  }

  const candidates = Object.values(module).filter(
    (value) => typeof value === 'function' || isPluginObject(value)
  );

  if (candidates.length === 1) {
    return candidates[0];
  }

  throw new Error(
    `plugin "${specifier}" must have a default export (or exactly one plugin export)`
  );
};

const instantiate = async (
  entry: MockerPluginEntry,
  env: PluginConfigEnv
): Promise<MocksmithPlugin> => {
  if (typeof entry === 'function') {
    return normalize((entry as () => MocksmithPlugin)(), 'inline factory');
  }

  if (isPluginObject(entry)) {
    return normalize(entry, entry.name);
  }

  const { use, options } =
    typeof entry === 'string' ? { use: entry, options: undefined } : (entry as { use: string; options?: unknown });

  const parentUrl = pathToFileURL(env.configPath).href;
  const module = await importModule(use, parentUrl);
  const exported = pickPluginExport(module, use);
  const plugin =
    typeof exported === 'function' ? (exported as (o?: unknown) => MocksmithPlugin)(options) : exported;

  return normalize(plugin, use);
};

/** Reads the nearest package.json walking up from a directory. */
const findPackageJson = async (from: string): Promise<Record<string, unknown> | undefined> => {
  let directory = from;

  for (;;) {
    try {
      return JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      const parent = path.dirname(directory);

      if (parent === directory) {
        return undefined;
      }

      directory = parent;
    }
  }
};

const matchesPattern = (name: string, patterns: string[]) =>
  patterns.some((pattern) => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

    return new RegExp(`^${escaped}$`).test(name);
  });

const DEFAULT_DISCOVERY_PATTERNS = ['mocksmith-plugin-*', '@mocksmith/*', '*-mocksmith-plugin'];

/**
 * Finds plugins among the project's direct dependencies. A package counts only
 * when it opts in with a `"mocksmith": { "plugin": "./…" }` field — otherwise
 * the `@mocksmith/*` pattern would sweep in companion packages such as
 * @mocksmith/playwright, which are libraries and not plugins.
 * */
const discoverPlugins = async (
  env: PluginConfigEnv,
  patterns = DEFAULT_DISCOVERY_PATTERNS
): Promise<MocksmithPlugin[]> => {
  const manifest = await findPackageJson(env.configDirectory);

  if (!manifest) {
    return [];
  }

  const names = [
    ...Object.keys((manifest.dependencies as Record<string, string>) ?? {}),
    ...Object.keys((manifest.devDependencies as Record<string, string>) ?? {}),
  ]
    .filter((name) => matchesPattern(name, patterns))
    .sort();

  const parentUrl = pathToFileURL(env.configPath).href;
  const found: MocksmithPlugin[] = [];

  for (const name of names) {
    let entry: string | undefined;

    try {
      const manifestModule = await importModule(`${name}/package.json`, parentUrl);
      const pkg = (manifestModule.default ?? manifestModule) as Record<string, unknown>;
      const field = pkg.mocksmith as { plugin?: string } | undefined;

      entry = field?.plugin;
    } catch {
      continue;
    }

    if (!entry) {
      continue;
    }

    // The manifest points at a subpath ('./plugin'), which has to be turned
    // into a specifier the package's own exports map accepts — importing the
    // package root instead would land on a module that exports no plugin.
    const specifier = entry === '.' ? name : `${name}/${entry.replace(/^\.?\//, '')}`;

    try {
      found.push(await instantiate(specifier, env));
    } catch (error) {
      log.warn(`Skipping discovered plugin "${name}": ${(error as Error).message}`);
    }
  }

  return found;
};

const rank = (plugin: MocksmithPlugin) =>
  plugin.enforce === 'pre' ? 0 : plugin.enforce === 'post' ? 2 : 1;

/**
 * Turns the config's `plugins` entries into plugin objects. Purely
 * declarative: modules are imported and factories called, but no hook runs —
 * the CLI relies on that to list plugin commands without starting a server.
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
    explicit.push(await instantiate(entry, env));
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
