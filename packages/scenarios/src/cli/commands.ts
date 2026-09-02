import { applyScenarioViaApi, type ApplyScenarioSummary } from '../scenario/applyOverApi';
import { loadScenario } from '../catalogue/loadScenario';
import { formatCatalogue, type ScenarioSummary } from './formatCatalogue';

import type { PluginCliCommand, PluginCliContext } from 'mocksmith/plugin';

const looksLikePath = (value: string) =>
  value.startsWith('.') || value.startsWith('/') || /\.[cm]?[jt]s$/.test(value);

/**
 * The `scenario` command group. Names are resolved by the running server, which
 * owns the registry; a path is loaded locally, so a one-off file works even
 * when it is not part of the catalogue.
 * */
export const scenarioCliCommands = (): PluginCliCommand[] => [
  {
    name: 'scenario',
    description: 'Mock scenario management',
    defaultSubcommand: 'apply',
    commands: [
      {
        name: 'list',
        description: 'List the scenarios the running server knows about',
        action: async (ctx: PluginCliContext) => {
          const { scenarios } = await ctx.callApi<{ scenarios: ScenarioSummary[] }>(
            'scenarios',
            {}
          );

          ctx.log.info(formatCatalogue(scenarios));
        },
      },
      {
        name: 'apply',
        description: 'Apply a scenario by name, or a *.scenario.ts file by path',
        args: [{ name: 'target', required: true, description: 'scenario name or file path' }],
        options: [
          { flags: '--no-reload', description: 'do not reload the browser after applying' },
        ],
        action: async (ctx, args, options) => {
          const target = String(args.target);
          let summary: ApplyScenarioSummary;

          if (looksLikePath(target)) {
            const scenario = await loadScenario(target, ctx.loadModule);

            summary = await applyScenarioViaApi(scenario, ctx.callApi, {
              sessionId: ctx.sessionId,
              clearExisting: true,
            });
          } else {
            // Checked up front so an unknown name reads as a suggestion rather
            // than a raw 404 from the transport.
            const { scenarios } = await ctx.callApi<{ scenarios: ScenarioSummary[] }>(
              'scenarios',
              {}
            );

            if (!scenarios.some((scenario) => scenario.name === target)) {
              const known = scenarios.map((scenario) => scenario.name);

              throw new Error(
                `No scenario named "${target}". ` +
                  (known.length
                    ? `Available: ${known.join(', ')}`
                    : 'None are registered — check the plugin options in your config.')
              );
            }

            summary = await ctx.callApi<ApplyScenarioSummary>('applyScenario', {
              id: ctx.sessionId,
              name: target,
              clearExisting: true,
            });
          }

          ctx.log.info(
            `✅ scenario "${target}" applied: ${summary.paths} endpoint(s), ${summary.rules} rule(s)`
          );

          if (summary.reloadRequested && options.reload !== false) {
            await ctx.reloadApp();
            ctx.log.info('✅ browser reload requested');
          } else {
            ctx.log.info('reload the page so the app re-reads the data');
          }
        },
      },
      {
        name: 'clear',
        description: 'Clear all scenario overrides',
        action: async (ctx) => {
          await ctx.callApi('clearScenario', { id: ctx.sessionId });
          ctx.log.info(
            '✅ scenario overrides cleared (for a full rollback run mocksmith session reset)'
          );
        },
      },
    ],
  },
];
