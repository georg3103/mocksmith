import log from 'loglevel';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { importModule } from '../utils/importModule';
import { instantiatePlugin } from './normalizePlugin';

import type { MocksmithPlugin, PluginConfigEnv } from '../plugin/types';

export const DEFAULT_DISCOVERY_PATTERNS = [
  'mocksmith-plugin-*',
  '@mocksmith/*',
  '*-mocksmith-plugin',
];

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

/**
 * Finds plugins among the project's direct dependencies. A package counts only
 * when it opts in with a `"mocksmith": { "plugin": "./…" }` field — otherwise
 * the `@mocksmith/*` pattern would sweep in companion packages such as
 * @mocksmith/playwright, which are libraries and not plugins.
 * */
export const discoverPlugins = async (
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
      found.push(await instantiatePlugin(specifier, env));
    } catch (error) {
      log.warn(`Skipping discovered plugin "${name}": ${(error as Error).message}`);
    }
  }

  return found;
};
