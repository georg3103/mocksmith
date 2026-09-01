import { scenarioFilePurity } from './scenarioFilePurity';

export { scenarioFilePurity };

/**
 * ESLint plugin exposing mocksmith's scenario lint rules.
 *
 * Flat config usage:
 * ```js
 * import mocksmith from 'mocksmith/eslint';
 *
 * export default [
 *   {
 *     files: ['**\/*.scenario.ts', '**\/*.test.scenario.ts'],
 *     plugins: { mocksmith },
 *     rules: { 'mocksmith/scenario-file-purity': 'error' },
 *   },
 * ];
 * ```
 * */
export const mocksmithEslintPlugin = {
  meta: { name: 'mocksmith' },
  rules: {
    'scenario-file-purity': scenarioFilePurity,
  },
};

export default mocksmithEslintPlugin;
