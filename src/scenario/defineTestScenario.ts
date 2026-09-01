import { validateEndpoints } from './validateEndpoints';

import type { TestScenario } from './types';

export function defineTestScenario(scenario: TestScenario): TestScenario {
  validateEndpoints(scenario.endpoints);

  return scenario;
}
