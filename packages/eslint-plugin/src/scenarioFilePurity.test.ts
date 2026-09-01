import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe } from 'vitest';

import { scenarioFilePurity } from './scenarioFilePurity';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

describe('scenario-file-purity', () => {
  ruleTester.run('scenario-file-purity', scenarioFilePurity, {
    valid: [
      {
        name: 'scenario with inline objects in arguments',
        code: `
          import { defineEndpoint, defineTestScenario } from 'mocksmith/scenario';
          export const scenario = defineTestScenario({
            endpoints: [defineEndpoint('/api/x', { responses: [{ status: 200, body: { id: 1 } }] })],
          });
        `,
      },
      {
        name: 'non-exported defineEndpoint plus the scenario',
        code: `
          import { defineEndpoint, defineTestScenario } from 'mocksmith/scenario';
          const endpoint = defineEndpoint('/api/x', { responses: [] });
          export const scenario = defineTestScenario({ endpoints: [endpoint] });
        `,
      },
      {
        name: 'constants imported from the test setup file',
        code: `
          import { defineEndpoint, defineTestScenario } from 'mocksmith/scenario';
          import { publishedPost } from '../testSetup';
          export const scenario = defineTestScenario({
            endpoints: [defineEndpoint('/api/x', { responses: [{ status: 200, body: publishedPost }] })],
          });
        `,
      },
    ],
    invalid: [
      {
        name: 'a domain string constant at the top level',
        code: `
          import { defineTestScenario } from 'mocksmith/scenario';
          const CLEAN_BODY = 'a post without profanity';
          export const scenario = defineTestScenario({ endpoints: [] });
        `,
        errors: [{ messageId: 'impureTopLevel' }],
      },
      {
        name: 'a helper function at the top level',
        code: `
          import { defineTestScenario } from 'mocksmith/scenario';
          function buildBody() { return { id: 1 }; }
          export const scenario = defineTestScenario({ endpoints: [] });
        `,
        errors: [{ messageId: 'impureTopLevel' }],
      },
    ],
  });
});
