import { definePlugin, type MocksmithPlugin } from 'mocksmith/plugin';
import path from 'node:path';
import { glob } from 'tinyglobby';

import { scenarioCliCommands } from './cli';
import { loadScenario } from './loadScenario';
import { createScenarioRegistry, scenarioNameFromFile } from './registry';
import { createScenarioSystemHandlers } from './systemHandlers';

import type { MockContext } from 'mocksmith';
import type { Scenario } from './types';

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

const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/dist/**'];

/**
 * Applies a scenario straight to a context, without a round trip through HTTP.
 * Used by the sessionCreated hook, which must stay synchronous.
 * */
const applyScenarioToContext = (scenario: Scenario, context: MockContext) => {
  context.clearOverrides();

  if (scenario.session?.patch) {
    context.patchApiData(scenario.session.patch as object);
  }

  if (scenario.session?.flags) {
    context.patchApiData({ remoteConfigFlags: scenario.session.flags });
  }

  for (const { path: endpointPath, response, ...rule } of scenario.endpoints ?? []) {
    const normalized = response && !rule.responses?.length ? { ...rule, ...response } : rule;

    context.setOverride(endpointPath, normalized);
  }
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
      const include =
        options.include ??
        (options.dir
          ? [`${options.dir}/**/*.scenario.{ts,mts,cts,js,mjs,cjs}`]
          : ['**/*.scenario.{ts,mts,cts,js,mjs,cjs}']);

      const files = await glob(include, {
        cwd: ctx.configDirectory,
        absolute: true,
        ignore: options.exclude ?? DEFAULT_EXCLUDE,
      });

      for (const file of files.sort()) {
        const scenario = await loadScenario(file, ctx.configDirectory);

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

      ctx.addSystemHandlers(createScenarioSystemHandlers(registry, ctx) as never);
      ctx.store.set('registry', registry);

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

export { loadScenario } from './loadScenario';
export type { ScenarioRegistry } from './registry';

export default scenarios;
