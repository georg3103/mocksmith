import path from 'node:path';

import { importModule } from './importModule';
import { validateEndpoints } from './validateEndpoints';

import type { Scenario } from './types';

const unwrapDefault = (value: unknown): unknown =>
  value && typeof value === 'object' && 'default' in value
    ? (value as { default: unknown }).default
    : value;

/**
 * Loads a scenario from a `*.scenario.{ts,js}` file. TypeScript works without
 * a registered loader (jiti). Accepts a default export or any named export
 * that looks like a scenario.
 * */
export async function loadScenario(filePath: string, cwd = process.cwd()): Promise<Scenario> {
  const absolutePath = path.resolve(cwd, filePath);

  if (!/\.[cm]?[jt]s$/.test(absolutePath)) {
    throw new Error(
      `scenario: only *.scenario.{ts,js} files are supported (got ${absolutePath})`
    );
  }

  const module = await importModule(absolutePath);
  const candidate = [unwrapDefault(module.default), ...Object.values(module).map(unwrapDefault)].find(
    (value): value is Scenario =>
      value !== null && typeof value === 'object' && ('endpoints' in value || 'session' in value)
  );

  if (!candidate) {
    throw new Error(`scenario: ${absolutePath} exports no scenario (no session/endpoints)`);
  }

  validateEndpoints(candidate.endpoints);

  return candidate;
}
