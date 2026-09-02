import { definePlugin, type MocksmithPlugin } from 'mocksmith/plugin';
import path from 'node:path';

import { findScenarioFiles } from '../catalogue/findScenarioFiles';
import { loadScenario } from '../catalogue/loadScenario';
import { scenarioNameFromFile } from '../catalogue/nameFromFile';
import { createScenarioRegistry } from '../catalogue/registry';
import { applyScenarioToContext } from '../scenario/applyOnContext';
import { scenarioCliCommands } from '../cli/commands';
import { createScenarioSystemHandlers } from './systemHandlers';

import type { Scenario } from '../scenario/types';

export type ScenariosPluginOptions = {
  /** Globs for scenario files, relative to the config. */
  include?: string[];
  exclude?: string[];
  /** Shorthand for include: [`${dir}/**\/*.scenario.*`]. */
  dir?: string;
  /** Scenarios defined inline, in addition to the ones found on disk. */
  scenarios?: Scenario[];
  /** Name of a scenario applied to every new session. */
  default?: string;
};

/**
 * Adds named scenarios to a mocksmith server: it discovers scenario files,
 * keeps a registry, serves it over the system API, and contributes the
 * `scenario` CLI command group.
 * */
export const scenarios = (options: ScenariosPluginOptions = {}): MocksmithPlugin => {
  const registry = createScenarioRegistry();

  return definePlugin({
    name: 'scenarios',

    async setup(ctx) {
      const files = await findScenarioFiles(ctx.configDirectory, options);

      for (const file of files) {
        const scenario = await loadScenario(file, ctx.loadModule);

        registry.register({
          name: scenario.name ?? scenarioNameFromFile(file),
          scenario,
          source: path.relative(ctx.configDirectory, file),
        });
      }

      for (const scenario of options.scenarios ?? []) {
        if (!scenario.name) {
          throw new Error('scenarios: an inline scenario needs a "name"');
        }

        registry.register({ name: scenario.name, scenario });
      }

      ctx.addSystemHandlers(createScenarioSystemHandlers(registry, ctx));

      ctx.logger.info(
        registry.size()
          ? `${registry.size()} scenario(s) registered: ${registry.names().join(', ')}`
          : 'no scenario files found'
      );
    },

    sessionCreated({ context, isSystem, logger }) {
      if (isSystem || !options.default) {
        return;
      }

      const entry = registry.get(options.default);

      if (!entry) {
        logger.warn(
          `default scenario "${options.default}" is not registered — known: ${
            registry.names().join(', ') || 'none'
          }`
        );

        return;
      }

      applyScenarioToContext(entry.scenario, context);
    },

    cli: scenarioCliCommands(),
  });
};
