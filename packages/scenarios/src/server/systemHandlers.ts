import { applyScenarioViaApi } from './applyScenarioViaApi';

import type { PluginSetupContext } from 'mocksmith/plugin';
import type { ScenarioRegistry } from './registry';

type ApplyRequest = { id?: string; name?: string; clearExisting?: boolean };

/**
 * The scenario half of the system API. Applying goes through
 * applyScenarioViaApi over the in-process transport, so the server, the CLI and
 * the Playwright fixture all run the very same code.
 * */
export const createScenarioSystemHandlers = (
  registry: ScenarioRegistry,
  ctx: Pick<PluginSetupContext, 'callSystemApi'>
) => ({
  scenarios: () => ({
    response: {
      body: {
        scenarios: registry.list().map(({ name, scenario, source }) => ({
          name,
          source,
          feature: scenario.feature,
          description: scenario.description,
          order: scenario.order,
          endpoints: scenario.endpoints?.length ?? 0,
        })),
      },
    },
  }),

  applyScenario: async (_: unknown, { requestData }: { requestData: { body: ApplyRequest } }) => {
    const { id, name, clearExisting = true } = requestData.body;

    if (!name) {
      return { response: { status: 400, body: { result: 'bad-request' } } };
    }

    const entry = registry.get(name);

    if (!entry) {
      return {
        response: {
          status: 404,
          body: { result: 'not-found', known: registry.names() },
        },
      };
    }

    const summary = await applyScenarioViaApi(entry.scenario, ctx.callSystemApi, {
      sessionId: id,
      clearExisting,
    });

    return { response: { body: { result: 'ok', name, ...summary } } };
  },

  clearScenario: async (_: unknown, { requestData }: { requestData: { body: { id?: string } } }) => {
    await ctx.callSystemApi('clearOverride', { id: requestData.body.id, all: true });

    return { response: { body: { result: 'ok' } } };
  },
});
