import { validateEndpoints } from '../scenario/validateEndpoints';

import type { Scenario } from '../scenario/types';

/**
 * Imports a module the way the host does. Both the plugin context
 * (`ctx.loadModule`) and the CLI context provide one, and resolution then
 * starts from the user's config — which is why this package no longer carries
 * a second jiti of its own.
 * */
export type ScenarioModuleLoader = (specifier: string) => Promise<Record<string, unknown>>;

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
  load: ScenarioModuleLoader
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
