import { importModule } from 'mocksmith/config';
import path from 'node:path';

import { validateEndpoints } from '../scenario/validateEndpoints';

import type { Scenario } from '../scenario/types';

/**
 * Imports a module the way the host does.
 *
 * Pass the one from your context — `ctx.loadModule` in a plugin, the CLI
 * context's in a command — so paths resolve from the user's config. The
 * default is the core's own resolver, which is what makes a standalone call
 * (a script, a test) work; either way there is one implementation, not the
 * second jiti this package used to carry.
 * */
export type ScenarioModuleLoader = (specifier: string) => Promise<Record<string, unknown>>;

/**
 * Resolves a relative path from the working directory, which is what a script
 * calling `loadScenario('./degraded.scenario.ts')` means. A context's loader
 * resolves from the config instead — that is the point of passing one.
 * */
const loadFromCwd: ScenarioModuleLoader = (specifier) =>
  importModule(path.isAbsolute(specifier) ? specifier : path.resolve(process.cwd(), specifier));

const unwrapDefault = (value: unknown): unknown =>
  value && typeof value === 'object' && 'default' in value
    ? (value as { default: unknown }).default
    : value;

/**
 * Loads a scenario from a `*.scenario.{ts,js}` file. Accepts a default export
 * or any named export that looks like a scenario.
 * */
export async function loadScenario(
  filePath: string,
  load: ScenarioModuleLoader = loadFromCwd
): Promise<Scenario> {
  if (!/\.[cm]?[jt]s$/.test(filePath)) {
    throw new Error(`scenario: only *.scenario.{ts,js} files are supported (got ${filePath})`);
  }

  const module = await load(filePath);
  const candidate = [
    unwrapDefault(module.default),
    ...Object.values(module).map(unwrapDefault),
  ].find(
    (value): value is Scenario =>
      value !== null && typeof value === 'object' && ('endpoints' in value || 'session' in value)
  );

  if (!candidate) {
    throw new Error(`scenario: ${filePath} exports no scenario (no session/endpoints)`);
  }

  validateEndpoints(candidate.endpoints);

  return candidate;
}
