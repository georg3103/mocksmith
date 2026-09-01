import type { ScenarioEndpoint } from './types';

/**
 * Scenario checks that fail fast on file load:
 * - an empty `path`;
 * - mixing an inline response with `responses`.
 * Example of a silent bug this catches:
 * `{ path: '/feed', status: 500, responses: [{ body: page1 }] }` — the engine
 * checks `responses` first, returns page1 and silently ignores `status: 500`.
 * */
export function validateEndpoints(endpoints: ScenarioEndpoint[] = []): void {
  endpoints.forEach((endpoint, index) => {
    if (!endpoint.path) {
      throw new Error(`scenario: endpoints[${index}] has no path`);
    }

    const hasInlineResponse =
      endpoint.status !== undefined || endpoint.body !== undefined || endpoint.abort !== undefined;

    if (hasInlineResponse && endpoint.responses?.length) {
      throw new Error(
        `scenario: endpoints[${index}] (${endpoint.path}) — an inline response and \`responses\` cannot be combined`
      );
    }
  });
}
