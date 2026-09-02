import { summarize, toOperations } from './toOperations';

import type { MockContext } from 'mocksmith';
import type { Scenario } from './types';
import type { ApplyScenarioSummary } from './toOperations';

/**
 * Applies a scenario straight to a session, with no round trip through HTTP.
 *
 * The `sessionCreated` hook sits on the hot path of session creation and must
 * stay synchronous, which rules out the system API — but not the steps, which
 * are the same ones `applyScenarioViaApi` sends.
 * */
export const applyScenarioToContext = (
  scenario: Scenario,
  context: MockContext
): ApplyScenarioSummary => {
  const operations = toOperations(scenario, { clearExisting: true });

  for (const operation of operations) {
    switch (operation.kind) {
      case 'clearOverrides':
        context.clearOverrides();
        break;
      case 'patchSession':
        context.patchApiData(operation.patch);
        break;
      case 'setOverride':
        context.setOverride(operation.path, operation.rules);
        break;
    }
  }

  return summarize(scenario, operations);
};
