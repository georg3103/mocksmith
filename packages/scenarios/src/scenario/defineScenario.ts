import { validateEndpoints } from './validateEndpoints';

import type { Scenario } from './types';

export function defineScenario(scenario: Scenario): Scenario {
  validateEndpoints(scenario.endpoints);

  return scenario;
}
