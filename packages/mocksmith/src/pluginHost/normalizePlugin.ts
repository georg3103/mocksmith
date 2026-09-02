import { pathToFileURL } from 'node:url';

import { importModule } from '../utils/importModule';
import { PLUGIN_API_VERSION } from '../plugin/types';

import type { MockerPluginEntry, MocksmithPlugin, PluginConfigEnv } from '../plugin/types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isPluginObject = (value: unknown): value is MocksmithPlugin =>
  isRecord(value) && typeof value.name === 'string' && value.name.trim().length > 0;

/** Checks the shape and the API version a plugin was written against. */
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

/**
 * Turns one config entry — an object, a factory, a package name or
 * `{ use, options }` — into a checked plugin. Imports run here; no hook does.
 * */
export const instantiatePlugin = async (
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
    typeof entry === 'string'
      ? { use: entry, options: undefined }
      : (entry as { use: string; options?: unknown });

  const parentUrl = pathToFileURL(env.configPath).href;
  const module = await importModule(use, parentUrl);
  const exported = pickPluginExport(module, use);
  const plugin =
    typeof exported === 'function'
      ? (exported as (o?: unknown) => MocksmithPlugin)(options)
      : exported;

  return normalize(plugin, use);
};
