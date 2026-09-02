import { summarize, toOperations } from './toOperations';

import type { Scenario } from './types';
import type { ApplyScenarioSummary } from './toOperations';

/**
 * Transport used to reach the mock server's system API: gets the endpoint
 * name (e.g. `setOverride`) and the request body. The CLI backs it with
 * `fetch`, the Playwright fixture with `page.request`, a plugin with
 * `ctx.callSystemApi`.
 * */
export type ScenarioApiCall = (
  endpoint: string,
  body: Record<string, unknown>
) => Promise<unknown>;

export type ApplyScenarioOptions = {
  /** Session to apply the scenario to. Omit for the server's default session. */
  sessionId?: string;
  /** Drop all existing endpoint overrides before applying. */
  clearExisting?: boolean;
};

export type { ApplyScenarioSummary };

/**
 * Applies a scenario through the system API — the path the CLI, the Playwright
 * fixture and plugins all take. The steps come from `toOperations`; this only
 * knows how to send one.
 * */
export async function applyScenarioViaApi(
  scenario: Scenario,
  callApi: ScenarioApiCall,
  options: ApplyScenarioOptions = {}
): Promise<ApplyScenarioSummary> {
  const id = options.sessionId;
  const operations = toOperations(scenario, { clearExisting: options.clearExisting });

  for (const operation of operations) {
    switch (operation.kind) {
      case 'clearOverrides':
        await callApi('clearOverride', { id, all: true });
        break;
      case 'patchSession':
        await callApi('patchSession', { id, patch: operation.patch });
        break;
      case 'setOverride':
        await callApi('setOverride', { id, path: operation.path, rules: operation.rules });
        break;
    }
  }

  return summarize(scenario, operations);
}
