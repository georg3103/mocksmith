import { endpointsToRules } from './endpointsToRules';

import type { Scenario } from './types';

/**
 * Transport used to reach the mock server's system API: gets the endpoint
 * name (e.g. `setOverride`) and the request body. The CLI backs it with
 * `fetch`, the Playwright fixture with `page.request`.
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

export type ApplyScenarioSummary = {
  paths: number;
  rules: number;
  /** True unless the scenario opted out via `reload: false`. */
  reloadRequested: boolean;
};

/**
 * The single canonical implementation of "apply a scenario": clears old
 * overrides (opt-in), patches session data and flags, then registers the
 * endpoint override rules. Reused by the CLI and the Playwright fixture.
 * */
export async function applyScenarioViaApi(
  scenario: Scenario,
  callApi: ScenarioApiCall,
  options: ApplyScenarioOptions = {}
): Promise<ApplyScenarioSummary> {
  const id = options.sessionId;

  if (options.clearExisting) {
    await callApi('clearOverride', { id, all: true });
  }

  if (scenario.session?.patch) {
    await callApi('patchSession', { id, patch: scenario.session.patch });
  }

  if (scenario.session?.flags) {
    await callApi('patchSession', { id, patch: { remoteConfigFlags: scenario.session.flags } });
  }

  const entries = endpointsToRules(scenario.endpoints);
  let rules = 0;

  for (const { path, rules: pathRules } of entries) {
    rules += pathRules.length;
    await callApi('setOverride', { id, path, rules: pathRules });
  }

  return {
    paths: entries.length,
    rules,
    reloadRequested: scenario.reload !== false,
  };
}
