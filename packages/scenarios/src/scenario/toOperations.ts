import { endpointsToRules } from './endpointsToRules';

import type { OverrideRule } from 'mocksmith/client';
import type { Scenario } from './types';

/**
 * One step of applying a scenario, in the order the steps must happen.
 * */
export type ScenarioOperation =
  | { kind: 'clearOverrides' }
  | { kind: 'patchSession'; patch: Record<string, unknown> }
  | { kind: 'setOverride'; path: string; rules: OverrideRule[] };

export type ToOperationsOptions = {
  /** Drop the overrides already in place before applying. */
  clearExisting?: boolean;
};

/**
 * Reads a scenario and says what has to be done — without saying to whom.
 *
 * This exists because "apply a scenario" had two implementations: one over the
 * system API (for the CLI and the Playwright fixture) and a synchronous one
 * against a MockContext (for the `sessionCreated` hook, which cannot await).
 * They drifted: only one grouped endpoints by path, and they patched feature
 * flags through different routes. Now both run this list, and the only
 * difference left between them is how a single step is executed.
 * */
export const toOperations = (
  scenario: Scenario,
  { clearExisting = false }: ToOperationsOptions = {}
): ScenarioOperation[] => {
  const operations: ScenarioOperation[] = [];

  if (clearExisting) {
    operations.push({ kind: 'clearOverrides' });
  }

  if (scenario.session?.patch) {
    operations.push({ kind: 'patchSession', patch: scenario.session.patch as Record<string, unknown> });
  }

  if (scenario.session?.flags) {
    operations.push({ kind: 'patchSession', patch: { remoteConfigFlags: scenario.session.flags } });
  }

  for (const { path, rules } of endpointsToRules(scenario.endpoints)) {
    operations.push({ kind: 'setOverride', path, rules });
  }

  return operations;
};

export type ApplyScenarioSummary = {
  paths: number;
  rules: number;
  /** True unless the scenario opted out via `reload: false`. */
  reloadRequested: boolean;
};

export const summarize = (
  scenario: Scenario,
  operations: ScenarioOperation[]
): ApplyScenarioSummary => {
  const overrides = operations.filter(
    (operation): operation is Extract<ScenarioOperation, { kind: 'setOverride' }> =>
      operation.kind === 'setOverride'
  );

  return {
    paths: overrides.length,
    rules: overrides.reduce((total, { rules }) => total + rules.length, 0),
    reloadRequested: scenario.reload !== false,
  };
};
