/**
 * `@mocksmith/scenarios` — writing scenarios.
 *
 * Files in this directory are entry points, one per subpath in the package's
 * exports map, and they are thin on purpose: the implementation lives in the
 * folder that names the concept (scenario, catalogue, server, cli, testing).
 * */
export { defineScenario } from './scenario/defineScenario';
export { defineTestScenario } from './scenario/defineTestScenario';
export { endpointsToRules } from './scenario/endpointsToRules';
export { toOperations, type ScenarioOperation } from './scenario/toOperations';
export {
  applyScenarioViaApi,
  type ApplyScenarioOptions,
  type ApplyScenarioSummary,
  type ScenarioApiCall,
} from './scenario/applyOverApi';
export type {
  Scenario,
  ScenarioEndpoint,
  ScenarioSession,
  TestScenario,
} from './scenario/types';
