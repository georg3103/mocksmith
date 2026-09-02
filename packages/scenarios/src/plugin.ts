/**
 * Entry point for `@mocksmith/scenarios/plugin` — what the config imports.
 * */
export {
  scenarios,
  type ScenariosPluginOptions,
} from './server/createScenariosPlugin';
export { loadScenario, type ScenarioModuleLoader } from './catalogue/loadScenario';
export type { ScenarioRegistry } from './catalogue/registry';

export { scenarios as default } from './server/createScenariosPlugin';
