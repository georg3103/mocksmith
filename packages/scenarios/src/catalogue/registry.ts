import type { Scenario } from '../scenario/types';

export type RegisteredScenario = {
  name: string;
  scenario: Scenario;
  /** Where it came from, for error messages: a path relative to the config. */
  source?: string;
};

export type ScenarioRegistry = ReturnType<typeof createScenarioRegistry>;

/**
 * The catalogue of scenarios a server knows about.
 *
 * Lives in the plugin factory's closure rather than at module level, so two
 * servers in one process (or two tests) never share one.
 * */
export const createScenarioRegistry = () => {
  const items = new Map<string, RegisteredScenario>();

  return {
    register(entry: RegisteredScenario) {
      const existing = items.get(entry.name);

      if (existing) {
        throw new Error(
          `scenarios: two scenarios are named "${entry.name}" ` +
            `(${existing.source ?? 'inline'} and ${entry.source ?? 'inline'}). ` +
            'Names address scenarios from the CLI and tests, so they must be unique.'
        );
      }

      items.set(entry.name, entry);
    },

    get: (name: string) => items.get(name),
    list: () => [...items.values()],
    names: () => [...items.keys()],
    size: () => items.size,
  };
};
